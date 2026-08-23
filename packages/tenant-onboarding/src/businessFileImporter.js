
function splitList(v){
  if(Array.isArray(v))return v.map(String).map(x=>x.trim()).filter(Boolean);
  return String(v||'').split(/[|;,]/).map(x=>x.trim()).filter(Boolean);
}
function num(v){if(v===null||v===undefined||v==='')return undefined;const n=Number(v);return Number.isFinite(n)?n:undefined;}
function bool(v, fallback=false){if(v===undefined||v===null||v==='')return fallback;if(typeof v==='boolean')return v;return /^(true|yes|1|y)$/i.test(String(v));}
function normalizeOffering(x={}){
  const type=String(x.type||x.kind||x.offeringType||'product').toLowerCase().includes('service')?'service':'product';
  return {
    ...(x.id?{id:String(x.id)}:{}),
    name:String(x.name||x.title||x.product||x.service||'').trim(),
    type,
    category:String(x.category||x.group||'general').trim()||'general',
    description:String(x.description||x.summary||x.details||'').trim(),
    ...(num(x.price)!==undefined?{price:num(x.price)}:{}),
    ...(x.currency?{currency:String(x.currency).trim()}:{}),
    ...(x.unit?{unit:String(x.unit).trim()}:{}),
    aliases:splitList(x.aliases||x.synonyms||x.keywords),
    sizes:splitList(x.sizes),
    colors:splitList(x.colors||x.colours),
    tags:splitList(x.tags),
    inStock:x.inStock===undefined?true:bool(x.inStock,true),
    ...(num(x.inventory)!==undefined?{inventory:num(x.inventory)}:{}),
    ...(num(x.durationMinutes)!==undefined?{durationMinutes:num(x.durationMinutes)}:{}),
    bookable:type==='service' ? (x.bookable===undefined?true:bool(x.bookable,true)) : false,
    orderable:type==='product' ? (x.orderable===undefined?true:bool(x.orderable,true)) : false
  };
}
function normalizeFaq(x={}){
  if(typeof x==='string')return {question:'',answer:x};
  return {question:String(x.question||x.q||'').trim(),answer:String(x.answer||x.a||'').trim()};
}
function fromJson(value){
  if(Array.isArray(value))return {offerings:value.map(normalizeOffering).filter(x=>x.name),faqs:[]};
  if(!value||typeof value!=='object')throw new Error('Business JSON must be an object or offering array.');
  const rawOfferings=[
    ...(Array.isArray(value.offerings)?value.offerings:[]),
    ...(Array.isArray(value.products)?value.products.map(x=>({...x,type:'product'})):[]),
    ...(Array.isArray(value.services)?value.services.map(x=>typeof x==='string'?{name:x,type:'service'}:{...x,type:x.type||'service'}):[])
  ];
  return {
    id:String(value.id||'').trim()||undefined,
    name:String(value.name||value.businessName||'').trim(),
    domain:String(value.domain||value.businessType||value.type||'generic').trim()||'generic',
    description:String(value.description||value.summary||'').trim(),
    hours:String(value.hours||value.timings||value.businessHours||'').trim(),
    location:String(value.location||value.address||'').trim(),
    contact:String(value.contact||value.phone||value.contactNumber||'').trim(),
    assistantName:String(value.assistantName||'').trim()||undefined,
    currency:String(value.currency||'').trim()||undefined,
    paymentMethods:splitList(value.paymentMethods),
    offerings:rawOfferings.map(normalizeOffering).filter(x=>x.name),
    faqs:(Array.isArray(value.faqs)?value.faqs:[]).map(normalizeFaq).filter(x=>x.question||x.answer),
    businessFacts:value.businessFacts&&typeof value.businessFacts==='object'?value.businessFacts:{}
  };
}
function parseCsv(text){
 const lines=String(text||'').split(/\r?\n/).filter(x=>x.trim());if(!lines.length)return [];
 const headers=parseCsvLine(lines[0]).map(x=>x.trim());
 return lines.slice(1).map(line=>{const vals=parseCsvLine(line);return Object.fromEntries(headers.map((h,i)=>[h,vals[i]??'']));});
}
function parseCsvLine(line){
 const out=[];let cur='',quoted=false;
 for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){cur+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){out.push(cur);cur='';}else cur+=c;}out.push(cur);return out;
}
function importBusinessFile({name='',text=''}) {
 const ext=(String(name).match(/(\.[^.]+)$/)||[])[1]?.toLowerCase()||'';
 if(ext==='.json'||String(text).trim().startsWith('{')||String(text).trim().startsWith('[')) return {format:'json',spec:fromJson(JSON.parse(text))};
 if(ext==='.csv') return {format:'csv',spec:{offerings:parseCsv(text).map(normalizeOffering).filter(x=>x.name),faqs:[]}};
 throw new Error('Structured Business Data supports JSON or CSV. Use Additional Knowledge for TXT/Markdown.');
}
module.exports={importBusinessFile,fromJson,normalizeOffering,parseCsv,splitList};
