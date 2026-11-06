import test from 'node:test';
import assert from 'node:assert/strict';
import { researchNeedsReview, researchReadinessIssues } from '../js/research-readiness.js';
import { researchStageStatus } from '../js/client/intelligence.js';
import { analyzeAudience } from '../js/services/audience.js';
import { identifyOpportunities } from '../js/services/opportunity.js';
import { generateCampaignStrategy } from '../js/services/campaign.js';
const flagged = {researchSummary:'Upcoming (now past) industry events like the K-Beauty Expo Korea provide networking opportunities.',marketSignals:[{title:'Revenue',summary:'In 2022 revenue reached approximately *** million USD.',sourceIds:['s1']}],sources:[{id:'s1',title:'K-Beauty Expo Korea',snippet:'K-Beauty Expo Korea runs in October 2026.',url:'https://example.test/a'},{id:'s2',url:'https://example.test/b'},{id:'s3',url:'https://example.test/c'}],meta:{aiStatus:'verified',researchedAt:'2026-11-06T00:04:49.033Z',claimFlags:[{field:'researchSummary',reason:'past-date-framed-as-upcoming',detail:'October 2026'}]}};
test('known bad synthesis is not a completed research stage; originals remain intact',()=>{
 const before=JSON.stringify(flagged);
 assert.equal(researchStageStatus(flagged),'partial');assert.equal(researchNeedsReview(flagged),true);assert.equal(researchReadinessIssues(flagged).length,2);assert.equal(JSON.stringify(flagged),before);
});
test('all downstream services refuse flagged research before any provider call',async()=>{
 let calls=0;const options={fetchImpl:async()=>{calls++;throw Error('must not call');}};
 for(const run of [analyzeAudience,identifyOpportunities,generateCampaignStrategy])await assert.rejects(run({research:flagged},{ai:{apiKey:'test'}},options),e=>e.code==='research-needs-review');
 assert.equal(calls,0);
});
test('clean numeric source and synthesis are not redaction failures',()=>{
 assert.equal(researchNeedsReview({researchSummary:'Revenue projected at USD 872 million by 2032.',marketSignals:[{summary:'The company reports 310 million USD in 2025.'}]}),false);
});
test('redacted provider excerpt alone is retained as evidence to inspect, not synthesized fact',()=>{
 assert.equal(researchNeedsReview({sources:[{snippet:'Revenue *** million USD'}]}),false);
});
import fs from 'node:fs';
for (const name of ['areum-first-run', 'areum-retest']) {
 test(`sanitized ${name} failure-shape fixture is blocked, including legacy summary without stored flags`, async()=>{
  const research=JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`,import.meta.url)));
  const before=JSON.stringify(research);assert.equal(researchNeedsReview(research),true);assert.equal(researchStageStatus(research),'partial');
  let calls=0;for(const run of [analyzeAudience,identifyOpportunities,generateCampaignStrategy]) await assert.rejects(run({research},{ai:{apiKey:'test'}},{fetchImpl:async()=>{calls++;}}),e=>e.code==='research-needs-review');
  assert.equal(calls,0);assert.equal(JSON.stringify(research),before);
 });
}
test('source-only research-light path remains available without flags',async()=>{
 const result=await analyzeAudience({idea:'A new business',research:null});assert.equal(result.meta.mode,'research-light');
});
test('unflagged research completion is unchanged',()=>{
 const clean=structuredClone(flagged);clean.researchSummary='Three public sources describe the category.';clean.marketSignals[0].summary='Revenue reported at 310 million USD.';delete clean.meta.claimFlags;
 assert.equal(researchStageStatus(clean),'complete');assert.equal(researchNeedsReview(clean),false);
});
test('stale broad temporal metadata is rechecked rather than blocking on unrelated dates',()=>{
 const research={researchSummary:'The upcoming K-Beauty Expo Korea provides networking opportunities.',sources:[{id:'market',title:'Market growth',snippet:'Revenue in 2018 and 2022 grew.'}],meta:{claimFlags:[{field:'researchSummary',reason:'past-date-framed-as-upcoming',detail:'2018, 2022'}]}};
 const before=JSON.stringify(research);assert.equal(researchNeedsReview(research),false);assert.equal(JSON.stringify(research),before);
});
