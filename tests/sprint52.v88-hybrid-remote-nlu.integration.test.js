const test = require('node:test');
const assert = require('node:assert/strict');
const {
  NOVA_NLU_SCHEMA, validateNluOutput, NluContextBuilder,
  GroqNluClient, RemoteNluInterpreter, NluDecisionPolicy
} = require('../packages/multilingual-nlu/src');

function nlu(overrides = {}) {
  const base = {
    schema_version:'1.0', language:'en', message_type:'request', intent:'booking.create',
    confidence:0.97, workflow_relationship:'continue',
    entities:{
      service:null, service_id:null, product:null, product_id:null,
      date_text:null, date_normalized:null, time_text:null, time_normalized:null,
      end_time_text:null, duration_hours:null, staff:null, quantity:null,
      cleaner_count:null, property_type:null, bedrooms:null, balconies:null,
      interior_windows:null, washrooms:null, halls:null, address:null,
      recurrence:null, supplies_required:null, equipment_required:null
    },
    customer_fields:{name:null, phone:null, email:null},
    requested_information:[], corrections:[], ambiguities:[]
  };
  return {
    ...base, ...overrides,
    entities:{...base.entities, ...(overrides.entities || {})},
    customer_fields:{...base.customer_fields, ...(overrides.customer_fields || {})}
  };
}

test('Groq client requests strict schema output and never sends tools', async () => {
  let captured;
  const output = nlu({ language:'roman_ur', entities:{service:'Haircut', service_id:'haircut', date_text:'kal', time_text:'shaam 5 baje'} });
  const fetchImpl = async (url, init) => {
    captured = {url, body:JSON.parse(init.body)};
    return { ok:true, json:async () => ({ model:'groq-test', choices:[{message:{content:JSON.stringify(output)}}] }) };
  };
  const client = new GroqNluClient({baseUrl:'http://groq.local/v1', model:'groq-test', apiKey:'test-key', fetchImpl});
  const result = await client.complete([{role:'user', content:'Kal shaam 5 baje haircut book karna hai'}]);
  assert.equal(result.success, true);
  assert.equal(captured.url, 'http://groq.local/v1/chat/completions');
  assert.equal(captured.body.response_format.type, 'json_schema');
  assert.equal(captured.body.response_format.json_schema.strict, true);
  assert.equal(captured.body.response_format.json_schema.schema.additionalProperties, false);
  assert.equal(Object.hasOwn(captured.body, 'tools'), false);
  assert.equal(Object.hasOwn(captured.body, 'tool_choice'), false);
});

test('strict NLU validator rejects extra keys and malformed canonical fields', () => {
  assert.equal(validateNluOutput(nlu()).valid, true);
  const extra = nlu(); extra.execute_booking = true;
  const rejected = validateNluOutput(extra);
  assert.equal(rejected.valid, false);
  assert.match(rejected.errors.join(' '), /not allowed/);
  const badEntity = nlu(); badEntity.entities.service_id = {tenant:'other'};
  assert.equal(validateNluOutput(badEntity).valid, false);
  assert.equal(NOVA_NLU_SCHEMA.properties.entities.additionalProperties, false);
});

test('NLU context is current-tenant vocabulary only and excludes prices, CRM, and raw policy data', async () => {
  const builder = new NluContextBuilder();
  const state = { customer:{email:'private@example.com'}, capabilityState:{booking:{status:'collecting', pendingField:'phone', slots:{date:'2026-08-12', name:'Ahmed', secretNote:'do not send'}}} };
  const context = await builder.build({
    tenant:{id:'salon-demo', domain:'salon', capabilities:['assistant','booking']}, state,
    pending:{capabilityId:'booking', workflow:'generic_booking', pendingField:'phone'},
    services:{
      offeringService:{list:(tenantId) => { assert.equal(tenantId, 'salon-demo'); return [{id:'haircut', name:'Haircut', aliases:['hair cut'], price:1500, internalMargin:400}]; }},
      catalogService:{listProducts:async () => [{id:'shampoo', name:'Shampoo', price:900, inventory:12}]},
      pricingService:{getConfig:() => ({currency:'PKR', policies:{secret:true}, services:[]})}
    }
  });
  const serialized = JSON.stringify(context);
  assert.match(serialized, /haircut/);
  assert.match(serialized, /2026-08-12/);
  assert.doesNotMatch(serialized, /1500|900|private@example|secretNote|internalMargin|policies/);
});

