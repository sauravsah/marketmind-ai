# Email-action handling QA: runs the REAL js/auth.js + js/app.js against stubbed
# Firebase SDK modules, covering every action-link state. Local only; no network
# calls leave the machine except localhost (all external hosts are intercepted).
from playwright.sync_api import sync_playwright
import subprocess, os, json, sys
P='/downloads/marketmind'; OUT='/tmp/marketmind-email-qa'; os.makedirs(OUT,exist_ok=True)
CONFIG=json.dumps({"firebase":{"apiKey":"qa","authDomain":"qa-project.firebaseapp.com","projectId":"qa","storageBucket":"","messagingSenderId":"","appId":"qa"}})
APP_STUB="export const getApps=()=>[];export const getApp=()=>({options:{}});export const initializeApp=(c)=>({options:c});"
AUTH_STUB='''
const params=new URLSearchParams(location.search);window.__qaParams=location.search;
const state=params.get('qa_auth_state')||'out';
const result=params.get('qa_action_result')||'ok';
const user=state==='out'?null:{uid:'qa',id:'qa',email:'qa@example.invalid',emailVerified:false,displayName:'',metadata:{}};
export const browserLocalPersistence={};
export const getAuth=(app)=>({currentUser:user,app});
export const setPersistence=async()=>{};
export const onAuthStateChanged=(auth,cb)=>{setTimeout(()=>cb(auth.currentUser),0);return()=>{};};
export const applyActionCode=async(auth,code)=>{if(result==='fail'){const e=new Error('bad link');e.code='auth/invalid-action-code';throw e;}if(user)user.emailVerified=true;};
export const reload=async()=>{};
export const confirmPasswordReset=async()=>{};
export const createUserWithEmailAndPassword=async()=>{throw new Error('qa: unused');};
export const signInWithEmailAndPassword=async()=>{throw new Error('qa: unused');};
export const sendEmailVerification=async()=>{};
export const sendPasswordResetEmail=async()=>{};
export const signOut=async()=>{};
'''
FS_STUB="export const getFirestore=()=>({});"
checks={}
srv=subprocess.Popen(['node','server.mjs'],cwd=P,env={**os.environ,'PORT':'4188'},stdout=subprocess.DEVNULL)
try:
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
  page=b.new_page(viewport={'width':390,'height':900},reduced_motion='reduce')
  errors=[];forwarded=[];external=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  def guard(r):
    u=r.request.url
    if any(d in u for d in ('googletagmanager','google-analytics','saurav-analytics')): external.append(u); r.abort(); return
    if '/api/' in u: r.abort(); return
    r.continue_()
  page.route('**/*',guard)
  page.route('**/api/public-runtime-config',lambda r:r.fulfill(status=200,content_type='application/json',body=CONFIG))
  page.route('**/firebasejs/**/firebase-app.js',lambda r:r.fulfill(status=200,content_type='text/javascript',body=APP_STUB))
  page.route('**/firebasejs/**/firebase-auth.js',lambda r:r.fulfill(status=200,content_type='text/javascript',body=AUTH_STUB))
  page.route('**/firebasejs/**/firebase-firestore.js',lambda r:r.fulfill(status=200,content_type='text/javascript',body=FS_STUB))
  def fwd(r):
    forwarded.append(r.request.url)
    r.fulfill(status=200,content_type='text/html',body='<h1>forwarded to firebase default handler</h1>')
  page.route('**/qa-project.firebaseapp.com/**',fwd)

  # 1. Signed-in-unverified, failing link: existing recovery card with resend + watcher copy.
  page.goto('http://localhost:4188/?qa_auth_state=unverified&qa_action_result=fail&mode=verifyEmail&oobCode=BAD')
  page.get_by_role('heading',name='Check your',exact=False).wait_for(timeout=8000)
  body=page.locator('body').inner_text()
  checks['signed_in_fail_keeps_watcher']='keeps checking' in body
  checks['signed_in_fail_error']='That verification link did not work.' in body
  checks['signed_in_fail_resend']=page.get_by_role('button',name='Resend verification email',exact=False).count()==1
  page.screenshot(path=f'{OUT}/verify-signed-in-fail-390.png')

  # 2. Signed-out, failing link: honest card, sign-in CTA, no watcher promise, no resend.
  page.goto('http://localhost:4188/?qa_auth_state=out&qa_action_result=fail&mode=verifyEmail&oobCode=BAD')
  page.get_by_text('That verification link did not work.',exact=True).wait_for(timeout=8000)
  body=page.locator('body').inner_text()
  checks['signed_out_fail_no_watcher_copy']='keeps checking' not in body
  checks['signed_out_fail_error']='That verification link did not work.' in body
  checks['signed_out_fail_no_resend']=page.get_by_role('button',name='Resend verification email',exact=False).count()==0
  checks['signed_out_fail_signin_cta']=page.get_by_role('button',name='Sign in',exact=True).count()>=1
  page.screenshot(path=f'{OUT}/verify-signed-out-fail-390.png')

  # 3. Signed-out, successful link: confirmed state with sign-in CTA (no false "check inbox").
  page.goto('http://localhost:4188/?qa_auth_state=out&qa_action_result=ok&mode=verifyEmail&oobCode=GOOD')
  page.get_by_text('verified.',exact=False).first.wait_for(timeout=8000)
  body=page.locator('body').inner_text()
  checks['signed_out_success_confirms']="You're" in body and 'verified' in body
  checks['signed_out_success_no_checkinbox']='Check your' not in body
  page.screenshot(path=f'{OUT}/verify-signed-out-success-390.png')

  # 4. recoverEmail: forwarded untouched to the default handler.
  forwarded.clear()
  page.goto('http://localhost:4188/?mode=recoverEmail&oobCode=REC123&apiKey=qa')
  page.wait_for_timeout(3000)
  checks['recover_forwarded']=any(u.startswith('https://qa-project.firebaseapp.com/__/auth/action') and 'mode=recoverEmail' in u and 'oobCode=REC123' in u for u in forwarded)

  # 4b. Token hygiene: action params left the live URL before analytics could
  # send a pageview, and the stash held them for the app.
  page.goto('http://localhost:4188/?mode=verifyEmail&oobCode=SECRET123&qa_auth_state=out&qa_action_result=ok')
  page.wait_for_timeout(2500)
  checks['url_stripped_of_token']='oobCode' not in page.url and 'SECRET123' not in page.url
  checks['qa_params_survive_strip']='qa_auth_state=out' in (page.evaluate('window.__qaParams') or '')
  stash=page.evaluate('sessionStorage.getItem("marketmind.email-action")')
  checks['stash_cleared_after_handling']=stash is None

  # 5. Unknown future mode: also forwarded untouched.
  forwarded.clear()
  page.goto('http://localhost:4188/?mode=someFutureMode&oobCode=FUT9')
  page.wait_for_timeout(3000)
  checks['unknown_forwarded']=any('mode=someFutureMode' in u and 'oobCode=FUT9' in u for u in forwarded)

  # 6. resetPassword still renders the app's own reset form (regression guard).
  page.goto('http://localhost:4188/?mode=resetPassword&oobCode=RESET1')
  page.get_by_text('Choose a new',exact=False).wait_for(timeout=8000)
  checks['reset_form_renders']=page.locator('#reset-form').count()==1
  page.screenshot(path=f'{OUT}/reset-form-390.png')

  # 7. Signed-in-unverified with NO action params: unchanged original card.
  page.goto('http://localhost:4188/?qa_auth_state=unverified#verify-email')
  page.get_by_role('heading',name='Check your',exact=False).wait_for(timeout=8000)
  checks['plain_signed_in_card']=page.get_by_role('button',name='Resend verification email',exact=False).count()==1
  checks['no_page_errors']=not errors
  checks['no_analytics_sent']=not external
  b.close()
finally:
 srv.terminate()
print(json.dumps(checks,indent=1))
if errors: print('PAGE ERRORS:',errors)
sys.exit(0 if all(checks.values()) else 1)
