
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
function normalizeJson(name,value){
  return flatten(value).map((x,i)=>({id:`${name}:json:${i}`,source:name,path:x.path,text:`${x.path}: ${x.text}`,tokens:tokens(`${x.path} ${x.text}`)}));
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
  if(String(name).toLowerCase().endsWith('.md'))return markdownSections(text).map((x,i)=>{
    const heading=x.heading||null;
    const body=String(x.text||'').trim();
    const customerText=sanitizeCustomerEvidence(body);
    const evidenceType=inferEvidenceType(body,heading);
    return {id:`${name}:md:${i}`,source:name,path:heading,text:customerText||body,evidenceType,customerSafe:Boolean(customerText),tokens:tokens(`${heading||''} ${customerText||body}`)};
  });
  return plainSections(text).map((x,i)=>{
    const heading=x.heading||null,body=String(x.text||'').trim();
    const internal=/\b(agent testing notes?|tester notes?|internal instructions?|instructions? for (?:the )?(?:agent|assistant|tester))\b/i.test(heading||'');
    const customerText=internal?'':sanitizeCustomerEvidence(body);
    const evidenceType=internal?'internal_instruction':inferEvidenceType(body,heading);
    return {id:`${name}:text:${i}`,source:name,path:heading,text:customerText||body,evidenceType,customerSafe:!internal&&Boolean(customerText),tokens:tokens(`${heading||''} ${customerText||body}`)};
  });
}
module.exports={clean,tokens,flatten,chunkText,markdownSections,plainSections,sanitizeCustomerEvidence,inferEvidenceType,normalizeFaqs,normalizeJson,normalizeText};
