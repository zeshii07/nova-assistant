const test = require('node:test');
const assert = require('node:assert/strict');

const { buildContainer } = require('../apps/api/src/container');
const { createInitialState } = require('../packages/state/src/stateSchema');

async function withNluMode(mode, work) {
  const previous = process.env.NOVA_NLU_MODE;
  process.env.NOVA_NLU_MODE = mode;
  let container;
  try {
    container = await buildContainer();
    return await work(container);
  } finally {
    await container?.registry?.shutdownAll?.();
    if (previous === undefined) delete process.env.NOVA_NLU_MODE;
    else process.env.NOVA_NLU_MODE = previous;
  }
}

function otherNlu(overrides={}){
  return {
    schema_version:'1.0',language:'en',message_type:'other',intent:'other',confidence:.96,
    workflow_relationship:'unrelated',entities:{},customer_fields:{},requested_information:[],
    corrections:[],ambiguities:[],...overrides
  };
}

test('Groq on keeps a high-confidence cleaning request on the deterministic fast path', async () => {
  await withNluMode('on', async (container) => {
    let groqCalls = 0;
    container.groqNluClient.complete = async () => ({success:true,model:'mock-groq-light',latencyMs:2,data:(groqCalls+=1,otherNlu())});

    const response = await container.executionEngine.process({
      tenantId:'cleaning-demo', channel:'adaptive-groq', customerId:`fields-${Date.now()}`,
      text:'I need 2 cleaners tomorrow from 9 AM to 12 PM for my 3-bedroom apartment, including 2 balconies and 5 windows.'
    });

    const state = response.state.capabilityState.cleaning;
    assert.equal(groqCalls, 0);
    assert.equal(response.intelligence.nlu.used, false);
    assert.equal(response.intelligence.nlu.invocationReason, 'deterministic_confident');
    assert.ok(state.preferredDate);
    assert.equal(state.startTime, '09:00');
    assert.equal(state.preferredTime, '09:00');
    assert.equal(state.endTime, '12:00');
    assert.equal(state.durationHours, 3);
    assert.equal(state.cleanerCount, 2);
    assert.equal(state.propertyType, 'apartment');
    assert.equal(state.bedrooms, 3);
    assert.equal(state.balconies, 2);
    assert.equal(state.interiorWindows, 5);
    assert.equal(state.step, 'address');
    assert.doesNotMatch(response.reply, /what date|what time|enter a date/i);
    assert.match(response.reply, /address/i);
  });
});

test('a start-time correction changes the start while retaining the known duration', async () => {
  await withNluMode('on', async (container) => {
    let groqCalls = 0;
    container.groqNluClient.complete = async () => ({success:true,model:'mock-groq-light',latencyMs:2,data:(groqCalls+=1,otherNlu())});
    const customerId = `correction-${Date.now()}`;
    await container.executionEngine.process({
      tenantId:'cleaning-demo', channel:'adaptive-groq', customerId,
      text:'I need 2 cleaners tomorrow from 9 AM to 12 PM for my 3-bedroom apartment, including 2 balconies and 5 windows.'
    });
    const response = await container.executionEngine.process({
      tenantId:'cleaning-demo', channel:'adaptive-groq', customerId,
      text:'Actually change the starting time from 8 AM to 9 AM.'
    });

    const state = response.state.capabilityState.cleaning;
    assert.equal(groqCalls, 0);
    assert.equal(state.startTime, '09:00');
    assert.equal(state.preferredTime, '09:00');
    assert.equal(state.endTime, '12:00');
    assert.match(response.reply, /09:00–12:00/);
    assert.doesNotMatch(response.reply, /08:00–09:00/);
  });
});

test('business identity and contact interrupt a cleaning workflow without consuming the pending field', async () => {
  await withNluMode('on', async (container) => {
    let groqCalls = 0;
    container.groqNluClient.complete = async () => ({success:true,model:'mock-groq-light',latencyMs:2,data:(groqCalls+=1,otherNlu({
      message_type:'question',intent:'business.info',confidence:.98,workflow_relationship:'interrupt',requested_information:['business_name','business_contact']
    }))});
    const customerId = `business-info-${Date.now()}`;
    const first = await container.executionEngine.process({
      tenantId:'cleaning-demo', channel:'adaptive-groq', customerId,
      text:'I need 2 cleaners tomorrow from 9 AM to 12 PM for my 3-bedroom apartment.'
    });
    const before = structuredClone(first.state.capabilityState.cleaning);
    const response = await container.executionEngine.process({
      tenantId:'cleaning-demo', channel:'adaptive-groq', customerId,
      text:'Actually I want only information about your business, like its name and contact details.'
    });

    assert.equal(groqCalls, 1);
    assert.equal(response.capabilityId, 'assistant');
    assert.match(response.reply, /SparkleCare Cleaning/);
    assert.match(response.reply, /\+971 4 555 0199/);
    assert.match(response.reply, /hello@sparklecare\.example/);
    assert.doesNotMatch(response.reply, /enter a date/i);
    assert.deepEqual(response.state.capabilityState.cleaning, before);
  });
});

test('Groq on also interprets a message when deterministic routing has no confident answer', async () => {
  await withNluMode('on', async (container) => {
    let groqCalls = 0;
    container.groqNluClient.complete = async () => {
      groqCalls += 1;
      return {
        success:true, model:'mock-groq-light', latencyMs:2,
        data:{
          schema_version:'1.0', language:'roman_ur', message_type:'other', intent:'other',
          confidence:0.62, workflow_relationship:'unrelated', entities:{}, customer_fields:{},
          requested_information:[], corrections:[], ambiguities:['The requested action is not specific.']
        }
      };
    };
    const tenant = container.tenantRepository.getById('cleaning-demo');
    const state = createInitialState({
      tenantId:tenant.id, conversationId:'adaptive-ambiguous', channel:'adaptive-groq',
      customerId:'ambiguous', language:'english'
    });
    const analysis = await container.conversationIntelligenceEngine.analyze({
      tenant, state, services:container.executionEngine.services,
      message:{tenantId:tenant.id, channel:'adaptive-groq', customerId:'ambiguous', text:'thora adjust kar do na'}
    });

    assert.equal(groqCalls, 1);
    assert.equal(analysis.nlu.used, true);
    assert.equal(analysis.nlu.validated, true);
    assert.equal(analysis.nlu.invocationReason, 'no_deterministic_route');
  });
});