test('decision policy preserves deterministic winners and blocks hypothetical actions', () => {
  const policy = new NluDecisionPolicy();
  const tenant = {capabilities:['assistant','booking']};
  const allowed = {serviceIds:['haircut'], productIds:[]};
  const deterministic = {capabilityId:'booking', intent:'booking.start', confidence:0.999, reason:'exact_rule', entities:{offeringId:'haircut'}};
  const modelInfo = {validated:true, mode:'on', allowed, interpretation:nlu({message_type:'question', intent:'service.price', workflow_relationship:'unrelated', entities:{service:'Haircut', service_id:'haircut'}})};
  const kept = policy.apply({tenant, deterministic, nlu:modelInfo, pending:null});
  assert.equal(kept.selected.intent, 'booking.start');
  assert.equal(kept.decision, 'high_confidence_deterministic_preserved');

  const hypothetical = {validated:true, mode:'on', allowed, interpretation:nlu({message_type:'question', intent:'booking.create', confidence:0.99, workflow_relationship:'unrelated', entities:{service:'Haircut', service_id:'haircut'}})};
  const blocked = policy.apply({tenant, deterministic:null, nlu:hypothetical, pending:null});
  assert.equal(blocked.selected, null);
  assert.equal(blocked.decision, 'deterministic_route_preserved');
});

test('high-confidence multilingual request can start only an unconfirmed deterministic draft', () => {
  const policy = new NluDecisionPolicy();
  const parsed = nlu({
    language:'ar', message_type:'request', intent:'booking.create', confidence:0.98,
    entities:{service:'Haircut', service_id:'haircut', date_text:'غداً', time_text:'الساعة الخامسة'},
    customer_fields:{name:'أحمد'}
  });
  const routed = policy.apply({
    tenant:{capabilities:['assistant','booking']}, deterministic:null,
    nlu:{validated:true, mode:'on', allowed:{serviceIds:['haircut'], productIds:[]}, interpretation:parsed}, pending:null
  });
  assert.equal(routed.selected.intent, 'booking.start');
  assert.equal(routed.selected.entities.offeringId, 'haircut');
  assert.equal(routed.selected.entities.name, 'أحمد');
  assert.equal(routed.decision, 'booking_draft_started');
});

test('a model-assisted correction may replace only its explicitly corrected field', () => {
  const policy=new NluDecisionPolicy();
  const deterministic={capabilityId:'cleaning',intent:'cleaning.correction',confidence:.999,reason:'generic_correction',entities:{startTime:'08:00',time:'08:00',endTime:'09:00'}};
  const parsed=nlu({
    message_type:'correction',intent:'conversation.correct',confidence:.97,workflow_relationship:'replace',
    entities:{time_text:'9 AM',time_normalized:'09:00'},
    corrections:[{field:'start_time',from:'8 AM',to:'9 AM'}]
  });
  const routed=policy.apply({
    tenant:{capabilities:['assistant','cleaning']},deterministic,pending:{capabilityId:'cleaning'},
    nlu:{validated:true,mode:'on',allowed:{serviceIds:[],productIds:[]},interpretation:parsed}
  });
  assert.equal(routed.selected.intent,'cleaning.schedule_edit');
  assert.equal(routed.selected.entities.startTime,'09:00');
  assert.equal(routed.selected.entities.time,'09:00');
});

test('invalid Groq output is rejected and off mode never contacts the model', async () => {
  const bad = nlu(); bad.entities.foreign_tenant_id = 'tenant-b';
  const interpreter = new RemoteNluInterpreter({
    mode:'on',
    client:{complete:async () => ({success:true, data:bad, model:'mock-groq', latencyMs:1})},
    contextBuilder:{build:async () => ({tenant:{id:'tenant-a'}, active_workflow:null, vocabulary:[], allowed_service_ids:[], allowed_product_ids:[]})}
  });
  const output = await interpreter.interpret({tenant:{id:'tenant-a',capabilities:['assistant']},message:{text:'hello'},state:{},services:{},pending:null});
  assert.equal(output.validated, false);
  assert.equal(output.error, 'schema_rejected');

  let called=false;
  const off = new RemoteNluInterpreter({mode:'off',client:{complete:async()=>{called=true;return {success:false};}}});
  const skipped=await off.interpret({tenant:{id:'tenant-a',capabilities:['assistant']},message:{text:'hello'},state:{},services:{},pending:null});
  assert.equal(called,false);
  assert.equal(skipped.used,false);
});

