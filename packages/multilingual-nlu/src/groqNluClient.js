const { NOVA_NLU_SCHEMA } = require('./nluSchema');
const GROQ_NLU_SCHEMA = providerStrictSchema(NOVA_NLU_SCHEMA);

/**
 * Small OpenAI-compatible client dedicated to linguistic interpretation.
 * Groq never receives execution authority: it only returns schema-constrained
 * intent and entity candidates for Nova's deterministic policy layer.
 */
class GroqNluClient {
  constructor({
    baseUrl = 'https://api.groq.com/openai/v1',
    model = 'openai/gpt-oss-20b',
    apiKey = '',
    timeoutMs = 4000,
    failureCooldownMs = 15000,
    fetchImpl = globalThis.fetch,
    logger = null,
    now = () => Date.now()
  } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.model = model;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.failureCooldownMs = Math.max(0, Number(failureCooldownMs) || 0);
    this.fetch = fetchImpl;
    this.logger = logger;
    this.now = now;
    this.circuitOpenUntil = 0;
  }

  async complete(messages) {
    if (!this.apiKey) return { success:false, error:'not_configured', model:this.model, latencyMs:0 };
    if (typeof this.fetch !== 'function') return { success:false, error:'fetch_unavailable', model:this.model, latencyMs:0 };
    const currentTime = Number(this.now());
    if (this.circuitOpenUntil > currentTime) {
      return {
        success:false,
        error:'circuit_open',
        model:this.model,
        latencyMs:0,
        retryAfterMs:Math.max(1, this.circuitOpenUntil - currentTime)
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const started = performance.now();
    try {
      const response = await this.fetch(`${this.baseUrl}/chat/completions`, {
        method:'POST',
        headers:{
          'content-type':'application/json',
          authorization:`Bearer ${this.apiKey}`
        },
        signal:controller.signal,
        body:JSON.stringify({
          model:this.model,
          messages,
          temperature:0,
          max_completion_tokens:900,
          reasoning_effort:'low',
          response_format:{
            type:'json_schema',
            json_schema:{ name:'nova_multilingual_nlu', strict:true, schema:GROQ_NLU_SCHEMA }
          }
        })
      });
      if (!response.ok) {
        const providerError=await readProviderError(response);
        this.logger?.warn?.('groq_nlu.http_error', {
          status:response.status,
          providerErrorType:providerError.providerErrorType,
          providerMessage:providerError.providerMessage
        });
        return this.failure(`http_${response.status}`, started, {
          httpStatus:response.status,
          ...providerError
        });
      }
      const body = await response.json();
      const raw = body?.choices?.[0]?.message?.content;
      if (typeof raw !== 'string' || !raw.trim()) return this.failure('empty_response', started);
      let data;
      try { data = JSON.parse(raw); }
      catch { return this.failure('invalid_json', started, { raw:raw.slice(0, 1000) }); }
      this.circuitOpenUntil = 0;
      return { success:true, data, model:body.model || this.model, latencyMs:elapsed(started) };
    } catch (error) {
      const reason = error?.name === 'AbortError' ? 'timeout' : 'request_failed';
      this.logger?.warn?.('groq_nlu.request_failed', { reason, error:error?.message });
      return this.failure(reason, started);
    } finally {
      clearTimeout(timer);
    }
  }

  failure(error, started, extra = {}) {
    if (this.failureCooldownMs > 0) this.circuitOpenUntil = Number(this.now()) + this.failureCooldownMs;
    return { success:false, error, model:this.model, latencyMs:elapsed(started), ...extra };
  }

  circuitState() {
    const retryAfterMs = Math.max(0, this.circuitOpenUntil - Number(this.now()));
    return Object.freeze({ open:retryAfterMs > 0, retryAfterMs });
  }
}

function elapsed(started) { return Number((performance.now() - started).toFixed(3)); }

// Groq strict structured outputs use a JSON Schema subset. Every object field
// must be required and every object closed. Nova keeps richer constraints in
// NOVA_NLU_SCHEMA for local validation, while this provider copy removes
// constraints that Groq strict mode does not document as supported. A `const`
// becomes a single-value enum so the semantic constraint is preserved.
function providerStrictSchema(schema) {
  const copy=structuredClone(schema);
  visit(copy);
  return copy;
}
function visit(node){
  if(!node||typeof node!=='object')return;
  if(Object.hasOwn(node,'const')){
    node.enum=[node.const];
    delete node.const;
  }
  for(const keyword of ['pattern','maxItems','uniqueItems'])delete node[keyword];
  if((node.type==='object'||(Array.isArray(node.type)&&node.type.includes('object')))&&node.properties){
    node.required=Object.keys(node.properties);
    node.additionalProperties=false;
    for(const child of Object.values(node.properties))visit(child);
  }
  if(node.items)visit(node.items);
  for(const child of node.anyOf||[])visit(child);
  for(const child of Object.values(node.$defs||{}))visit(child);
}

async function readProviderError(response){
  let raw='';
  try{
    if(typeof response.text==='function')raw=await response.text();
    else if(typeof response.json==='function')raw=JSON.stringify(await response.json());
  }catch{}
  let body=null;
  try{body=raw?JSON.parse(raw):null;}catch{}
  const providerMessage=cleanProviderText(body?.error?.message||body?.message||raw||null);
  const providerErrorType=cleanProviderText(body?.error?.type||body?.type||null);
  const requestId=cleanProviderText(response?.headers?.get?.('x-request-id')||null);
  return {
    providerMessage,
    providerErrorType,
    providerRequestId:requestId
  };
}

function cleanProviderText(value){
  if(typeof value!=='string'||!value.trim())return null;
  return value.replace(/\s+/g,' ').trim().slice(0,1000);
}

module.exports = { GroqNluClient, GROQ_NLU_SCHEMA, providerStrictSchema, readProviderError };
