const DEFAULT_DIMENSIONS=384;

// This is deliberately provider-based. The bundled provider is deterministic
// and dependency-free; a neural embedding provider can implement the same
// embed(text) contract later without changing KnowledgeIndex or business flows.
class LocalSemanticEmbeddingProvider{
 constructor({dimensions=DEFAULT_DIMENSIONS}={}){this.dimensions=dimensions;}
 embed(text){
   const v=new Float64Array(this.dimensions);
   const normalized=semanticNormalize(text);
   const words=normalized.split(/\s+/).filter(Boolean);
   for(const raw of words){
     const token=stem(raw);
     add(v,`w:${token}`,1.25);
     for(const concept of conceptsFor(token))add(v,`c:${concept}`,2.1);
     if(token.length>=4){
       const padded=`^${token}$`;
       for(let i=0;i<=padded.length-3;i++)add(v,`g:${padded.slice(i,i+3)}`,0.16);
     }
   }
   for(let i=0;i<words.length-1;i++)add(v,`b:${stem(words[i])}_${stem(words[i+1])}`,0.45);
   normalize(v);return Array.from(v);
 }
}
function semanticNormalize(v){
 return String(v||'').toLowerCase()
   .replace(/[^\p{L}\p{N}]+/gu,' ')
   .replace(/\b(serving|served|serves)\b/g,' serve')
   .replace(/\b(areas|locations|places)\b/g,' area')
   .replace(/\b(cleaners|maids|workers|staff members)\b/g,' cleaner')
   .replace(/\b(employ|employed|employees|workforce)\b/g,' staff')
   .replace(/\b(pays|paid|paying)\b/g,' pay')
   .replace(/\b(charges|fees|costs)\b/g,' charge')
   .replace(/\b(staying|stays|stayed|remain|remaining|present)\b/g,' stay')
   .replace(/\b(materials|supplies|products|equipment)\b/g,' material')
   .replace(/\b(recurring|regularly|weekly|monthly)\b/g,' recurrence')
   .replace(/\s+/g,' ').trim();
}
const CONCEPTS={
 serve:['coverage','location_service'],
 service:['offering'],
 area:['coverage','location_service'],
 location:['coverage','location_service'],
 coverage:['coverage','location_service'],
 parking:['parking'],
 pay:['payment_responsibility'],
 responsible:['payment_responsibility'],
 customer:['customer'],
 pet:['pet'],
 dog:['pet'],
 cat:['pet'],
 animal:['pet'],
 furniture:['furniture'],
 wardrobe:['furniture','heavy_item'],
 heavy:['heavy_item'],
 move:['movement'],
 cleaner:['cleaner_staff'],
 staff:['cleaner_staff','workforce'],
 number:['count'],
 many:['count'],
 count:['count'],
 total:['count'],
 employee:['workforce'],
 deep:['deep_cleaning'],
 maid:['cleaner_staff'],
 hour:['duration'],
 villa:['property_villa'],
 apartment:['property_apartment'],
 home:['property_home'],
 stay:['customer_presence'],present:['customer_presence'],presence:['customer_presence'],
 material:['cleaning_materials'],supply:['cleaning_materials'],
 recurrence:['recurring_service'],weekly:['recurring_service'],monthly:['recurring_service'],
 sunday:['weekend_availability'],weekend:['weekend_availability'],today:['same_day'],same:['same_day']
};
function conceptsFor(token){return CONCEPTS[token]||[];}
function stem(t){
 let x=String(t||'');
 for(const suffix of ['ing','ers','ies','ed','es','s'])if(x.length>suffix.length+3&&x.endsWith(suffix)){x=x.slice(0,-suffix.length);break;}
 return x;
}
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function add(v,key,weight){const h=hash(key),idx=h%v.length,sign=(h&0x80000000)?-1:1;v[idx]+=sign*weight;}
function normalize(v){let n=0;for(const x of v)n+=x*x;n=Math.sqrt(n)||1;for(let i=0;i<v.length;i++)v[i]/=n;}
function cosine(a,b){let dot=0,aa=0,bb=0;const n=Math.min(a.length,b.length);for(let i=0;i<n;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}return aa&&bb?dot/(Math.sqrt(aa)*Math.sqrt(bb)):0;}
module.exports={LocalSemanticEmbeddingProvider,semanticNormalize,cosine,DEFAULT_DIMENSIONS};
