from playwright.sync_api import sync_playwright
import subprocess, json, os
from pathlib import Path
P=str(Path(__file__).resolve().parents[2]); OUT=os.environ.get('QA_OUTPUT_DIR', '/tmp/marketmind-draft-qa'); os.makedirs(OUT, exist_ok=True)
MOCK='''
const user={id:'isolated-local-qa',uid:'isolated-local-qa',email:'qa@example.invalid',emailVerified:true};
const read=()=>JSON.parse(localStorage.getItem('qa.mock-cloud')||'{}');
const api={doc:(p,...s)=>({path:(p.path||'db')+'/'+s.join('/')}),collection:(p,...s)=>({path:(p.path||'db')+'/'+s.join('/')}),getDoc:async r=>({exists:()=>!!read()[r.path],data:()=>read()[r.path]}),getDocs:async r=>({docs:Object.entries(read()).filter(([k])=>k.startsWith(r.path+'/')).map(([,v])=>({data:()=>v}))}),setDoc:async(r,d)=>{if(localStorage.getItem('qa.fail-cloud'))throw Error('Simulated offline');const docs=read();docs[r.path]=d;localStorage.setItem('qa.mock-cloud',JSON.stringify(docs));}};
export const authService={init:async()=>({configured:true,user,session:{user}}),getClient:async()=>({db:{},firestoreApi:api}),onAuthStateChange:async()=>({data:{subscription:{unsubscribe(){}}}}),getIdToken:async()=>null,signOut:async()=>({})};
export const authErrorMessage=e=>e.message;export const authenticatedFetch=(i,o)=>fetch(i,o);
'''
srv=subprocess.Popen(['node','server.mjs'],cwd=P,env={**os.environ,'PORT':'4185'},stdout=subprocess.DEVNULL)
try:
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
  for width in [320,390,1280]:
   page=b.new_page(viewport={'width':width,'height':900},reduced_motion='reduce'); errors=[];calls=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   page.route('**/js/auth.js',lambda r:r.fulfill(status=200,content_type='text/javascript',body=MOCK))
   def block(r):
    calls.append(r.request.url);r.abort()
   page.route('**/api/**',block)
   page.goto('http://localhost:4185/#dashboard');page.locator('h1').wait_for()
   # Seed an original strategy to prove new drafts cannot overwrite selected work.
   page.evaluate('''()=>{ const original={id:'original-brief',idea:'Original brief must not change',audience:'Original audience',market:'India',platforms:[],competitors:[],researchDepth:'balanced',status:'draft',research:null,createdAt:'2026-01-01'};const cloud=JSON.parse(localStorage.getItem('qa.mock-cloud'));cloud['db/users/isolated-local-qa/strategies/original-brief']={payload:original};localStorage.setItem('qa.mock-cloud',JSON.stringify(cloud));localStorage.setItem('marketmind.migration.isolated-local-qa','{}'); }''')
   page.reload();page.get_by_role('button',name='New strategy',exact=True).click()
   assert page.locator('#strategy-idea').input_value()==''
   page.locator('#strategy-idea').fill('QA draft question for saved regression')
   page.locator('#strategy-audience').fill('QA audience')
   page.locator('#strategy-market').fill('Bengaluru, India')
   page.locator('#strategy-objective').select_option(label='Awareness')
   page.locator('details.optional-details').evaluate('(e)=>e.open=true')
   page.locator('#strategy-platform').select_option(label='LinkedIn')
   page.locator('#strategy-depth').select_option('deep')
   page.locator('#competitor-entry').fill('Acme, Other')
   page.get_by_role('button',name='Save for later',exact=True).click()
   page.wait_for_url('**/#dashboard');page.get_by_text('Draft saved to your workspace.',exact=True).wait_for()
   cloud=page.evaluate('JSON.parse(localStorage.getItem("qa.mock-cloud"))')
   original=cloud['db/users/isolated-local-qa/strategies/original-brief']['payload'];assert original['idea']=='Original brief must not change'
   drafts=[v['payload'] for k,v in cloud.items() if '/strategies/' in k and not k.endswith('/original-brief')];assert len(drafts)==1
   draft=drafts[0];assert draft['idea']=='QA draft question for saved regression' and draft['competitors']==['Acme','Other'] and draft['researchDepth']=='deep'
   # Refresh and simulated sign-out/re-init both read from mock cloud, not memory.
   for cycle in range(2):
    page.reload();page.locator('[data-action="open-strategy"][data-id="'+draft['id']+'"]').click();page.locator('#strategy-form').wait_for()
    assert page.locator('#strategy-idea').input_value()==draft['idea'];assert page.locator('#strategy-audience').input_value()=='QA audience'
    assert page.locator('#strategy-market').input_value()=='Bengaluru, India';assert page.locator('#strategy-objective').input_value()=='Awareness'
    assert page.locator('#strategy-platform').input_value()=='LinkedIn';assert page.locator('#strategy-depth').input_value()=='deep'
    if cycle==0:
     page.locator('#strategy-idea').screenshot(path=f'{OUT}/restored-draft-{width}.png')
     page.locator('details.optional-details').evaluate('(e)=>e.open=true')
     page.screenshot(path=f'{OUT}/restored-form-{width}.png',full_page=True)
     page.goto('http://localhost:4185/#dashboard')
   # Failed cloud save reports local-only, not a false synced success.
   page.evaluate('localStorage.setItem("qa.fail-cloud","1")')
   page.locator('#strategy-idea').fill('QA offline draft')
   page.get_by_role('button',name='Save for later',exact=True).click()
   page.wait_for_url('**/#dashboard');page.get_by_text('Draft saved on this device only.',exact=False).wait_for()
   assert page.evaluate('JSON.parse(localStorage.getItem("marketmind.strategies"))[0].idea')=='QA offline draft'
   # A full storage+cloud failure must keep the populated form open.
   page.locator('[data-action="open-strategy"][data-id="'+draft['id']+'"]').click()
   page.locator('#strategy-idea').fill('QA both saves fail')
   page.evaluate("()=>{ Storage.prototype.setItem = function(){throw Error('Simulated storage full')}; }")
   page.get_by_role('button',name='Save for later',exact=True).click()
   page.get_by_text('Draft could not be saved. Keep this page open and try again.',exact=True).wait_for()
   assert page.url.endswith('#strategy') and page.locator('#strategy-idea').input_value()=='QA both saves fail'
   assert not calls, calls
   assert not errors, errors
   assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
   print(json.dumps({'width':width,'save_reload_reinit':'passed','all_fields':'passed','original_preserved':True,'cloud_failure_local_only':'passed','total_save_failure_keeps_form':'passed','generation_calls':len(calls),'page_errors':errors}))
   page.close()
  b.close()
finally:srv.terminate();srv.wait()
