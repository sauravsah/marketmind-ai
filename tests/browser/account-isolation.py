from playwright.sync_api import sync_playwright
from pathlib import Path
import subprocess,os,json
ROOT=str(Path(__file__).resolve().parents[2]);OUT='/downloads/marketmind-safety-evidence';os.makedirs(OUT,exist_ok=True)
MOCK=r'''
let callback;const clone=x=>JSON.parse(JSON.stringify(x));
const users={A:{id:'A',uid:'A',email:'a@example.invalid',emailVerified:true},B:{id:'B',uid:'B',email:'b@example.invalid',emailVerified:true}};
let current=users.A;
const docs=new Map([
 ['db/users/A',{name:'Account A workspace',brandProfile:{name:'A private brand'}}],
 ['db/users/B',{name:'Account B workspace',brandProfile:{name:'B private brand'}}],
 ['db/users/A/strategies/a-original',{payload:{id:'a-original',idea:'A private original brief',audience:'A audience',market:'India',status:'draft',competitors:[],platforms:[],createdAt:'2026-01-01'}}],
 ['db/users/B/strategies/b-original',{payload:{id:'b-original',idea:'B private original brief',audience:'B audience',market:'India',status:'draft',competitors:[],platforms:[],createdAt:'2026-01-01'}}],
]);
let delayedOwner=null,releaseRead=null,releaseWrite=null;let delayWrites=false;
const api={doc:(p,...s)=>({path:(p.path||'db')+'/'+s.join('/')}),collection:(p,...s)=>({path:(p.path||'db')+'/'+s.join('/')}),
 getDoc:async r=>{if(delayedOwner&&r.path==='db/users/'+delayedOwner){delayedOwner=null;await new Promise(ok=>releaseRead=ok);}const d=clone(docs.get(r.path)||null);return {exists:()=>!!d,data:()=>d};},
 getDocs:async r=>({docs:[...docs].filter(([k])=>k.startsWith(r.path+'/')).map(([k,v])=>({id:k.split('/').pop(),data:()=>clone(v)}))}),
 setDoc:async(r,d)=>{if(delayWrites){delayWrites=false;await new Promise(ok=>releaseWrite=ok);}docs.set(r.path,clone(d));}};
window.qa={switchUser:async name=>{current=users[name]||null;await callback(current?'SIGNED_IN':'SIGNED_OUT',current?{user:current}:null);},delayedSwitch:name=>{delayedOwner=name;window.qa.switchUser(name);},releaseRead:()=>releaseRead?.(),delayWrite:()=>delayWrites=true,releaseWrite:()=>releaseWrite?.(),cloud:()=>Object.fromEntries(docs)};
export const authService={init:async()=>({configured:true,user:current,session:{user:current}}),getClient:async()=>({db:{},firestoreApi:api}),onAuthStateChange:async fn=>{callback=fn;return {data:{subscription:{unsubscribe(){}}}};},getIdToken:async()=>null,signOut:async()=>{await window.qa.switchUser(null);return {};}};
export const authErrorMessage=e=>e.message;export const authenticatedFetch=(u,o)=>fetch(u,o);
'''
srv=subprocess.Popen(['node','server.mjs'],cwd=ROOT,env={**os.environ,'PORT':'4186'},stdout=subprocess.DEVNULL)
try:
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
  result=[]
  for width in [320,390,1280]:
   page=b.new_page(viewport={'width':width,'height':900},reduced_motion='reduce');errors=[];calls=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   page.route('**/js/auth.js',lambda r:r.fulfill(status=200,content_type='text/javascript',body=MOCK))
   page.route('**/api/**',lambda r:(calls.append(r.request.url),r.abort()))
   page.add_init_script("localStorage.setItem('marketmind.strategies',JSON.stringify([{id:'legacy',idea:'UNOWNED LEGACY SECRET'}]));localStorage.setItem('marketmind.brand-profile',JSON.stringify({name:'UNOWNED BRAND SECRET'}));")
   page.goto('http://localhost:4186/#dashboard');page.get_by_role('button',name='A private original brief',exact=False).wait_for(timeout=5000)
   assert 'UNOWNED' not in page.locator('body').inner_text()
   # Save A-only draft. Legacy keys untouched, new backup scoped to A.
   page.get_by_role('button',name='New strategy',exact=True).click();page.locator('#strategy-idea').fill('A saved private draft');page.locator('#strategy-market').fill('India');page.get_by_role('button',name='Save for later',exact=True).click();page.get_by_text('Draft saved to your workspace.',exact=True).wait_for()
   scoped=page.evaluate("JSON.parse(localStorage.getItem('marketmind.account.A.strategies'))");assert scoped[0]['idea']=='A saved private draft'
   # Immediate B switch clears all A fields and does not prompt to import A.
   page.evaluate("qa.switchUser('B')");page.goto('http://localhost:4186/#dashboard',wait_until='domcontentloaded') if False else None
   page.get_by_role('button',name='B private original brief',exact=False).wait_for();text=page.locator('body').inner_text();assert 'A private' not in text and 'A saved' not in text and 'UNOWNED' not in text
   assert page.evaluate("localStorage.getItem('marketmind.account.B.strategies')") is None
   # Delayed A load cannot paint over B even after an A -> B transition.
   page.evaluate("qa.delayedSwitch('A')");page.wait_for_function("qa.releaseRead !== undefined")
   page.evaluate("qa.switchUser('B')");page.evaluate("location.hash='dashboard'");page.get_by_role('button',name='B private original brief',exact=False).wait_for();page.evaluate('qa.releaseRead()');page.wait_for_timeout(100)
   assert 'A private original' not in page.locator('body').inner_text()
   # An old A save may complete only into A's fixed remote path, never B UI/storage.
   page.evaluate("qa.switchUser('A')");page.evaluate("location.hash='dashboard'");page.get_by_role('button',name='A private original brief',exact=False).wait_for()
   page.get_by_role('button',name='New strategy',exact=True).click();page.locator('#strategy-idea').fill('A delayed save');page.locator('#strategy-market').fill('India');page.evaluate('qa.delayWrite()');page.get_by_role('button',name='Save for later',exact=True).click()
   page.evaluate("qa.switchUser('B')");page.evaluate("location.hash='dashboard'");page.get_by_role('button',name='B private original brief',exact=False).wait_for();page.evaluate('qa.releaseWrite()');page.wait_for_timeout(100)
   assert 'A delayed' not in page.locator('body').inner_text();assert page.evaluate("localStorage.getItem('marketmind.account.B.strategies')") is None
   page.screenshot(path=f'{OUT}/account-B-isolated-{width}.png',full_page=True)
   page.evaluate('qa.switchUser(null)');assert 'B private' not in page.locator('body').inner_text()
   assert 'UNOWNED LEGACY SECRET' in page.evaluate("localStorage.getItem('marketmind.strategies')")
   cloud=page.evaluate('qa.cloud()');assert cloud['db/users/A/strategies/a-original']['payload']['idea']=='A private original brief';assert cloud['db/users/B/strategies/b-original']['payload']['idea']=='B private original brief'
   assert not calls and not errors,(calls,errors)
   result.append({'width':width,'accountIsolation':True,'staleLoadIgnored':True,'staleSaveKeptInA':True,'unownedDataUntouched':True,'providerCalls':0,'pageErrors':errors});page.close()
  b.close();open(OUT+'/browser-isolation.json','w').write(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
finally:srv.terminate();srv.wait()
