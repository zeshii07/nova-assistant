#!/usr/bin/env node

// This trace is intentionally provider-free. It shows what Nova can resolve
// locally and whether the escalation policy would ask Groq for assistance.
process.env.NOVA_NLU_MODE='off';

const {buildContainer}=require('../apps/api/src/container');
const {createInitialState}=require('../packages/state/src/stateSchema');

async function main(){
  const query=process.argv.slice(2).join(' ').trim()||'kal wali request thori late kar do';
  const tenantId=process.env.NOVA_SEMANTIC_TRACE_TENANT||'cleaning-demo';
  const container=await buildContainer();
  try{
    const tenant=container.tenantRepository.getById(tenantId);
    if(!tenant)throw new Error(`Unknown tenant: ${tenantId}`);
    const customerId=`semantic-trace-${Date.now()}`;
    const state=createInitialState({tenantId,conversationId:`${tenantId}:semantic-trace:${customerId}`,channel:'semantic-trace',customerId,language:'english'});
    const analysis=await container.conversationIntelligenceEngine.analyze({
      tenant,state,services:container.executionEngine.services,
      message:{tenantId,channel:'semantic-trace',customerId,text:query}
    });
    const adaptiveDecision=container.nluInvocationPolicy.evaluate({
      choice:{winner:analysis.selected,ordered:analysis.candidates||[]},
      pending:analysis.workflow?.current||null,
      pendingValidation:analysis.validation?.pending||null,
      correction:analysis.correction||null,
      deterministicInterruption:analysis.deterministicInterruption||null,
      message:{text:query},messageFrame:analysis.messageFrame,
      localSemantic:analysis.semanticRouter,
      semanticPolicy:{aligned:Boolean(analysis.semanticRouter?.alignedDeterministicCandidate)}
    });
    console.log(JSON.stringify({
      tenantId,query,
      localSemanticRouter:analysis.semanticRouter,
      deterministicCandidates:(analysis.candidates||[]).slice(0,5).map(pick),
      selected:analysis.selected?pick(analysis.selected):null,
      adaptiveDecision,
      groqWouldBeInvoked:adaptiveDecision.invoke,
      requiresClarification:analysis.requiresClarification,
      extractedEntities:analysis.entities
    },null,2));
  }finally{await container.registry.shutdownAll();}
}

function pick(value){return {capabilityId:value.capabilityId,intent:value.intent,confidence:value.confidence,reason:value.reason};}
main().catch(error=>{console.error(`Nova semantic trace failed: ${error.message}`);process.exitCode=1;});
