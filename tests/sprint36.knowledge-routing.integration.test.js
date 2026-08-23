const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const {normalizeText}=require('../packages/knowledge/src/knowledgeNormalizer');
const {KnowledgeIndex}=require('../packages/knowledge/src/knowledgeIndex');
const {InterruptionEngine}=require('../packages/conversation-intelligence/src/interruptionEngine');

test('markdown headings retain their section body and bullets',()=>{
 const docs=normalizeText('extra.md','# Cleaning\nIntro.\n\n## Service Area\nSparkleCare serves:\n- Johar Town\n- DHA Lahore\n- Gulberg\n\n## Parking\nCustomer pays parking.');
 const area=docs.find(x=>x.path==='Service Area');assert.ok(area);assert.match(area.text,/Johar Town/);assert.match(area.text,/DHA Lahore/);
});
test('knowledge ranking prefers heavy furniture policy over unrelated Sunday policy',()=>{
 const docs=normalizeText('extra.md','## Furniture Moving\nCleaners should not move very heavy furniture, wardrobes or large appliances because of safety risk.\n\n## Weekend Service\nSpecial Sunday cleaning may occasionally be arranged manually.');
 const idx=new KnowledgeIndex(docs);const hits=idx.search('Can your cleaner move my heavy wardrobe?',{minScore:.28});
 assert.equal(hits[0].path,'Furniture Moving');
});
test('active workflow recognizes generic business knowledge questions as interruptions',()=>{
 const state={capabilityState:{cleaning:{step:'date'}}};const e=new InterruptionEngine();
 assert.equal(e.detect('will you pay for parking?',state).type,'business_question');
 assert.equal(e.detect('can your cleaner move my wardrobe?',state).type,'business_question');
});
