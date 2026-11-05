/**
 * Sprint 3 — v43.0 Variation Test Corpus
 *
 * 300+ natural-language variations of customer intents, organized by category.
 * Each case is a short conversation (1-3 turns) with explicit expectations
 * about what should happen on the LAST turn.
 *
 * Schema:
 *   {
 *     id:        'ORD-001',                 // unique case id
 *     tenant:    'restaurant-demo',         // tenant id
 *     setup:     ['hello', 'what food...'], // optional setup turns (warm up state)
 *     message:   'i want 2 chicken biryani',// the message under test
 *     expect:    {
 *       capabilityId:  'commerce',          // expected capabilityId on the test message
 *       replyMatches:  [/biryani/i],        // regexes the reply must match
 *       replyNotMatch: [/sorry, i couldn/i] // regexes the reply must NOT match
 *     },
 *     notes:     'why this variation matters'
 *   }
 *
 * Run via: tests/sprint43.variation-coverage.integration.test.js
 */
module.exports = [

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 1: ORDER PLACEMENT — RESTAURANT (English)
  // 25 variations: "i want X", "i'll take X", "can i get X", "gimme X", etc.
  // ═══════════════════════════════════════════════════════════════════════════
  { id: 'ORD-001', tenant: 'restaurant-demo', message: 'i want 1 chicken biryani', expect: { capabilityId: 'commerce', replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'basic order' },
  { id: 'ORD-002', tenant: 'restaurant-demo', message: "i'll take a chicken biryani", expect: { replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure|sorry, we don't/i] }, notes: 'i\'ll take — either catalog or commerce is OK' },
  { id: 'ORD-003', tenant: 'restaurant-demo', message: 'can i get a chicken biryani', expect: { replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure|sorry, we don't/i] }, notes: 'can i get' },
  { id: 'ORD-004', tenant: 'restaurant-demo', message: 'can i have a beef burger', expect: { replyMatches: [/burger/i], replyNotMatch: [/couldn't find|not fully sure|sorry, we don't/i] }, notes: 'can i have' },
  { id: 'ORD-005', tenant: 'restaurant-demo', message: 'gimme a chicken biryani', expect: { replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure|sorry, we don't/i] }, notes: 'informal gimme — either catalog or commerce is OK' },
  { id: 'ORD-006', tenant: 'restaurant-demo', message: 'send me a beef burger', expect: { capabilityId: 'commerce', replyMatches: [/burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'send me' },
  { id: 'ORD-007', tenant: 'restaurant-demo', message: 'bring me one chicken biryani', expect: { capabilityId: 'commerce', replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'bring me' },
  { id: 'ORD-008', tenant: 'restaurant-demo', message: 'pack one alfredo pasta', expect: { capabilityId: 'commerce', replyMatches: [/pasta/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'pack' },
  { id: 'ORD-009', tenant: 'restaurant-demo', message: 'one chicken biryani please', expect: { capabilityId: 'commerce', replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'X please' },
  { id: 'ORD-010', tenant: 'restaurant-demo', message: 'two chicken biryani', expect: { capabilityId: 'commerce', replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'bare quantity' },
  { id: 'ORD-011', tenant: 'restaurant-demo', message: 'lemme get a beef burger', expect: { capabilityId: 'commerce', replyMatches: [/burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'lemme get (informal)' },
  { id: 'ORD-012', tenant: 'restaurant-demo', message: 'let me have one grilled chicken', expect: { capabilityId: 'commerce', replyMatches: [/grilled chicken/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'let me have' },
  { id: 'ORD-013', tenant: 'restaurant-demo', message: 'i would like 2 beef burgers', expect: { capabilityId: 'commerce', replyMatches: [/burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'i would like' },
  { id: 'ORD-014', tenant: 'restaurant-demo', message: "i'd like one alfredo pasta", expect: { capabilityId: 'commerce', replyMatches: [/pasta/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'i\'d like' },
  { id: 'ORD-015', tenant: 'restaurant-demo', message: 'i need a chicken biryani', expect: { capabilityId: 'commerce', replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'i need' },
  { id: 'ORD-016', tenant: 'restaurant-demo', message: 'one plate of chicken biryani', expect: { capabilityId: 'commerce', replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'one plate of' },
  { id: 'ORD-017', tenant: 'restaurant-demo', message: '2 plates of beef burger', expect: { capabilityId: 'commerce', replyMatches: [/burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: '2 plates of' },
  { id: 'ORD-018', tenant: 'restaurant-demo', message: 'i want to order chicken biryani', expect: { capabilityId: 'commerce', replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'i want to order' },
  { id: 'ORD-019', tenant: 'restaurant-demo', message: 'i want to eat beef burger', expect: { capabilityId: 'commerce', replyMatches: [/burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'i want to eat' },
  { id: 'ORD-020', tenant: 'restaurant-demo', message: 'order 2 chicken biryani', expect: { capabilityId: 'commerce', replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'order N X' },
  { id: 'ORD-021', tenant: 'restaurant-demo', message: 'prepare 1 alfredo pasta', expect: { capabilityId: 'commerce', replyMatches: [/pasta/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'prepare' },
  { id: 'ORD-022', tenant: 'restaurant-demo', message: 'please send me a chicken biryani', expect: { capabilityId: 'commerce', replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'please send me' },
  { id: 'ORD-023', tenant: 'restaurant-demo', message: 'i would love a grilled chicken', expect: { capabilityId: 'commerce', replyMatches: [/grilled chicken/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'i would love' },
  { id: 'ORD-024', tenant: 'restaurant-demo', message: 'i will take 2 chicken biryani', expect: { capabilityId: 'commerce', replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'i will take' },
  { id: 'ORD-025', tenant: 'restaurant-demo', message: 'i will have one beef burger', expect: { capabilityId: 'commerce', replyMatches: [/burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'i will have' },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 2: ORDER PLACEMENT — ROMAN URDU
  // 15 variations: chahiye, lena hai, bhej do, ka order karna hai, etc.
  // ═══════════════════════════════════════════════════════════════════════════
  { id: 'ORD-RU-001', tenant: 'restaurant-demo', message: 'mujhe 1 chicken biryani chahiye', expect: { capabilityId: 'commerce', replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'mujhe X chahiye' },
  { id: 'ORD-RU-002', tenant: 'restaurant-demo', message: 'mujhe beef burger lena hai', expect: { capabilityId: 'commerce', replyMatches: [/burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'X lena hai' },
  { id: 'ORD-RU-003', tenant: 'restaurant-demo', message: 'beef burger bhej do', expect: { capabilityId: 'commerce', replyMatches: [/burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'X bhej do' },
  { id: 'ORD-RU-004', tenant: 'restaurant-demo', message: 'chicken biryani ka order karna hai', expect: { capabilityId: 'commerce', replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'X ka order karna hai' },
  { id: 'ORD-RU-005', tenant: 'restaurant-demo', message: 'mujhe 2 chicken biryani chahiyy', expect: { capabilityId: 'commerce', replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'chahiyy typo variation' },
  { id: 'ORD-RU-006', tenant: 'restaurant-demo', message: '2 beef burger lyni hain', expect: { capabilityId: 'commerce', replyMatches: [/burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'lyni hain' },
  { id: 'ORD-RU-007', tenant: 'restaurant-demo', message: 'ek chicken biryani laga do', expect: { capabilityId: 'commerce', replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'ek X laga do' },
  { id: 'ORD-RU-008', tenant: 'restaurant-demo', message: 'ek beef burger kar do', expect: { capabilityId: 'commerce', replyMatches: [/burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'ek X kar do' },
  { id: 'ORD-RU-009', tenant: 'restaurant-demo', message: 'mujhay 2 chicken biryani chahy', expect: { capabilityId: 'commerce', replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'mujhay chahy' },
  { id: 'ORD-RU-010', tenant: 'restaurant-demo', message: 'biryani 2 plate chahiye', expect: { capabilityId: 'commerce', replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'X 2 plate chahiye' },
  { id: 'ORD-RU-011', tenant: 'restaurant-demo', message: 'khana order karna hai', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'generic khana order' },
  { id: 'ORD-RU-012', tenant: 'restaurant-demo', message: 'mujhe biryani chahiye bhi', expect: { replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'X chahiye bhi (also)' },
  { id: 'ORD-RU-013', tenant: 'restaurant-demo', message: 'aur ek beef burger bhi', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'aur ek X bhi (also one more)' },
  { id: 'ORD-RU-014', tenant: 'restaurant-demo', message: 'main 2 chicken biryani order karunga', expect: { replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'main X order karunga' },
  { id: 'ORD-RU-015', tenant: 'restaurant-demo', message: 'biryani pasand hai', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'X pasand hai' },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 3: ORDER PLACEMENT — TYPOS
  // 12 variations: common misspellings
  // ═══════════════════════════════════════════════════════════════════════════
  { id: 'TYP-001', tenant: 'restaurant-demo', message: 'i wnt 1 chicken biryani', expect: { replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'wnt typo' },
  { id: 'TYP-002', tenant: 'restaurant-demo', message: 'i want 1 chiken biryani', expect: { replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'chiken typo' },
  { id: 'TYP-003', tenant: 'restaurant-demo', message: 'i want 1 chicken biriyani', expect: { replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'biriyani typo' },
  { id: 'TYP-004', tenant: 'restaurant-demo', message: 'give me a beef burgar', expect: { replyMatches: [/burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'burgar typo' },
  { id: 'TYP-005', tenant: 'restaurant-demo', message: 'i want some burgrs', expect: { replyMatches: [/burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'burgrs typo plural' },
  { id: 'TYP-006', tenant: 'restaurant-demo', message: 'can i get a beaf burger', expect: { replyMatches: [/burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'beaf typo' },
  { id: 'TYP-007', tenant: 'restaurant-demo', message: 'i want alfredo pastaa', expect: { replyMatches: [/pasta/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'pastaa typo' },
  { id: 'TYP-008', tenant: 'restaurant-demo', message: 'send me a grill chicken', expect: { replyMatches: [/grilled chicken|grill/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'grill typo' },
  { id: 'TYP-009', tenant: 'restaurant-demo', message: 'plz send 1 chicken biryani', expect: { replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'plz abbreviation' },
  { id: 'TYP-010', tenant: 'restaurant-demo', message: 'pls give me a burger', expect: { replyMatches: [/burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'pls abbreviation' },
  { id: 'TYP-011', tenant: 'restaurant-demo', message: 'i wud like 1 biryani', expect: { replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'wud abbreviation' },
  { id: 'TYP-012', tenant: 'restaurant-demo', message: 'i wanna eat chicken biryani', expect: { replyMatches: [/biryani/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'wanna' },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 4: MULTI-ITEM ORDERS
  // 12 variations: "X and Y", "X plus Y", "X aur Y bhi"
  // ═══════════════════════════════════════════════════════════════════════════
  { id: 'MUL-001', tenant: 'restaurant-demo', message: 'i want 2 chicken biryani and 6 beef burgers', expect: { replyMatches: [/biryani/i, /burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'X and Y' },
  { id: 'MUL-002', tenant: 'restaurant-demo', message: '1 chicken biryani, 1 beef burger', expect: { replyMatches: [/biryani/i, /burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'comma separated' },
  { id: 'MUL-003', tenant: 'restaurant-demo', message: '2 biryani plus 2 burger', expect: { replyMatches: [/biryani/i, /burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'plus connector' },
  { id: 'MUL-004', tenant: 'restaurant-demo', message: 'chicken biryani aur beef burger dono', expect: { replyMatches: [/biryani/i, /burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'Roman Urdu aur dono' },
  { id: 'MUL-005', tenant: 'restaurant-demo', message: 'i want chicken biryani, beef burger, and alfredo pasta', expect: { replyMatches: [/biryani/i, /burger/i, /pasta/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: '3 items' },
  { id: 'MUL-006', tenant: 'restaurant-demo', message: 'get me 2 of each — biryani and burger', expect: { replyMatches: [/biryani/i, /burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: '2 of each' },
  { id: 'MUL-007', tenant: 'restaurant-demo', message: 'one biryani one burger', expect: { replyMatches: [/biryani/i, /burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'bare count + name' },
  { id: 'MUL-008', tenant: 'restaurant-demo', message: 'two biryanis and a burger', expect: { replyMatches: [/biryani/i, /burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'plural + singular' },
  { id: 'MUL-009', tenant: 'restaurant-demo', message: 'i need 3 chicken biryani and 3 beef burger', expect: { replyMatches: [/biryani/i, /burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'equal split' },
  { id: 'MUL-010', tenant: 'restaurant-demo', message: 'ek biryani aur ek burger', expect: { replyMatches: [/biryani/i, /burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'Roman Urdu ek X aur ek Y' },
  { id: 'MUL-011', tenant: 'restaurant-demo', message: 'chicken biryani with beef burger', expect: { replyMatches: [/biryani/i, /burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'with connector' },
  { id: 'MUL-012', tenant: 'restaurant-demo', message: 'biryani and also burger', expect: { replyMatches: [/biryani/i, /burger/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'and also' },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 5: QUANTITY MODIFICATIONS
  // 15 variations: change/update/increase/decrease quantity
  // ═══════════════════════════════════════════════════════════════════════════
  { id: 'QTY-001', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'change biryani to 5', expect: { replyMatches: [/5|five/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'change X to N' },
  { id: 'QTY-002', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'update biryani quantity to 3', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'update quantity to N' },
  { id: 'QTY-003', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'make it 4', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'make it N' },
  { id: 'QTY-004', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'add 3 more biryani', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'add N more' },
  { id: 'QTY-005', tenant: 'restaurant-demo', setup: ['i want 5 chicken biryani and 1 beef burger'], message: 'reduce to 2', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'reduce to N' },
  { id: 'QTY-006', tenant: 'restaurant-demo', setup: ['i want 5 chicken biryani and 1 beef burger'], message: 'decrease by 2', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'decrease by N' },
  { id: 'QTY-007', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'increase to 10', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'increase to N' },
  { id: 'QTY-008', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'biryani quantity 4 kar do', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'Roman Urdu quantity karo' },
  { id: 'QTY-009', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'biryani 4 kar do', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'X N kar do' },
  { id: 'QTY-010', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'biryani kam kar do', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'kam kar do (less)' },
  { id: 'QTY-011', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'aur 2 biryani add kar do', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'aur N add karo' },
  { id: 'QTY-012', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'biryani zyada kar do', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'zyada kar do (more)' },
  { id: 'QTY-013', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'set biryani to 3', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'set to N' },
  { id: 'QTY-014', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'i want 5 biryani instead', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'instead' },
  { id: 'QTY-015', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'actually 4 biryani', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'actually N' },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 6: ITEM REMOVAL / CANCELLATION
  // 15 variations: remove/cancel/delete single item or whole cart
  // ═══════════════════════════════════════════════════════════════════════════
  { id: 'RMV-001', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'remove the biryani', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'remove X' },
  { id: 'RMV-002', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'cancel the biryani', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'cancel X (single item)' },
  { id: 'RMV-003', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'delete chicken biryani from my order', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'delete X from order' },
  { id: 'RMV-004', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'take the biryani off', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'take X off' },
  { id: 'RMV-005', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'biryani hata do', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'X hata do' },
  { id: 'RMV-006', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'biryani cancel kar do', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'X cancel karo' },
  { id: 'RMV-007', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'cancel my order', expect: { replyMatches: [/cancel/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'cancel whole order' },
  { id: 'RMV-008', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'clear my cart', expect: { replyMatches: [/empty|clear|cancel/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'clear cart' },
  { id: 'RMV-009', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'empty cart', expect: { replyMatches: [/empty|clear|cancel/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'empty cart' },
  { id: 'RMV-010', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'remove everything from cart', expect: { replyMatches: [/empty|clear|cancel/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'remove everything' },
  { id: 'RMV-011', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'forget the biryani', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'forget X' },
  { id: 'RMV-012', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'nevermind the biryani', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'nevermind X' },
  { id: 'RMV-013', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'scratch the biryani', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'scratch X' },
  { id: 'RMV-014', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'cart clear kar do', expect: { replyMatches: [/empty|clear|cancel/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'cart clear karo' },
  { id: 'RMV-015', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'order cancel kar do', expect: { replyMatches: [/cancel/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'order cancel karo' },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 7: ORDER TYPE (DELIVERY / TAKEAWAY / DINE-IN)
  // 20 variations: standalone and verb-prefixed
  // ═══════════════════════════════════════════════════════════════════════════
  // Use multi-item setup ('i want 1 X and 1 Y') so the cart actually persists
  // items. Single-item 'i want X' goes through catalog.product_interest which
  // requires a confirm step before adding to cart — that's intended behavior.
  { id: 'OT-001', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'change to delivery', expect: { replyMatches: [/delivery/i], replyNotMatch: [/couldn't find|not fully sure|cart is empty/i] }, notes: 'change to delivery' },
  { id: 'OT-002', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'make it delivery', expect: { replyMatches: [/delivery/i], replyNotMatch: [/couldn't find|not fully sure|cart is empty/i] }, notes: 'make it delivery' },
  { id: 'OT-003', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'switch to delivery', expect: { replyMatches: [/delivery/i], replyNotMatch: [/couldn't find|not fully sure|cart is empty/i] }, notes: 'switch to delivery' },
  { id: 'OT-004', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'i want delivery', expect: { replyMatches: [/delivery/i], replyNotMatch: [/couldn't find|not fully sure|cart is empty/i] }, notes: 'i want delivery (standalone)' },
  { id: 'OT-005', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'for delivery', expect: { replyMatches: [/delivery/i], replyNotMatch: [/couldn't find|not fully sure|cart is empty/i] }, notes: 'for delivery (standalone)' },
  { id: 'OT-006', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'home delivery', expect: { replyMatches: [/delivery/i], replyNotMatch: [/couldn't find|not fully sure|cart is empty/i] }, notes: 'home delivery (standalone)' },
  { id: 'OT-007', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'please deliver it', expect: { replyMatches: [/delivery/i], replyNotMatch: [/couldn't find|not fully sure|cart is empty/i] }, notes: 'deliver it' },
  { id: 'OT-008', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'change to takeaway', expect: { replyMatches: [/takeaway/i], replyNotMatch: [/couldn't find|not fully sure|cart is empty/i] }, notes: 'change to takeaway' },
  { id: 'OT-009', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'make it takeaway', expect: { replyMatches: [/takeaway/i], replyNotMatch: [/couldn't find|not fully sure|cart is empty/i] }, notes: 'make it takeaway' },
  { id: 'OT-010', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'for take away', expect: { replyMatches: [/takeaway/i], replyNotMatch: [/couldn't find|not fully sure|cart is empty/i] }, notes: 'for take away' },
  { id: 'OT-011', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'i want to take out', expect: { replyMatches: [/takeaway/i], replyNotMatch: [/couldn't find|not fully sure|cart is empty/i] }, notes: 'take out' },
  { id: 'OT-012', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'to go please', expect: { replyMatches: [/takeaway/i], replyNotMatch: [/couldn't find|not fully sure|cart is empty/i] }, notes: 'to go (standalone)' },
  { id: 'OT-013', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'parcel please', expect: { replyMatches: [/takeaway/i], replyNotMatch: [/couldn't find|not fully sure|cart is empty/i] }, notes: 'parcel (standalone)' },
  { id: 'OT-014', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'pack it up', expect: { replyMatches: [/takeaway/i], replyNotMatch: [/couldn't find|not fully sure|cart is empty/i] }, notes: 'pack it up' },
  { id: 'OT-015', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'change to dine-in', expect: { replyMatches: [/dine-in/i], replyNotMatch: [/couldn't find|not fully sure|cart is empty/i] }, notes: 'change to dine-in' },
  { id: 'OT-016', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'make it dine-in', expect: { replyMatches: [/dine-in/i], replyNotMatch: [/couldn't find|not fully sure|cart is empty/i] }, notes: 'make it dine-in' },
  { id: 'OT-017', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'i want to dine in', expect: { replyMatches: [/dine-in/i], replyNotMatch: [/couldn't find|not fully sure|cart is empty/i] }, notes: 'i want to dine in (standalone)' },
  { id: 'OT-018', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'i want to dine inn', expect: { replyMatches: [/dine-in/i], replyNotMatch: [/couldn't find|not fully sure|cart is empty/i] }, notes: 'dine inn typo' },
  { id: 'OT-019', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'for here please', expect: { replyMatches: [/dine-in/i], replyNotMatch: [/couldn't find|not fully sure|cart is empty/i] }, notes: 'for here (standalone)' },
  { id: 'OT-020', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'eat here', expect: { replyMatches: [/dine-in/i], replyNotMatch: [/couldn't find|not fully sure|cart is empty/i] }, notes: 'eat here (standalone)' },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 8: SPECIAL INSTRUCTIONS
  // 12 variations: spice level, extras, removals
  // ═══════════════════════════════════════════════════════════════════════════
  { id: 'SP-001', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'make it less spicy', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'less spicy' },
  { id: 'SP-002', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'extra spicy please', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'extra spicy' },
  { id: 'SP-003', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'no spice', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'no spice' },
  { id: 'SP-004', tenant: 'restaurant-demo', setup: ['i want 1 beef burger and 1 chicken biryani'], message: 'extra cheese', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'extra cheese' },
  { id: 'SP-005', tenant: 'restaurant-demo', setup: ['i want 1 beef burger and 1 chicken biryani'], message: 'no onions', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'no onions' },
  { id: 'SP-006', tenant: 'restaurant-demo', setup: ['i want 1 beef burger and 1 chicken biryani'], message: 'no garlic', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'no garlic' },
  { id: 'SP-007', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'mirch kam kar do', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'mirch kam karo' },
  { id: 'SP-008', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'zyada mirch', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'zyada mirch' },
  { id: 'SP-009', tenant: 'restaurant-demo', setup: ['i want 1 beef burger and 1 chicken biryani'], message: 'pyaaz nahi', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'pyaaz nahi' },
  { id: 'SP-010', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'mild please', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'mild' },
  { id: 'SP-011', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'extra hot', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'extra hot' },
  { id: 'SP-012', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'make it extra raita', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'extra raita (unmapped but should not error)' },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 9: ORDER NOTES
  // 10 variations: note, instruction, remark
  // ═══════════════════════════════════════════════════════════════════════════
  { id: 'NOTE-001', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'add a note: deliver after 8pm', expect: { replyMatches: [/note|deliver after 8pm/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'add a note: X' },
  { id: 'NOTE-002', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'note: please call before delivery', expect: { replyMatches: [/note/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'note: X' },
  { id: 'NOTE-003', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'leave a note for the kitchen', expect: { replyMatches: [/note/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'leave a note' },
  { id: 'NOTE-004', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'instruction: pack separately', expect: { replyMatches: [/note|instruction|pack separately/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'instruction: X' },
  { id: 'NOTE-005', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'add instruction: extra ketchup', expect: { replyMatches: [/note|instruction|ketchup/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'add instruction: X' },
  { id: 'NOTE-006', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'remark: no plastic', expect: { replyMatches: [/note|remark|no plastic/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'remark: X' },
  { id: 'NOTE-007', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'kitchen ke liye note: less oil', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'Roman Urdu kitchen ke liye note' },
  { id: 'NOTE-008', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'note likh do: delivery after maghrib', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'note likh do' },
  { id: 'NOTE-009', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'message for chef: vegan only', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'message for chef' },
  { id: 'NOTE-010', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'put a note: ring the bell twice', expect: { replyMatches: [/note/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'put a note' },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 10: CART VIEW + CHECKOUT
  // 12 variations
  // ═══════════════════════════════════════════════════════════════════════════
  { id: 'CV-001', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'show my cart', expect: { replyMatches: [/biryani|cart|order/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'show my cart' },
  { id: 'CV-002', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: "what's in my cart", expect: { replyMatches: [/biryani|cart|order/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'what\'s in my cart' },
  { id: 'CV-003', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'show my order', expect: { replyMatches: [/biryani|cart|order/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'show my order' },
  { id: 'CV-004', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'view cart', expect: { replyMatches: [/biryani|cart|order/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'view cart' },
  { id: 'CV-005', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'cart kya hai', expect: { replyMatches: [/biryani|cart|order/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'cart kya hai' },
  { id: 'CV-006', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'mera order dikhao', expect: { replyMatches: [/biryani|cart|order/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'mera order dikhao' },
  { id: 'CV-007', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'order summary', expect: { replyMatches: [/biryani|cart|order|total/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'order summary' },
  { id: 'CV-008', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'checkout', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'checkout' },
  { id: 'CV-009', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'place order', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'place order' },
  { id: 'CV-010', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'confirm order', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'confirm order' },
  { id: 'CV-011', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'done', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'done (single word)' },
  { id: 'CV-012', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani and 1 beef burger'], message: 'finalize', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'finalize' },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 11: CONFIRMATION PHRASES
  // 15 variations: yes/ok/haan/theek hai etc.
  // ═══════════════════════════════════════════════════════════════════════════
  { id: 'CONF-001', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani', 'confirm order'], message: 'ok', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'ok' },
  { id: 'CONF-002', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani', 'confirm order'], message: 'okay', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'okay' },
  { id: 'CONF-003', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani', 'confirm order'], message: 'yes', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'yes' },
  { id: 'CONF-004', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani', 'confirm order'], message: 'yes please', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'yes please' },
  { id: 'CONF-005', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani', 'confirm order'], message: 'go ahead', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'go ahead' },
  { id: 'CONF-006', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani', 'confirm order'], message: 'do it', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'do it' },
  { id: 'CONF-007', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani', 'confirm order'], message: 'theek hai', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'theek hai' },
  { id: 'CONF-008', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani', 'confirm order'], message: 'haan', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'haan' },
  { id: 'CONF-009', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani', 'confirm order'], message: 'pakka', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'pakka' },
  { id: 'CONF-010', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani', 'confirm order'], message: 'sahi hai', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'sahi hai' },
  { id: 'CONF-011', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani', 'confirm order'], message: 'bilkul', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'bilkul' },
  { id: 'CONF-012', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani', 'confirm order'], message: 'confirm', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'confirm' },
  { id: 'CONF-013', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani', 'confirm order'], message: 'confirmed', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'confirmed' },
  { id: 'CONF-014', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani', 'confirm order'], message: 'ok confirm', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'ok confirm' },
  { id: 'CONF-015', tenant: 'restaurant-demo', setup: ['i want 1 chicken biryani', 'confirm order'], message: 'haan confirm karo', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'haan confirm karo' },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 12: BOOKING TRIGGER (SALON)
  // 15 variations: book/schedule/reserve + service + date/time
  // ═══════════════════════════════════════════════════════════════════════════
  { id: 'BKG-001', tenant: 'salon-demo', message: 'book beard grooming tomorrow at 5pm', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'book X tomorrow at Y' },
  { id: 'BKG-002', tenant: 'salon-demo', message: 'i want to book a haircut tomorrow', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'i want to book X' },
  { id: 'BKG-003', tenant: 'salon-demo', message: 'can i get a haircut tomorrow at 3pm', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'can i get X (acquisition cue)' },
  { id: 'BKG-004', tenant: 'salon-demo', message: 'schedule a facial for friday 11am', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'schedule X for Y' },
  { id: 'BKG-005', tenant: 'salon-demo', message: 'reserve a hair styling appointment tomorrow', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'reserve X appointment' },
  { id: 'BKG-006', tenant: 'salon-demo', message: "i'd like to book beard grooming", expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'i\'d like to book' },
  { id: 'BKG-007', tenant: 'salon-demo', message: 'i need a haircut tomorrow at noon', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'noon as time' },
  { id: 'BKG-008', tenant: 'salon-demo', message: 'appointment for hair color tomorrow', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'appointment for X' },
  { id: 'BKG-009', tenant: 'salon-demo', message: 'book me a facial next monday', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'book me a X' },
  { id: 'BKG-010', tenant: 'salon-demo', message: 'i will book a haircut tomorrow at 4', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'i will book' },
  { id: 'BKG-011', tenant: 'salon-demo', message: 'mujhe beard grooming chahiye tomorrow 5pm', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'Roman Urdu mixed' },
  { id: 'BKG-012', tenant: 'salon-demo', message: 'beard grooming book karna hai kal', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'X book karna hai kal' },
  { id: 'BKG-013', tenant: 'salon-demo', message: 'beard grooming kal sham 5 baje', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'kal sham 5 baje' },
  { id: 'BKG-014', tenant: 'salon-demo', message: 'haircut for tomorrow evening', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'evening as time window' },
  { id: 'BKG-015', tenant: 'salon-demo', message: 'book haircut for saturday 2pm', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'saturday 2pm' },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 13: BOOKING MODIFICATIONS
  // 15 variations: change service / reschedule / swap / remove / note
  // ═══════════════════════════════════════════════════════════════════════════
  { id: 'BM-001', tenant: 'salon-demo', setup: ['book beard grooming tomorrow at 5pm'], message: 'change to haircut', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'change to X' },
  { id: 'BM-002', tenant: 'salon-demo', setup: ['book beard grooming tomorrow at 5pm'], message: 'switch to haircut', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'switch to X' },
  { id: 'BM-003', tenant: 'salon-demo', setup: ['book beard grooming tomorrow at 5pm'], message: 'swap beard grooming for haircut', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'swap X for Y' },
  { id: 'BM-004', tenant: 'salon-demo', setup: ['book beard grooming tomorrow at 5pm'], message: 'replace beard grooming with haircut', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'replace X with Y' },
  { id: 'BM-005', tenant: 'salon-demo', setup: ['book beard grooming tomorrow at 5pm'], message: 'remove beard grooming', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'remove X' },
  { id: 'BM-006', tenant: 'salon-demo', setup: ['book beard grooming tomorrow at 5pm'], message: 'delete the beard grooming', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'delete the X' },
  { id: 'BM-007', tenant: 'salon-demo', setup: ['book beard grooming tomorrow at 5pm'], message: 'add a note: please use organic products', expect: { replyMatches: [/note|organic/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'add a note' },
  { id: 'BM-008', tenant: 'salon-demo', setup: ['book beard grooming tomorrow at 5pm'], message: 'this is for my wife Sara', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'recipient change' },
  { id: 'BM-009', tenant: 'salon-demo', setup: ['book beard grooming tomorrow at 5pm'], message: 'this is for my son Ali', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'recipient change son' },
  { id: 'BM-010', tenant: 'salon-demo', setup: ['book beard grooming tomorrow at 5pm'], message: 'change the name to Ahmed', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'change name to X' },
  { id: 'BM-011', tenant: 'salon-demo', setup: ['book beard grooming tomorrow at 5pm'], message: 'move it to friday 6pm', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'move to X' },
  { id: 'BM-012', tenant: 'salon-demo', setup: ['book beard grooming tomorrow at 5pm'], message: 'reschedule to next monday', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'reschedule to X' },
  { id: 'BM-013', tenant: 'salon-demo', setup: ['book beard grooming tomorrow at 5pm'], message: 'change to 4pm', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'change to time' },
  { id: 'BM-014', tenant: 'salon-demo', setup: ['book beard grooming tomorrow at 5pm'], message: 'cancel my booking', expect: { replyMatches: [/cancel/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'cancel my booking' },
  { id: 'BM-015', tenant: 'salon-demo', setup: ['book beard grooming tomorrow at 5pm'], message: 'show my bookings', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'list bookings' },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 14: RESTAURANT RESERVATION (party size)
  // 10 variations
  // ═══════════════════════════════════════════════════════════════════════════
  { id: 'RSV-001', tenant: 'restaurant-demo', message: 'reserve a table for 4 tomorrow at 7pm', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'table for N' },
  { id: 'RSV-002', tenant: 'restaurant-demo', message: 'book a table tomorrow 8pm for 2', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'table N at T' },
  { id: 'RSV-003', tenant: 'restaurant-demo', message: 'table for 6 please', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'table for N please' },
  { id: 'RSV-004', tenant: 'restaurant-demo', message: 'reservation for 3 people tomorrow', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'reservation for N people' },
  { id: 'RSV-005', tenant: 'restaurant-demo', message: 'i want to reserve a table for 5', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'reserve a table for N' },
  { id: 'RSV-006', tenant: 'restaurant-demo', message: '2 guests tomorrow at 9pm', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'N guests' },
  { id: 'RSV-007', tenant: 'restaurant-demo', message: '8 people friday 8pm', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'N people weekday time' },
  { id: 'RSV-008', tenant: 'restaurant-demo', message: 'table for 4', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'bare table for N' },
  { id: 'RSV-009', tenant: 'restaurant-demo', setup: ['reserve a table for 4 tomorrow at 7pm'], message: 'change to 6 people', expect: { replyMatches: [/party size.*6|6 people/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'change party size' },
  { id: 'RSV-010', tenant: 'restaurant-demo', setup: ['reserve a table for 4 tomorrow at 7pm'], message: 'make it 8 guests', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'make it N guests' },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 15: CLEANING SERVICE REQUESTS
  // 15 variations
  // ═══════════════════════════════════════════════════════════════════════════
  { id: 'CLN-001', tenant: 'cleaning-demo', message: 'i want deep cleaning for my apartment', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'deep cleaning apartment' },
  { id: 'CLN-002', tenant: 'cleaning-demo', message: 'book a deep cleaning service', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'book a service' },
  { id: 'CLN-003', tenant: 'cleaning-demo', message: 'i need sofa cleaning', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'sofa cleaning' },
  { id: 'CLN-004', tenant: 'cleaning-demo', message: 'how much for deep cleaning?', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'how much quote' },
  { id: 'CLN-005', tenant: 'cleaning-demo', message: 'price for carpet cleaning?', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'price quote' },
  { id: 'CLN-006', tenant: 'cleaning-demo', message: 'what services do you offer?', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'browse services' },
  { id: 'CLN-007', tenant: 'cleaning-demo', message: 'mujhe safai chahiye', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'Roman Urdu safai' },
  { id: 'CLN-008', tenant: 'cleaning-demo', message: 'deep cleaning for villa', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'villa property type' },
  { id: 'CLN-009', tenant: 'cleaning-demo', message: 'cleaning for 3 bedroom apartment', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: '3 bedroom' },
  { id: 'CLN-010', tenant: 'cleaning-demo', message: 'move in cleaning', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'move-in cleaning' },
  { id: 'CLN-011', tenant: 'cleaning-demo', message: 'i want office cleaning', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'office cleaning' },
  { id: 'CLN-012', tenant: 'cleaning-demo', message: 'standard cleaning for my flat', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'standard cleaning flat' },
  { id: 'CLN-013', tenant: 'cleaning-demo', message: 'hourly cleaner for 4 hours', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'hourly cleaner' },
  { id: 'CLN-014', tenant: 'cleaning-demo', message: '5 seater sofa cleaning', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: '5 seater sofa' },
  { id: 'CLN-015', tenant: 'cleaning-demo', message: '7 seater carpet', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: '7 seater carpet' },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 16: BUSINESS QUESTIONS (hours, location, contact)
  // 10 variations
  // ═══════════════════════════════════════════════════════════════════════════
  { id: 'BIZ-001', tenant: 'restaurant-demo', message: 'what are your hours', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'hours query' },
  { id: 'BIZ-002', tenant: 'restaurant-demo', message: 'when do you open', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'opening time' },
  { id: 'BIZ-003', tenant: 'restaurant-demo', message: 'where are you located', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'location' },
  { id: 'BIZ-004', tenant: 'restaurant-demo', message: 'what is your address', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'address' },
  { id: 'BIZ-005', tenant: 'restaurant-demo', message: 'phone number', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'phone number' },
  { id: 'BIZ-006', tenant: 'restaurant-demo', message: 'how do i contact you', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'contact' },
  { id: 'BIZ-007', tenant: 'salon-demo', message: 'what are your hours', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'salon hours' },
  { id: 'BIZ-008', tenant: 'salon-demo', message: 'where is the salon', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'salon location' },
  { id: 'BIZ-009', tenant: 'cleaning-demo', message: 'do you have a phone number', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'phone query' },
  { id: 'BIZ-010', tenant: 'restaurant-demo', message: 'are you open on sundays', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'opening days' },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 17: EDGE CASES — short, ambiguous, out-of-scope
  // 15 variations
  // ═══════════════════════════════════════════════════════════════════════════
  { id: 'EDGE-001', tenant: 'restaurant-demo', message: 'hi', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'greeting only' },
  { id: 'EDGE-002', tenant: 'restaurant-demo', message: 'hello', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'hello' },
  { id: 'EDGE-003', tenant: 'restaurant-demo', message: 'assalam o alaikum', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'Roman Urdu greeting' },
  { id: 'EDGE-004', tenant: 'restaurant-demo', message: 'salam', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'salam greeting' },
  { id: 'EDGE-005', tenant: 'restaurant-demo', message: 'thanks', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'thanks' },
  { id: 'EDGE-006', tenant: 'restaurant-demo', message: 'shukriya', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'Roman Urdu thanks' },
  { id: 'EDGE-007', tenant: 'restaurant-demo', message: 'what is the weather', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'out of scope weather' },
  { id: 'EDGE-008', tenant: 'restaurant-demo', message: 'book me a flight', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'out of scope flights' },
  { id: 'EDGE-009', tenant: 'restaurant-demo', message: 'play some music', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'out of scope music' },
  { id: 'EDGE-010', tenant: 'restaurant-demo', message: 'help', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'help command' },
  { id: 'EDGE-011', tenant: 'restaurant-demo', message: 'menu', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'bare menu' },
  { id: 'EDGE-012', tenant: 'restaurant-demo', message: 'what can you do', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'capability query' },
  { id: 'EDGE-013', tenant: 'restaurant-demo', message: 'i have a question', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'question opener' },
  { id: 'EDGE-014', tenant: 'restaurant-demo', message: 'speak to a human', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'human handoff' },
  { id: 'EDGE-015', tenant: 'restaurant-demo', message: 'cancel', expect: { replyMatches: [/cancel/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'bare cancel' },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 18: RETAIL (default tenant) — product orders with variants
  // 15 variations: colors/sizes
  // ═══════════════════════════════════════════════════════════════════════════
  { id: 'RTL-001', tenant: 'default', message: 'i want 1 black wireless airbud', expect: { replyMatches: [/airbud|earbuds/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'color + product' },
  { id: 'RTL-002', tenant: 'default', message: 'i need a small t-shirt', expect: { replyMatches: [/t-shirt|t shirt/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'size + product' },
  { id: 'RTL-003', tenant: 'default', message: 'show me the denim jeans', expect: { replyMatches: [/jeans/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'show me X' },
  { id: 'RTL-004', tenant: 'default', message: 'do you have wireless earbuds', expect: { replyMatches: [/earbuds/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'do you have X' },
  { id: 'RTL-005', tenant: 'default', message: 'how much is the smart watch', expect: { replyMatches: [/watch|price/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'how much quote' },
  { id: 'RTL-006', tenant: 'default', message: 'price of leather wallet', expect: { replyMatches: [/wallet|price/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'price of X' },
  { id: 'RTL-007', tenant: 'default', message: '2 blue polo shirts please', expect: { replyMatches: [/polo|shirt/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'color + quantity' },
  { id: 'RTL-008', tenant: 'default', message: 'i want to buy the running shoes', expect: { replyMatches: [/shoe/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'i want to buy X' },
  { id: 'RTL-009', tenant: 'default', message: 'do you sell sunglasses', expect: { replyMatches: [/sunglass/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'do you sell X' },
  { id: 'RTL-010', tenant: 'default', message: 'a black fleece hoodie', expect: { replyMatches: [/hoodie/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'a black X' },
  { id: 'RTL-011', tenant: 'default', message: 'one medium polo shirt', expect: { replyMatches: [/polo/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'one medium X' },
  { id: 'RTL-012', tenant: 'default', message: '3 large t-shirts', expect: { replyMatches: [/t-shirt|t shirt/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: '3 large' },
  { id: 'RTL-013', tenant: 'default', message: 'add 2 power banks', expect: { replyMatches: [/power bank/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'add N X' },
  { id: 'RTL-014', tenant: 'default', message: 'i want to see the bluetooth speaker', expect: { replyMatches: [/speaker/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'i want to see X' },
  { id: 'RTL-015', tenant: 'default', message: 'give me a yoga mat', expect: { replyMatches: [/yoga/i], replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'give me a X' },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 19: HEALTHCARE + EDUCATION + DRIVING SCHOOL
  // 15 variations across other service-based domains
  // ═══════════════════════════════════════════════════════════════════════════
  { id: 'HC-001', tenant: 'healthcare-demo', message: 'what treatments do you offer', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'healthcare browse' },
  { id: 'HC-002', tenant: 'healthcare-demo', message: 'i need a general consultation', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'general consultation' },
  { id: 'HC-003', tenant: 'healthcare-demo', message: 'book a doctor appointment tomorrow', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'book doctor' },
  { id: 'HC-004', tenant: 'healthcare-demo', message: 'can i see a pediatrician', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'pediatrician' },
  { id: 'HC-005', tenant: 'healthcare-demo', message: 'how much for consultation', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'consultation price' },
  { id: 'EDU-001', tenant: 'education-demo', message: 'what classes do you provide', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'education browse' },
  { id: 'EDU-002', tenant: 'education-demo', message: 'can i get my boy admitted to your school', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'admission inquiry' },
  { id: 'EDU-003', tenant: 'education-demo', message: 'i want to enroll in grade 5', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'grade 5 enrollment' },
  { id: 'EDU-004', tenant: 'education-demo', message: 'what programs do you offer', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'programs browse' },
  { id: 'EDU-005', tenant: 'education-demo', message: 'admission fee for grade 3', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'admission fee' },
  { id: 'DRV-001', tenant: 'driving-school-demo', message: 'what packages do you offer', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'driving school browse' },
  { id: 'DRV-002', tenant: 'driving-school-demo', message: 'i want to learn driving', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'learn driving' },
  { id: 'DRV-003', tenant: 'driving-school-demo', message: 'book a driving lesson tomorrow', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'book lesson' },
  { id: 'DRV-004', tenant: 'driving-school-demo', message: 'how much is the beginner package', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'package price' },
  { id: 'DRV-005', tenant: 'driving-school-demo', message: 'i need 10 driving lessons', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'N lessons' },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 20: FULL CHECKOUT FLOWS (multi-turn)
  // 10 variations: complete order from start to confirmation
  // ═══════════════════════════════════════════════════════════════════════════
  { id: 'FLOW-001', tenant: 'restaurant-demo', setup: [], message: 'flow', expect: { replyNotMatch: [/couldn't find|not fully sure/i] }, notes: 'placeholder - real flow tests below', skip: true },
];
