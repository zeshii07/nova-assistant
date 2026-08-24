#!/usr/bin/env node

process.env.NOVA_NLU_MODE='on';

const {buildContainer}=require('../apps/api/src/container');
const {createInitialState}=require('../packages/state/src/stateSchema');

async function main(){
  const query=process.argv.slice(2).join(' ').trim()||'thora adjust kar do na, kal wali request ko';
  const tenantId=process.env.NOVA_GROQ_TRACE_TENANT||'cleaning-demo';
  const container=await buildContainer();
  try{
    const tenant=container.tenantRepository.getById(tenantId);
    if(!tenant)throw new Error(`Unknown tenant: ${tenantId}`);
    const customerId=`groq-trace-${Date.now()}`;
    const state=createInitialState({tenantId,conversationId:`${tenantId}:groq-trace:${customerId}`,channel:'groq-trace',customerId,language:'english'});
    const analysis=await container.conversationIntelligenceEngine.analyze({
      tenant,state,services:container.executionEngine.services,
      message:{tenantId,channel:'groq-trace',customerId,text:query}
    });
    console.log(JSON.stringify({
      tenantId,query,
      localSemanticRouter:analysis.semanticRouter,
      deterministicWinner:analysis.candidates?.[0]?pick(analysis.candidates[0]):null,
      remoteNlu:{
        provider:'Groq',
        used:analysis.nlu.used,validated:analysis.nlu.validated,
        strategy:analysis.nlu.strategy,deterministicFallback:analysis.nlu.deterministicFallback,
        executionAuthority:analysis.nlu.executionAuthority,
        invocationReason:analysis.nlu.invocationReason,decision:analysis.nlu.decision,
        model:analysis.nlu.model,latencyMs:analysis.nlu.latencyMs,error:analysis.nlu.error,
        httpStatus:analysis.nlu.httpStatus,providerErrorType:analysis.nlu.providerErrorType,
        providerMessage:analysis.nlu.providerMessage,providerRequestId:analysis.nlu.providerRequestId
      },
      languageContract:analysis.nlu.languageContract,
      selected:analysis.selected?pick(analysis.selected):null,
      requiresClarification:analysis.requiresClarification,
      extractedEntities:analysis.entities
    },null,2));
  }finally{
    await container.registry.shutdownAll();
  }
}

function pick(value){return {capabilityId:value.capabilityId,intent:value.intent,confidence:value.confidence,reason:value.reason};}

main().catch((error)=>{console.error(`Nova Groq trace failed: ${error.message}`);process.exitCode=1;});
