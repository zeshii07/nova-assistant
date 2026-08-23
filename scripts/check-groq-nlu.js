#!/usr/bin/env node

const { loadConfig } = require('../packages/config/src/config');
const { GroqNluClient } = require('../packages/multilingual-nlu/src');

async function main() {
  const config=loadConfig();
  if(!config.groqNluApiKey)throw new Error('GROQ_API_KEY is missing. Add it to .env, then run this command again.');
  const client = new GroqNluClient({
    baseUrl:config.groqNluBaseUrl,
    model:config.groqNluModel,
    apiKey:config.groqNluApiKey,
    timeoutMs:config.groqNluTimeoutMs,
    failureCooldownMs:0
  });
  const result = await client.complete([
    {
      role:'system',
      content:'Interpret language only. Return the required JSON schema with all required root properties. Do not answer, reason, call tools, or decide business facts.'
    },
    { role:'user', content:'Kal shaam 5 baje haircut book karna hai.' }
  ]);
  if (!result.success) {
    const details=[
      result.providerMessage,
      result.providerErrorType?`type=${result.providerErrorType}`:null,
      result.providerRequestId?`request_id=${result.providerRequestId}`:null
    ].filter(Boolean).join(' | ');
    throw new Error(`Groq NLU check failed: ${result.error}${details?` — ${details}`:''} (model=${result.model}, endpoint=${config.groqNluBaseUrl})`);
  }
  console.log(JSON.stringify({
    ok:true,
    provider:'Groq',
    endpoint:config.groqNluBaseUrl,
    model:result.model,
    latencyMs:result.latencyMs,
    output:result.data
  }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
