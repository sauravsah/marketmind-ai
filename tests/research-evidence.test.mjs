import test from 'node:test';
import assert from 'node:assert/strict';
import {selectResearchEvidence,validateResearchEvidence} from '../js/research-evidence.js';
const sources=[{id:'redacted',title:'Revenue',snippet:'Revenue reached *** million USD.',quality:{score:.99}}, {id:'homepage',title:'Category Expo',snippet:'Explore the latest announcement ...',quality:{score:.9}}, {id:'dated',title:'Category Expo Korea',snippet:'Category Expo Korea runs 15th - 17th October 2026.',quality:{score:.2}}, {id:'offer',title:'Distributor',snippet:'We help businesses source and import products.',quality:{score:.8}}, {id:'report',title:'Buyer interviews',snippet:'Interview participants reported purchasing products monthly.',quality:{score:.1}}];
test('selection reserves complete date context over publisher rank, never sends redacted/truncated spans',()=>{
 const before=JSON.stringify(sources);for(const maxSources of [2,5,10]){const result=selectResearchEvidence(sources,{maxSources});assert.equal(result.packet[0].id,'dated');assert.ok(!result.packet.some(s=>s.id==='redacted'||s.id==='homepage'));assert.ok(result.diagnostics.some(x=>x.reason==='redacted-span'));}assert.equal(JSON.stringify(sources),before);
});
test('offer context cannot establish audience behavior and original candidate remains in audit',()=>{
 const contract=selectResearchEvidence(sources),candidate={researchSummary:'Buyers love the offer.',audienceSignals:[{summary:'Buyers use the service.',evidence:[{sourceId:'offer',quote:sources[3].snippet}]}]};
 const output=validateResearchEvidence(candidate,contract);assert.equal(output.audienceSignals.length,0);assert.equal(output.researchSummary,'');assert.equal(output.evidenceAudit.rejectedCandidates.length,1);assert.deepEqual(output.evidenceAudit.originalCandidate,candidate);assert.equal(output.evidenceAudit.audienceEvidence,'insufficient');
});
test('exact provenance binds draft to final packet and summary excludes rejected candidates',()=>{
 const contract=selectResearchEvidence(sources,{maxSources:1});const candidate={researchSummary:'Free unsupported summary.',events:[{summary:'The expo ran in October 2026.',evidence:[{sourceId:'dated',quote:sources[2].snippet}]}],marketSignals:[{summary:'Rejected claim',evidence:[{sourceId:'offer',quote:sources[3].snippet}]}]};
 const output=validateResearchEvidence(candidate,contract);assert.equal(output.events.length,1);assert.equal(output.marketSignals.length,0);assert.ok(!output.researchSummary.includes('Free unsupported'));assert.ok(!output.researchSummary.includes('Rejected claim'));assert.equal(output.evidenceAudit.originalCandidate.researchSummary,candidate.researchSummary);
});
test('conflicting raw spans are retained, not reconciled into invented consensus',()=>{
 const contradictory=[{id:'a',title:'First report',snippet:'The category grew in 2025.'},{id:'b',title:'Second report',snippet:'The category shrank in 2025.'}];const contract=selectResearchEvidence(contradictory);assert.equal(contract.packet.length,2);assert.equal(contract.packet[0].snippet,contradictory[0].snippet);assert.equal(contract.packet[1].snippet,contradictory[1].snippet);
});
import { synthesizeResearch } from '../js/services/ai.js';
import { assertResearchReadyForAnalysis } from '../js/research-readiness.js';
import { researchMarket } from '../js/services/research.js';
test('no eligible packet ends before an AI call',async()=>{
 let aiCalls=0;
 const result=await researchMarket({strategy:{researchDepth:'quick'}},{search:{provider:'serper',apiKey:'test'},ai:{apiKey:'test'}},{fetchImpl:async url=>{
  if(!url.includes('serper.dev')) {aiCalls++;throw Error('unexpected AI call');}
  return new Response(JSON.stringify({organic:[{title:'Revenue',link:'https://example.test/redacted',snippet:'Revenue reached *** million USD.'}]}));
 }});
 assert.equal(aiCalls,0);assert.equal(result.evidenceAudit.acceptedSignalCount,0);assert.equal(result.sources.length,1);
});
test('unflagged provenance-linked draft is not blanket-blocked',()=>{
 const validated=validateResearchEvidence({events:[{summary:'The expo took place in October 2026.',evidence:[{sourceId:'dated',quote:sources[2].snippet}]}]},selectResearchEvidence(sources));assert.doesNotThrow(()=>assertResearchReadyForAnalysis(validated));
});
test('AI output is bound to the actual tightened packet used on the request',async()=>{
 const many=Array.from({length:10},(_,i)=>({id:`s${i}`,title:`Report ${i}`,snippet:`Source ${i} reports a bounded category observation with enough detail for comparison.`,quality:{score:.5}}));let calls=0;
 const result=await synthesizeResearch({},many,{apiKey:'test',promptTokenBudget:1600,maxTokens:10},{fetchImpl:async(url,init)=>{calls++;const packet=JSON.parse(JSON.parse(init.body).messages[1].content).sourcePacket;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({marketSignals:[{summary:'A provisional category observation.',evidence:[{sourceId:packet[0].id,quote:packet[0].evidenceSpans[0]}]}]})}}]}));}});
 assert.equal(calls,1);assert.ok(result.evidenceContract.packet.length<=5);assert.equal(validateResearchEvidence(result.candidate,result.evidenceContract).marketSignals.length,1);
});
import {validateAudienceProfile} from '../js/services/audience.js';
test('missing buyer evidence demotes observed draft claims without upgrading hypotheses',()=>{
 const profile=validateAudienceProfile({observedBehaviors:[{statement:'Buyers use the distributor.',evidenceType:'observed',sourceIds:['offer']}],hypotheses:[{statement:'Buyers may value support.',evidenceType:'hypothesis'}]},[{id:'offer'}],{research:{evidenceAudit:{audienceEvidence:'insufficient'}}});
 assert.equal(profile.observedBehaviors[0].evidenceType,'inferred');assert.equal(profile.hypotheses[0].evidenceType,'hypothesis');assert.ok(profile.uncertainties.some(x=>x.statement.includes('did not establish')));
});
test('known factual errors still block draft research',()=>{
 const output=validateResearchEvidence({events:[{summary:'Upcoming expo in October 2026.',evidence:[{sourceId:'dated',quote:sources[2].snippet}]}]},selectResearchEvidence(sources));assert.throws(()=>assertResearchReadyForAnalysis(output),e=>e.code==='research-needs-review');
});
test('reported consumer context does not automatically establish observed target-buyer behavior',()=>{
 const profile=validateAudienceProfile({observedBehaviors:[{statement:'Retail buyers follow creators.',evidenceType:'observed',sourceIds:['report']}]},[{id:'report'}],{research:{evidenceAudit:{audienceEvidence:'reported-context-only-target-match-unverified'}}});assert.equal(profile.observedBehaviors[0].evidenceType,'inferred');
});
