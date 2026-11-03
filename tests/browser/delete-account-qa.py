# Account-deletion QA: real app code against stubbed Firebase Auth + Firestore.
# Verifies the dialog UX, confirmation rules, deletion ORDER (reauth -> strategy
# docs -> workspace doc -> auth record), local cleanup, and the signed-out
# confirmation. Localhost only; analytics and /api aborted.
from playwright.sync_api import sync_playwright
import subprocess, os, json, sys
P='/downloads/marketmind'; OUT='/tmp/marketmind-delete-qa'; os.makedirs(OUT,exist_ok=True)
CONFIG=json.dumps({"firebase":{"apiKey":"qa","authDomain":"qa-project.firebaseapp.com","projectId":"qa","storageBucket":"","messagingSenderId":"","appId":"qa"}})
APP_STUB="export const getApps=()=>[];export const getApp=()=>({options:{}});export const initializeApp=(c)=>({options:c});"
AUTH_STUB='''
const user={uid:'qa-delete',email:'qa@example.invalid',emailVerified:true,displayName:'',metadata:{}};
window.__calls=[];
export const browserLocalPersistence={};
export const getAuth=(app)=>({currentUser:user,app});
export const setPersistence=async()=>{};
export const onAuthStateChanged=(auth,cb)=>{setTimeout(()=>cb(auth.currentUser),0);return()=>{};};
export const applyActionCode=async()=>{};
export const reload=async()=>{};
export const confirmPasswordReset=async()=>{};
export const createUserWithEmailAndPassword=async()=>{throw new Error('qa: unused');};
export const signInWithEmailAndPassword=async()=>{throw new Error('qa: unused');};
export const sendEmailVerification=async()=>{};
export const sendPasswordResetEmail=async()=>{};
export const signOut=async()=>{window.__calls.push('signOut');};
export const EmailAuthProvider={credential:(email,password)=>({email,password})};
export const reauthenticateWithCredential=async(u,cred)=>{window.__calls.push('reauthenticate');if(cred.password==='wrong-password'){const e=new Error('wrong');e.code='auth/wrong-password';throw e;}};
export const deleteUser=async(u)=>{window.__calls.push('deleteUser');};
'''
FS_STUB='''
const store=new Map([
 ['db/users/qa-delete',{name:'QA Workspace',brandProfile:{name:'Stride QA'}}],
 ['db/users/qa-delete/strategies/s1',{payload:{id:'s1',idea:'First brief',updatedAt:'2026-01-01'}}],
 ['db/users/qa-delete/strategies/s2',{payload:{id:'s2',idea:'Second brief',updatedAt:'2026-01-02'}}],
]);
export const getFirestore=()=>({});
export const doc=(parent,...s)=>({path:(parent.path||'db')+'/'+s.join('/')});
export const collection=(parent,...s)=>({path:(parent.path||'db')+'/'+s.join('/')});
export const getDoc=async r=>({exists:()=>store.has(r.path),data:()=>store.get(r.path)});
export const getDocs=async r=>({docs:[...store.keys()].filter(k=>k.startsWith(r.path+'/')).map(k=>({ref:{path:k},data:()=>store.get(k)}))});
export const setDoc=async(r,d)=>{store.set(r.path,{...(store.get(r.path)||{}),...d});};
export const deleteDoc=async(r)=>{window.__calls.push('deleteDoc:'+r.path);store.delete(r.path);};
'''
checks={}
srv=subprocess.Popen(['node','server.mjs'],cwd=P,env={**os.environ,'PORT':'4190'},stdout=subprocess.DEVNULL)
try:
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
  page=b.new_page(viewport={'width':1280,'height':900},reduced_motion='reduce')
  errors=[];external=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('**/*',lambda r:(external.append(r.request.url) or r.abort()) if any(d in r.request.url for d in ('googletagmanager','google-analytics','saurav-analytics')) else (r.abort() if '/api/' in r.request.url else r.continue_()))
  page.route('**/api/public-runtime-config',lambda r:r.fulfill(status=200,content_type='application/json',body=CONFIG))
  page.route('**/firebasejs/**/firebase-app.js',lambda r:r.fulfill(status=200,content_type='text/javascript',body=APP_STUB))
  page.route('**/firebasejs/**/firebase-auth.js',lambda r:r.fulfill(status=200,content_type='text/javascript',body=AUTH_STUB))
  page.route('**/firebasejs/**/firebase-firestore.js',lambda r:r.fulfill(status=200,content_type='text/javascript',body=FS_STUB))
  # Seed a local copy for this account so cleanup is observable.
  page.goto('http://localhost:4190/#landing')
  page.evaluate("localStorage.setItem('marketmind.account.qa-delete.strategies','[]');localStorage.setItem('marketmind.account.qa-delete.brand-profile','{}')")
  page.goto('http://localhost:4190/#workspace')
  page.get_by_role('heading',name='Set the context',exact=False).wait_for(timeout=10000)
  # Danger zone visible with live strategy count.
  checks['danger_zone_lists_scope']=page.get_by_text('2 saved strategies',exact=False).count()==1
  page.get_by_role('button',name='Delete my account',exact=True).click()
  page.get_by_role('heading',name='Delete your',exact=False).wait_for()
  checks['dialog_lists_limits']=page.get_by_text('cannot be removed',exact=False).count()==1
  page.screenshot(path=f'{OUT}/delete-dialog-1280.png')
  # Typed confirmation required.
  page.locator('#delete-account-password').fill('correct-password')
  page.locator('#delete-account-confirm').fill('delete')
  page.get_by_role('button',name='Permanently delete my account',exact=True).click()
  page.get_by_text('Type DELETE in capitals',exact=False).wait_for()
  checks['typed_confirmation_enforced']=True
  # Wrong password: nothing deleted.
  page.locator('#delete-account-confirm').fill('DELETE')
  page.locator('#delete-account-password').fill('wrong-password')
  page.get_by_role('button',name='Permanently delete my account',exact=True).click()
  page.get_by_text('did not match',exact=False).wait_for(timeout=8000)
  calls=page.evaluate('window.__calls')
  checks['wrong_password_deletes_nothing']=calls==['reauthenticate']
  checks['wrong_password_error']=True
  page.screenshot(path=f'{OUT}/delete-wrong-password-1280.png')
  # Correct password: full ordered deletion.
  page.locator('#delete-account-password').fill('correct-password')
  page.locator('#delete-account-confirm').fill('DELETE')
  page.get_by_role('button',name='Permanently delete my account',exact=True).click()
  page.get_by_text('were deleted.',exact=False).wait_for(timeout=8000)
  calls=page.evaluate('window.__calls')
  checks['deletion_order']=calls==['reauthenticate','reauthenticate','deleteDoc:db/users/qa-delete/strategies/s1','deleteDoc:db/users/qa-delete/strategies/s2','deleteDoc:db/users/qa-delete','deleteUser']
  checks['local_copy_removed']=page.evaluate("Object.keys(localStorage).filter(k=>k.includes('qa-delete')).length")==0
  checks['signed_out_confirmation']=page.locator('body').inner_text().find('were deleted.')>=0
  page.screenshot(path=f'{OUT}/delete-done-1280.png')
  checks['no_page_errors']=not errors
  checks['no_analytics']=not external

  # Mobile 390: dialog fits without horizontal overflow, wrong-password tall
  # state keeps the confirm field and delete button reachable.
  m=b.new_page(viewport={'width':390,'height':844},reduced_motion='reduce')
  m.route('**/*',lambda r:r.abort() if '/api/' in r.request.url or 'analytics' in r.request.url or 'googletagmanager' in r.request.url else r.continue_())
  m.route('**/api/public-runtime-config',lambda r:r.fulfill(status=200,content_type='application/json',body=CONFIG))
  m.route('**/firebasejs/**/firebase-app.js',lambda r:r.fulfill(status=200,content_type='text/javascript',body=APP_STUB))
  m.route('**/firebasejs/**/firebase-auth.js',lambda r:r.fulfill(status=200,content_type='text/javascript',body=AUTH_STUB))
  m.route('**/firebasejs/**/firebase-firestore.js',lambda r:r.fulfill(status=200,content_type='text/javascript',body=FS_STUB))
  m.goto('http://localhost:4190/#workspace')
  m.get_by_role('heading',name='Set the context',exact=False).wait_for(timeout=10000)
  m.get_by_role('button',name='Delete my account',exact=True).click()
  m.get_by_role('heading',name='Delete your',exact=False).wait_for()
  checks['mobile_dialog_no_hoverflow']=m.evaluate('document.documentElement.scrollWidth<=391')
  m.locator('#delete-account-password').fill('wrong-password')
  m.locator('#delete-account-confirm').fill('DELETE')
  m.get_by_role('button',name='Permanently delete my account',exact=True).click()
  m.get_by_text('did not match',exact=False).wait_for(timeout=8000)
  btn=m.get_by_role('button',name='Permanently delete my account',exact=True)
  btn.scroll_into_view_if_needed()
  checks['mobile_confirm_button_reachable']=btn.is_visible()
  checks['mobile_error_visible']=m.get_by_text('Nothing was deleted.',exact=False).is_visible()
  m.screenshot(path=f'{OUT}/delete-dialog-wrong-password-390.png',full_page=True)
  m.close()
  b.close()
finally:
 srv.terminate()
print(json.dumps(checks,indent=1))
if errors: print('PAGE ERRORS:',errors)
sys.exit(0 if all(v is True for v in checks.values()) else 1)