test('Groq information interrupt answers from tenant data and preserves pending booking state', async () => {
  const previousMode = process.env.NOVA_NLU_MODE;
  process.env.NOVA_NLU_MODE = 'on';
  const { buildContainer } = require('../apps/api/src/container');
  const container = await buildContainer();
  container.groqNluClient.complete = async (messages) => {
    const text = messages.find((x) => x.role === 'user')?.content || '';
    if (text.includes('كم')) return {success:true,model:'mock-groq',latencyMs:2,data:nlu({
      language:'ar',message_type:'question',intent:'service.price',confidence:0.99,workflow_relationship:'interrupt',
      entities:{service:'Haircut',service_id:'haircut'},requested_information:['service_price']
    })};
    return {success:true,model:'mock-groq',latencyMs:2,data:nlu({entities:{service:'Haircut',service_id:'haircut',date_text:'tomorrow',time_text:'4 pm'}})};
  };
  try {
    const customerId = `groq-interrupt-${Date.now()}`;
    const first = await container.executionEngine.process({tenantId:'salon-demo',channel:'http',customerId,text:'Book a haircut tomorrow at 4 PM'});
    const before = structuredClone(first.state.capabilityState.booking);
    assert.equal(before.pendingField, 'name');
    const second = await container.executionEngine.process({tenantId:'salon-demo',channel:'http',customerId,text:'كم سعر قص الشعر؟'});
    assert.equal(second.capabilityId, 'assistant');
    assert.match(second.reply, /Rs1,500/);
    assert.match(second.reply, /To continue your request/);
    assert.deepEqual(second.state.capabilityState.booking, before);
    assert.equal(second.intelligence.nlu.validated, true);
    assert.equal(second.intelligence.nlu.decision, 'read_only_information_route');
  } finally {
    if (previousMode === undefined) delete process.env.NOVA_NLU_MODE;
    else process.env.NOVA_NLU_MODE = previousMode;
  }
});

test('multilingual first-turn fields are consumed once and Nova stops only at deterministic confirmation', async () => {
  const previousMode = process.env.NOVA_NLU_MODE;
  process.env.NOVA_NLU_MODE = 'on';
  const { buildContainer } = require('../apps/api/src/container');
  const container = await buildContainer();
  container.groqNluClient.complete = async () => ({success:true,model:'mock-groq',latencyMs:2,data:nlu({
    language:'ar', message_type:'request', intent:'booking.create', confidence:0.99,
    entities:{service:'Haircut',service_id:'haircut',date_text:'غداً',date_normalized:'2026-08-12',time_text:'الساعة الخامسة',time_normalized:'17:00'},
    customer_fields:{name:'Ahmed',phone:'03001234567'}
  })});
  try {
    const result = await container.executionEngine.process({tenantId:'salon-demo',channel:'http',customerId:`groq-all-fields-${Date.now()}`,text:'أريد حجز قص شعر غداً الساعة الخامسة، اسمي أحمد ورقمي 03001234567'});
    assert.equal(result.capabilityId, 'booking');
    assert.equal(result.state.capabilityState.booking.status, 'ready');
    assert.equal(result.state.capabilityState.booking.pendingField, 'confirmation');
    assert.equal(result.state.capabilityState.booking.slots.date, '08/12/2026');
    assert.equal(result.state.capabilityState.booking.slots.time, '17:00');
    assert.equal(result.state.capabilityState.booking.slots.name, 'Ahmed');
    assert.equal(result.state.capabilityState.booking.slots.phone, '03001234567');
    assert.match(result.reply, /Confirm .*when you are ready/);
    assert.doesNotMatch(result.reply, /what (?:date|time|name|phone)/i);
    assert.equal(Boolean(result.state.capabilityState.booking.bookingId), false);
  } finally {
    if (previousMode === undefined) delete process.env.NOVA_NLU_MODE;
    else process.env.NOVA_NLU_MODE = previousMode;
  }
});
