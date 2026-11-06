import test from 'node:test';
import assert from 'node:assert/strict';
import { applyResearchConsistency, applyAudienceClaimConsistency } from '../js/services/claim-consistency.js';
import { validateAudienceProfile } from '../js/services/audience.js';
import { buildResearchSynthesisPrompt } from '../js/prompts/research.js';
import { buildAudienceAnalysisPrompt } from '../js/prompts/audience.js';
const now = new Date('2026-11-06T00:00:00Z');
const guide = { id:'guide',title:'Import Korean Cosmetics to India | BIS & CDSCO Guide 2026',snippet:'Complete guide for Korean cosmetics importers in India. Learn about BIS certification, CDSCO registration, customs duties, and how to source authentic K-Beauty products from Korea.' };
const service = { id:'service',title:'Areum Nexus',snippet:'AREUM NEXUS connects Korean brands with India. We help Indian businesses source, import and build partnerships with Korean brands and products.' };
test('past expo is not cleared by a future forecast in another summary sentence',()=>{
 const research={researchSummary:'Forecasts reach USD 872 million by 2032. Upcoming industry events such as the 2026 K-Beauty Expo Korea provide networking opportunities.',meta:{}};
 applyResearchConsistency(research,[{id:'expo',snippet:'K-Beauty Expo Korea 2026 will from 15th - 17th October 2026 at KINTEX.'}],now);
 assert.ok(research.meta.claimFlags.some(f=>f.reason==='past-date-framed-as-upcoming'));
});
test('guide readership and service usage are inference, not observed behavior',()=>{
 const profile={observedBehaviors:[{statement:'Importers consult guides on BIS certification, CDSCO registration, and customs duties',evidenceType:'observed',sourceIds:['guide']},{statement:'Indian businesses source and import Korean beauty brands through partners like AREUM NEXUS',evidenceType:'observed',sourceIds:['service']}],meta:{}};
 applyAudienceClaimConsistency(profile,[guide,service],now);
 assert.deepEqual(profile.observedBehaviors.map(i=>i.evidenceType),['inferred','inferred']);
 assert.equal(profile.meta.labelAdjustments.length,2);
});
test('reported readership is not demoted by this narrow floor',()=>{
 const profile={observedBehaviors:[{statement:'Importers consult guides on certification',evidenceType:'observed',sourceIds:['guide']}],meta:{}};
 applyAudienceClaimConsistency(profile,[{...guide,snippet:'Survey respondents reported consulting guides on certification.'}],now);
 assert.equal(profile.observedBehaviors[0].evidenceType,'observed');
});
test('inferred behavior is never upgraded to observed by its collection name',()=>{
 const profile=validateAudienceProfile({observedBehaviors:[{statement:'Importers may consult guides',evidenceType:'inferred',sourceIds:['guide']}]},[guide]);
 assert.equal(profile.observedBehaviors[0].evidenceType,'inferred');
});
test('both prompts ground today in the analysis date',()=>{
 for(const prompt of [buildResearchSynthesisPrompt({now},[]),buildAudienceAnalysisPrompt({now},[])])assert.equal(JSON.parse(prompt.user).analysisDate,'2026-11-06');
});
test('service offer does not demote a direct report of buyer use',()=>{
 const profile={observedBehaviors:[{statement:'Indian businesses source and import Korean beauty brands',evidenceType:'observed',sourceIds:['service']}],meta:{}};
 applyAudienceClaimConsistency(profile,[{...service,snippet:'Interview participants from Indian businesses reported purchasing Korean skincare through this service.'}],now);
 assert.equal(profile.observedBehaviors[0].evidenceType,'observed');
});
test('future event in the same sentence remains future and not flagged',()=>{
 const research={researchSummary:'The upcoming expo runs in March 2027.',meta:{}};
 applyResearchConsistency(research,[{id:'expo',snippet:'The prior expo ran in October 2026; next edition in March 2027.'}],now);
 assert.equal(research.meta.claimFlags,undefined);
});
test('summary event dates exclude unrelated historical market figures',()=>{
 const research={researchSummary:'Upcoming K-Beauty Expo Korea provides networking opportunities.',meta:{}};
 applyResearchConsistency(research,[{id:'market',title:'Beauty market growth',snippet:'Market revenues grew in 2018, 2022, 2016 and 2025.'},{id:'expo',title:'K-Beauty Expo Korea',snippet:'K-Beauty Expo Korea runs 15th - 17th October 2026.'}],now);
 const flag=research.meta.claimFlags.find(f=>f.reason==='past-date-framed-as-upcoming');assert.equal(flag.datedMaterial,'October 2026');
});
test('undated upcoming event does not borrow unrelated historical market dates',()=>{
 const research={researchSummary:'The upcoming K-Beauty Expo Korea provides networking opportunities.',meta:{}};
 applyResearchConsistency(research,[{id:'market',title:'Beauty market',snippet:'Revenues reached USD 10 million in 2022.'},{id:'expo',title:'K-Beauty Expo Korea',snippet:'See our event program.'}],now);
 assert.equal(research.meta.claimFlags,undefined);
});
test('future expo is not blocked by a past unrelated expo in the same source set',()=>{
 const research={researchSummary:'Upcoming K-Beauty Expo Korea runs in March 2027.',meta:{}};
 applyResearchConsistency(research,[{id:'old',title:'Food Expo',snippet:'Food Expo ran in October 2026.'}],now);assert.equal(research.meta.claimFlags,undefined);
});
test('same category expo in another location does not donate its past date',()=>{
 const research={researchSummary:'Upcoming K-Beauty Expo Korea provides networking opportunities.',meta:{}};
 applyResearchConsistency(research,[{id:'delhi',title:'K-Beauty Expo Delhi',snippet:'K-Beauty Expo Delhi took place in 2024.'}],now);assert.equal(research.meta.claimFlags,undefined);
});
