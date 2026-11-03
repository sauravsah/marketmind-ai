from playwright.sync_api import sync_playwright
import subprocess, json, os
from pathlib import Path
P=str(Path(__file__).resolve().parents[2]); OUT=os.environ.get('QA_OUTPUT_DIR','/tmp/marketmind-onboarding-qa'); os.makedirs(OUT,exist_ok=True)
MOCK='''
const read=()=>JSON.parse(localStorage.getItem('qa.mock-cloud')||'{}');
const api={doc:(p,...s)=>({path:(p.path||'db')+'/'+s.join('/')}),collection:(p,...s)=>({path:(p.path||'db')+'/'+s.join('/')}),getDoc:async r=>({exists:()=>!!read()[r.path],data:()=>read()[r.path]}),getDocs:async r=>({docs:Object.entries(read()).filter(([k])=>k.startsWith(r.path+'/')).map(([,v])=>({data:()=>v}))}),setDoc:async(r,d)=>{const docs=read();docs[r.path]=d;localStorage.setItem('qa.mock-cloud',JSON.stringify(docs));}};
const params=new URLSearchParams(location.search);
const verified=params.get('qa_verified')!=='0';
const user={id:'onboarding-qa',uid:'onboarding-qa',email:'qa@example.invalid',emailVerified:verified};
export const authService={init:async()=>({configured:true,user,session:{user}}),getClient:async()=>({db:{},firestoreApi:api}),onAuthStateChange:async()=>({data:{subscription:{unsubscribe(){}}}}),getIdToken:async()=>null,signOut:async()=>({})};
export const authErrorMessage=e=>e.message;export const authenticatedFetch=(i,o)=>fetch(i,o);
export const describeEmailActionError=code=>({title:code==='auth/expired-action-code'?'That verification link has expired.':code==='auth/invalid-action-code'?'That verification link was already used.':'That verification link did not work.',body:'Send yourself a fresh link below and open the newest email.'});
'''
srv=subprocess.Popen(['node','server.mjs'],cwd=P,env={**os.environ,'PORT':'4187'},stdout=subprocess.DEVNULL)
try:
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
  for width in [320,390,1280]:
   page=b.new_page(viewport={'width':width,'height':900},reduced_motion='reduce');errors=[];calls=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   page.route('**/js/auth.js',lambda r:r.fulfill(status=200,content_type='text/javascript',body=MOCK))
   def block(r):
    calls.append(r.request.url);r.abort()
   page.route('**/api/**',block)
   page.goto('http://localhost:4187/?qa_verified=1#dashboard')
   # 1. Fresh workspace auto-opens the choice screen.
   page.get_by_text('Two quick ways in.',exact=True).wait_for(timeout=8000)
   page.screenshot(path=f'{OUT}/choice-{width}.png')
   # 2. Questions path.
   page.get_by_role('button',name='Answer five quick questions',exact=False).click()
   page.locator('#onboarding-brand').fill('Stride QA')
   page.get_by_role('button',name='Consumer app',exact=True).click()
   page.get_by_role('button',name='Next',exact=True).click()
   page.get_by_role('button',name='Launch something new',exact=True).click()
   page.get_by_role('button',name='Next',exact=True).click()
   page.get_by_role('button',name='Consumers',exact=True).click()
   page.locator('#onboarding-audience-detail').fill('Gen Z students in Indian metros')
   page.get_by_role('button',name='Next',exact=True).click()
   page.get_by_role('button',name='India',exact=True).click()
   page.get_by_role('button',name='Next',exact=True).click()
   page.screenshot(path=f'{OUT}/q5-starters-{width}.png')
   page.get_by_role('button',name='How do I get gen z students in indian metros to try Stride QA?',exact=True).click()
   page.get_by_role('button',name='Review',exact=True).click()
   page.get_by_text('Stride QA is ready.',exact=True).wait_for()
   page.screenshot(path=f'{OUT}/summary-{width}.png')
   page.get_by_role('button',name='See my workspace',exact=True).click()
   # 3. Strategy form is prefilled; nothing saved as a strategy; no research started.
   page.locator('#strategy-form').wait_for()
   assert page.locator('#strategy-idea').input_value()=='How do I get gen z students in indian metros to try Stride QA?'
   assert page.locator('#strategy-market').input_value()=='India'
   assert page.locator('#strategy-audience').input_value()=='Gen Z students in Indian metros'
   assert page.locator('#strategy-objective').input_value()=='Launch'
   page.screenshot(path=f'{OUT}/prefilled-brief-{width}.png',full_page=True)
   brand=page.evaluate('JSON.parse(localStorage.getItem("marketmind.account.onboarding-qa.brand-profile"))')
   assert brand['name']=='Stride QA' and brand['industry']=='Consumer app' and brand['audience']=='Gen Z students in Indian metros', brand
   workspace=page.evaluate('JSON.parse(localStorage.getItem("marketmind.account.onboarding-qa.workspace-settings"))')
   assert workspace['defaultMarket']=='India' and workspace['defaultObjective']=='Launch', workspace
   assert page.evaluate('localStorage.getItem("marketmind.account.onboarding-qa.strategies")') in (None,'null','[]')
   # 4. Record written: dashboard no longer auto-opens, but the card remains while empty.
   page.goto('http://localhost:4187/?qa_verified=1#dashboard');page.locator('h1').wait_for()
   assert page.locator('text=Two quick ways in.').count()==0
   page.get_by_text('Get set up your way.',exact=True).wait_for()
   # 5. Example workspace: gates, labels, leave.
   page.get_by_role('button',name='Explore an example',exact=True).click()
   page.get_by_text('SAMPLE WORKSPACE · FIXED EXAMPLE DATA · NOT LIVE RESEARCH',exact=True).wait_for()
   radar_chip=page.get_by_role('button',name='Radar',exact=True)
   assert radar_chip.get_attribute('aria-disabled')=='true'
   page.get_by_role('button',name='Use this example',exact=False).click()
   page.screenshot(path=f'{OUT}/sample-brief-{width}.png')
   page.get_by_role('button',name='Run example research',exact=True).click()
   page.get_by_text('Simulated excerpt · example event-calendar data · Observed (example)',exact=True).wait_for()
   page.screenshot(path=f'{OUT}/sample-market-{width}.png')
   page.get_by_role('button',name='Review audience claims',exact=True).click()
   assert page.get_by_role('button',name='Open the radar',exact=True).is_disabled()
   page.get_by_role('button',name='Approve',exact=True).first.click()
   page.screenshot(path=f'{OUT}/sample-audience-{width}.png')
   page.get_by_role('button',name='Open the radar',exact=True).click()
   assert page.get_by_role('button',name='Build campaign direction',exact=True).is_disabled()
   page.get_by_role('button',name='Campus run-club challenges',exact=False).click()
   page.get_by_role('button',name='Build campaign direction',exact=True).click()
   page.get_by_text('Run your first 5K',exact=False).first.wait_for()
   page.screenshot(path=f'{OUT}/sample-campaign-{width}.png')
   page.get_by_text('Leave example',exact=True).click()
   page.locator('h1').wait_for()
   assert page.locator('.onboarding-overlay').count()==0
   # 6. Safety rails: zero provider/API calls, no page errors, no sideways scroll.
   provider_calls=[u for u in calls if u.startswith('http://localhost:4187/api/')]
   assert not provider_calls,provider_calls
   assert not errors,errors
   assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
   print(json.dumps({'width':width,'auto_open':'passed','questions_prefill':'passed','sample_gates':'passed','provider_calls':len(provider_calls),'page_errors':errors}))
   page.close()
  # Unverified users see the recovery hint on the verify screen.
  page=b.new_page(viewport={'width':390,'height':900},reduced_motion='reduce')
  page.route('**/js/auth.js',lambda r:r.fulfill(status=200,content_type='text/javascript',body=MOCK))
  page.route('**/api/**',lambda r:r.abort())
  page.goto('http://localhost:4187/?qa_verified=0#dashboard')
  page.get_by_role('heading',name='Check your inbox.').wait_for(timeout=8000)
  page.get_by_text('you may already be verified',exact=False).wait_for()
  page.screenshot(path=f'{OUT}/verify-recovery-390.png',full_page=True)
  print(json.dumps({'verify_recovery_hint':'passed'}))
  page.close();b.close()
finally:srv.terminate();srv.wait()
