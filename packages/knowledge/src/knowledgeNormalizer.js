
function clean(v){return String(v??'').replace(/\s+/g,' ').trim();}
function tokens(v){return clean(v).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').split(/\s+/).filter(x=>x.length>1);}
function flatten(value,prefix='',out=[]){
  if(value==null)return out;
  if(Array.isArray(value)){value.forEach((v,i)=>flatten(v,`${prefix}[${i}]`,out));return out;}
  if(typeof value==='object'){for(const [k,v] of Object.entries(value))flatten(v,prefix?`${prefix}.${k}`:k,out);return out;}
  const text=clean(value); if(text)out.push({path:prefix,text}); return out;
}
function chunkText(text,{maxChars=900}={}){
  const parts=String(text||'').split(/\n\s*\n/).map(clean).filter(Boolean), out=[];
  for(const part of parts){
    if(part.length<=maxChars){out.push(part);continue;}
    const sentences=part.split(/(?<=[.!?])\s+/); let cur='';
    for(const sentence of sentences){
      if(cur && (cur.length+sentence.length+1)>maxChars){out.push(cur);cur='';}
      cur=clean(`${cur} ${sentence}`);
    }
    if(cur)out.push(cur);
  }
  return out;
}

function sanitizeCustomerEvidence(text){
  const lines=String(text||'').split(/\r?\n/), kept=[];
  const internal=/\b(?:nova|the assistant|assistant|the agent|agent)\b.*\b(?:should|must|never|do not|don\'t|cannot|can not)\b|\b(?:must not promise|should answer using|must never invent|do not invent|should not promise)\b|\bcustomers? may ask\b|\bthe customer should be offered\b|\bthe assistant must\b|\bthe assistant should\b/i;
  for(const line of lines){
    if(!line.trim()) { kept.push(line); continue; }
    if(internal.test(line)) continue;
    const sentences=line.split(/(?<=[.!?])\s+/).filter(x=>!internal.test(x));
    if(sentences.length)kept.push(sentences.join(' '));
  }
  return kept.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
function inferEvidenceType(text,path=''){
  const raw=`${path||''} ${text||''}`;
  const safe=sanitizeCustomerEvidence(text);
  if(!safe && /\b(?:nova|assistant)\b/i.test(raw))return 'internal_instruction';
  if(/\b(policy|cancellation|parking|pets?|materials?|payment|discount|weekend|same-day|same day|recurring|presence|window|balcony|furniture)\b/i.test(raw))return 'customer_policy';
  return 'customer_fact';
}
function normalizeFaqs(name,faqs){
  return (Array.isArray(faqs)?faqs:[]).map((faq,i)=>{
    const question=clean(faq?.question||faq?.q||'');
    const answer=clean(faq?.answer||faq?.a||'');
    return {
      id:`${name}:faq:${i}`,source:name,path:`faq[${i}]`,
      text:sanitizeCustomerEvidence(answer),
      question,
      evidenceType:'faq',
      tokens:tokens(`${question} ${answer}`)
    };
  }).filter(x=>x.text);
}
// H8 fix (Phase 1 item 2): fields in business.json / documents/*.json that are
// INTERNAL configuration (instructions TO the assistant, prompt/persona config,
// messaging rules), not customer-facing facts. These must never be retrievable
// as answers — a visitor asking "lol" was being shown
// "messagingRules[6]: Avoid technical jargon in the first response." because
// the whole business.json was flattened into the index. Tagging these paths as
// internal_instruction + customerSafe:false makes fileKnowledgeRepository's
// existing filter (customerSafe!==false && evidenceType!=='internal_instruction')
// drop them before they can ever be retrieved.
const INTERNAL_CONFIG_PATH_RE = /^(?:messagingRules|prompts?|persona|instructions|systemPrompt|system_prompt|internalNotes|internal_notes|testerNotes|tester_notes|agentNotes|agent_notes|debugInfo|debug_info|policies|policy)\b(\.|$|\[)/i;

// H8 fix: Markdown/plain-text headings that mark a section as INTERNAL config
// (instructions TO the assistant), not customer-facing facts. Used by
// normalizeText to tag the section's chunks as internal_instruction +
// customerSafe:false so the repository filter drops them. Matches the
// `## Messaging rules` heading in nova-product-facts.md that leaked
// "Avoid technical jargon in the first response." to visitors.
const INTERNAL_HEADING_RE = /^(?:messaging\s*rules?|prompts?|persona|instructions?|system\s*prompts?|internal\s*notes?|tester\s*notes?|agent\s*notes?|debug\s*info|policies?|policy)\b/i;

function normalizeJson(name,value){
  return flatten(value).map((x,i)=>{
    const isInternalConfig = INTERNAL_CONFIG_PATH_RE.test(x.path);
    return {
      id:`${name}:json:${i}`,source:name,path:x.path,
      // H8: internal-config fields are stripped of their text so even a leaked
      // chunk carries no payload; the evidenceType + customerSafe flags ensure
      // the repository filter drops them entirely.
      text: isInternalConfig ? '' : `${x.path}: ${x.text}`,
      tokens: isInternalConfig ? [] : tokens(`${x.path} ${x.text}`),
      evidenceType: isInternalConfig ? 'internal_instruction' : inferEvidenceType(x.text, x.path),
      customerSafe: !isInternalConfig,
    };
  }).filter(x => x.text);  // drop the emptied internal-config chunks
}
function markdownSections(text,{maxChars=1400}={}){
  const lines=String(text||'').split(/\r?\n/),sections=[];let heading='',body=[];
  const flush=()=>{
    const content=body.join('\n').trim();
    if(content||heading){
      const value=content||heading;
      const chunks=value.length<=maxChars?[value]:chunkText(value,{maxChars});
      for(const part of chunks)sections.push({heading:heading.replace(/^#{1,6}\s*/,''),text:part});
    }
    body=[];
  };
  for(const line of lines){
    if(/^#{1,6}\s+/.test(line)){flush();heading=line.trim();}
    else body.push(line);
  }
  flush();return sections;
}
function plainSections(text,{maxChars=1200}={}){
  const lines=String(text||'').split(/\r?\n/),sections=[];let heading='',body=[];
  const pageFooter=/^.{0,100}\s[-–—]\s.{0,100}\bpage\s+\d+\s*$/i;
  const flush=()=>{
    const content=body.join('\n').trim();
    if(!content&&!heading){body=[];return;}
    const prefix=heading?`${heading}\n`:'';
    const combined=`${prefix}${content}`.trim();
    const chunks=combined.length<=maxChars?[combined]:chunkText(content,{maxChars:Math.max(500,maxChars-prefix.length)}).map(x=>`${prefix}${x}`.trim());
    for(const part of chunks)if(part)sections.push({heading:heading.replace(/^\d{1,3}\.\s*/,''),text:part});
    body=[];
  };
  for(const raw of lines){
    const line=raw.trim();
    if(pageFooter.test(line)||/^--\s*\d+\s+of\s+\d+\s*--$/i.test(line))continue;
    if(/^\d{1,3}\.\s+\S/.test(line)){flush();heading=line;continue;}
    body.push(raw);
  }
  flush();return sections;
}
function normalizeText(name,text){
  const isMd=String(name).toLowerCase().endsWith('.md');
  // v55.0: delegate to the structure-aware chunker when available. It keeps
  // heading + body together, keeps lists/tables as one chunk, carries parent
  // heading context, and respects per-kind max-chars defaults.
  let structureAware=null;
  try{structureAware=require('./structureAwareChunker').structureAwareChunk;}catch{structureAware=null;}
  const sections=isMd?markdownSections(text):plainSections(text);
  const chunks=structureAware?structureAware(text,{kind:'document',sourceName:name}):sections.map(s=>({heading:s.heading,text:s.text,sourceLocation:{lineStart:1,lineEnd:1}}));
  return chunks.map((x,i)=>{
    const heading=x.heading||null;
    const body=String(x.text||'').trim();
    // H8 fix (Phase 1 item 2): a Markdown section under an INTERNAL-config
    // heading (messaging rules, prompts, persona, instructions, system prompt,
    // tester notes, etc.) is configuration TO the assistant, not a customer
    // fact. The old regex only caught "agent testing notes|tester notes|
    // internal instructions", so a `## Messaging rules` section in
    // nova-product-facts.md was indexed as customer_fact and leaked
    // "Avoid technical jargon in the first response." to visitors. Tagging
    // these headings as internal_instruction + customerSafe:false makes the
    // repository filter drop them entirely.
    const internal=/\b(agent testing notes?|tester notes?|internal instructions?|instructions? for (?:the )?(?:agent|assistant|tester))\b/i.test(heading||'')
      || INTERNAL_HEADING_RE.test(String(heading||''));
    const customerText=internal?'':sanitizeCustomerEvidence(body);
    const evidenceType=internal?'internal_instruction':inferEvidenceType(body,heading);
    const out={id:`${name}:${isMd?'md':'text'}:${i}`,source:name,path:heading,text:customerText||body,evidenceType,customerSafe:!internal&&Boolean(customerText),tokens:tokens(`${heading||''} ${customerText||body}`)};
    if(x.sourceLocation)out.sourceLocation=x.sourceLocation;
    return out;
  });
}
module.exports={clean,tokens,flatten,chunkText,markdownSections,plainSections,sanitizeCustomerEvidence,inferEvidenceType,normalizeFaqs,normalizeJson,normalizeText};
