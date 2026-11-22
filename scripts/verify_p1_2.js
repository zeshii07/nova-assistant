// Verify P1-2 fixes (H2b threshold + H8 leak) end-to-end against the real index.
'use strict';
const path = require('path');
const { FileKnowledgeRepository } = require('/home/z/my-project/nova-assistant/packages/knowledge/src/fileKnowledgeRepository');
const KS = require('/home/z/my-project/nova-assistant/packages/assistant/src/knowledgeService');

const repo = new FileKnowledgeRepository({
  tenantsDir: path.resolve('/home/z/my-project/nova-assistant/tenants'),
  knowledgeDataDir: path.resolve('/home/z/my-project/nova-assistant/tenants'),
  logger: null,
});
const ks = new KS.KnowledgeService({ knowledgeRepository: repo });
const tenant = { id: 'public-product' };

function leakHit(h) {
  return /messagingRules|messaging rules|Avoid technical jargon in the first/i.test(h.text || '');
}

console.log('=== H8 fix (full): messagingRules / config text fully out of index ===');
const idx = repo.getIndexForTenant('public-product');
const hits = idx.search('avoid technical jargon', { limit: 5, minScore: 0 });
const leakHits = hits.filter(leakHit);
console.log('  search "avoid technical jargon" ->', hits.length, 'hits,', leakHits.length, 'leak hits (must be 0)');
for (const h of hits.slice(0, 2)) console.log('    remaining:', h.source, '|', JSON.stringify(h.text?.slice(0, 60)));

console.log('\n=== H8: retrieve(lol) no longer returns leaked config ===');
const rl = ks.retrieve('lol', tenant);
console.log('  answerable=' + rl.answerable + ' conf=' + rl.confidence.toFixed(3) + ' top=' + (rl.matches[0] ? JSON.stringify(rl.matches[0].text?.slice(0, 60)) : '(none)'));

console.log('\n=== H2b: low-relevance queries abstain (answerable=false) ===');
const lowQ = ['kab khulte ho', 'tell me a joke', 'are you guys open on sunday', 'not interested', '2', 'ok', 'help'];
let stillAns = 0;
for (const q of lowQ) {
  const r = ks.retrieve(q, tenant);
  if (r.answerable) stillAns++;
  console.log('  [' + q + '] ans=' + r.answerable + ' conf=' + r.confidence.toFixed(3));
}
console.log('  still answering low-relevance:', stillAns, '(must be 0)');

console.log('\n=== H2b: known-good answers still work (answerable=true) ===');
const goodQ = ['what is nova', 'how much does nova cost', 'do you integrate with shopify', 'can nova take payments'];
let g = 0;
for (const q of goodQ) {
  const r = ks.retrieve(q, tenant);
  if (r.answerable) g++;
  console.log('  [' + q + '] ans=' + r.answerable + ' conf=' + r.confidence.toFixed(3));
}
console.log('  good answered:', g, '/', goodQ.length, '(should be >= 3)');
