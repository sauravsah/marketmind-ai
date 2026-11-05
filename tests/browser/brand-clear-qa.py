from playwright.sync_api import sync_playwright
import subprocess,json,os
from pathlib import Path
MOCK='''
const read=()=>JSON.parse(localStorage.getItem('qa.mock-cloud')||'{}');
const api={doc:(p,...s)=>({path:(p.path||'db')+'/'+s.join('/')}),collection:(p,...s)=>({path:(p.path||'db')+'/'+s.join('/')}),getDoc:async r=>({exists:()=>!!read()[r.path],data:()=>read()[r.path]}),getDocs:async r=>({docs:Object.entries(read()).filter(([k])=>k.startsWith(r.path+'/')).map(([,v])=>({data:()=>v}))}),setDoc:async(r,d)=>{const docs=read();docs[r.path]=d;localStorage.setItem('qa.mock-cloud',JSON.stringify(docs));}};
const user={id:'brand-qa',uid:'brand-qa',email:'qa@example.invalid',emailVerified:true};
export const authService={init:async()=>({configured:true,user,session:{user}}),getClient:async()=>({db:{},firestoreApi:api}),onAuthStateChange:async()=>({data:{subscription:{unsubscribe(){}}}}),getIdToken:async()=>null,signOut:async()=>({})};
export const emailActionParams=()=>new URLSearchParams(location.search);
export const authErrorMessage=e=>e.message;export const authenticatedFetch=(i,o)=>fetch(i,o);
export const describeEmailActionError=()=>({title:'x',body:'y'});
'''
voice={'tone':'Friendly & Conversational','personality':['Intelligent'],'communicationStyle':'','preferredWords':'','avoidWords':'','examples':[''],'strictness':'balanced','additionalGuidelines':''}
mm_brand={'name':'MarketMind','industry':'B2B software','description':'GTM research tool','website':'','audience':'founders','voice':voice}
areum_brand={'name':'AREUM','industry':'Beauty','description':'Skincare','website':'','audience':'Gen Z','voice':voice}
def strat(sid,idea,extra=None):
    s={'id':sid,'idea':idea,'audience':'','platforms':[],'objective':'Launch','market':'India','competitors':[],'researchDepth':'balanced','brandId':'local-brand','brandSnapshot':None,'brandPinnedAt':None,'status':'draft','createdAt':'2026-11-01T10:00:00.000Z','updatedAt':'2026-11-01T10:00:00.000Z','research':None,'audienceInsights':None,'opportunityRadar':None,'selectedOpportunityId':None,'campaignStrategy':None}
    s.update(extra or {}); return s
legacy=strat('strat-legacy','Legacy brief without a pin')
pinned=strat('strat-pinned','AREUM pinned brief',{'brandSnapshot':areum_brand,'brandPinnedAt':'2026-11-02T10:00:00.000Z','updatedAt':'2026-11-04T10:00:00.000Z','research':{'researchSummary':'done','marketSignals':[],'audienceSignals':[],'industryDevelopments':[],'culturalSignals':[],'competitorSignals':[],'events':[],'technologySignals':[],'emergingThemes':[],'contradictions':[],'sources':[{'id':'s1','url':'https://example.com','title':'Example'}],'activeRunId':None,'runs':[],'meta':{'researchedAt':'2026-11-04T10:00:00.000Z','depth':'balanced','queryCount':1,'sourcesReviewed':1,'sourcesUsed':1,'providerStatus':'ok','aiStatus':'verified','warnings':[],'failures':[]}}})
docs={'db/users/brand-qa':{'ownerId':'brand-qa','name':'QA Workspace','defaultMarket':'','defaultAudience':'','defaultPlatform':'','defaultObjective':'','brandProfile':mm_brand,'metadata':{}}}
for st in (legacy,pinned):
    docs[f"db/users/brand-qa/strategies/{st['id']}"]={'ownerId':'brand-qa','legacyId':st['id'],'payload':st,'updatedAt':st['createdAt']}
seed=f"localStorage.setItem('qa.mock-cloud', {json.dumps(json.dumps(docs))});"

P=str(Path(__file__).resolve().parents[2]); OUT=os.environ.get('QA_OUTPUT_DIR','/tmp/brand-clear');os.makedirs(OUT,exist_ok=True)
original={**mm_brand,'name':'','description':'','website':'','industry':'B2B software','audience':'Businesses'}
original['voice']={**voice,'personality':['Warm','Intelligent','Direct'],'communicationStyle':'Clear, human, and useful. Lead with the insight, then make the next step feel easy.','examples':[]}
docs['db/users/brand-qa']['brandProfile']=areum_brand
docs['db/users/brand-qa']['metadata']={'preserve':'unchanged'}
seed="if(!localStorage.getItem('qa.mock-cloud'))localStorage.setItem('qa.mock-cloud',"+json.dumps(json.dumps(docs))+');'
srv=subprocess.Popen(['node','server.mjs'],cwd=P,env={**os.environ,'PORT':'4193'},stdout=subprocess.DEVNULL)
try:
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
  for width in [1280,390]:
   page=b.new_page(viewport={'width':width,'height':900},reduced_motion='reduce'); calls=[];errors=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   page.route('**/js/auth.js',lambda r:r.fulfill(content_type='text/javascript',body=MOCK))
   def api(r): calls.append(r.request.url);r.abort()
   page.route('**/api/**',api);page.add_init_script(seed)
   page.goto('http://localhost:4193/#brand'); page.locator('#brand-form').wait_for()
   before=page.evaluate("JSON.parse(localStorage.getItem('qa.mock-cloud'))")
   # Set five profile fields and retain all voice controls as rendered.
   for sel,val in [('name',''),('description',''),('website',''),('industry','B2B software'),('audience','Businesses')]: page.locator('#brand-'+sel).fill(val)
   expected={**areum_brand,**{k:original[k] for k in ['name','description','website','industry','audience']}}
   expected['voice']={**areum_brand['voice'],'examples':[]}
   page.get_by_role('button',name='Save brand voice',exact=True).click()
   page.wait_for_function("JSON.parse(localStorage.getItem('qa.mock-cloud'))['db/users/brand-qa'].brandProfile.industry==='B2B software'")
   after=page.evaluate("JSON.parse(localStorage.getItem('qa.mock-cloud'))")
   assert after['db/users/brand-qa']['brandProfile']==expected,after
   for key,value in before.items():
    if '/strategies/' in key: assert after[key]==value
   assert after['db/users/brand-qa']['metadata']==before['db/users/brand-qa']['metadata']
   page.reload();page.locator('h1,h2').first.wait_for();page.goto('http://localhost:4193/#brand');page.locator('#brand-form').wait_for()
   assert page.locator('#brand-name').input_value()=='' and page.locator('#brand-description').input_value()==''
   assert page.locator('#brand-industry').input_value()=='B2B software'
   page.screenshot(path=f'{OUT}/brand-cleared-{width}.png',full_page=True)
   assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
   assert not errors and not calls,(errors,calls)
   page.goto('http://localhost:4193/#history');page.locator('.history-page').wait_for()
   assert 'Pinned brand · AREUM' in page.locator('.history-page').inner_text()
   page.screenshot(path=f'{OUT}/history-unchanged-{width}.png',full_page=True)
   print(json.dumps({'width':width,'empty_save_reload':True,'other_workspace_fields_preserved':True,'strategy_payloads_unchanged':True,'generation_calls':len(calls),'page_errors':errors}))
   page.close()
  b.close()
finally:srv.terminate();srv.wait()
