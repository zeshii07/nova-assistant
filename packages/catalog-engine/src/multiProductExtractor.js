const {AttributeExtractor,levenshtein}=require('./attributeExtractor');

const STOP=new Set(['super','premium','quality','pack','packet','litre','liter','kg','g','gram','grams','the','a','an','phone']);
const NUMBER_WORDS={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,ek:1,aik:1,do:2,teen:3,char:4,chaar:4,paanch:5};
const attributes=new AttributeExtractor();

function norm(v){return String(v||'').toLowerCase().replace(/[-_/]+/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();}
function significantNameTerms(product){
 const aliases=(product.aliases||[]).map(norm).filter(Boolean);
 const out=new Set(aliases);
 const name=norm(product.name);
 if(name)out.add(name);
 const sources=[name,...aliases];
 for(const source of sources){
   const words=source.split(' ').filter(w=>w.length>=3&&!STOP.has(w)&&!/^\d/.test(w));
   for(const w of words)out.add(w);
   for(let i=0;i<words.length-1;i++)out.add(`${words[i]} ${words[i+1]}`);
 }
 return [...out].sort((a,b)=>b.length-a.length);
}

function splitRequests(text){
 return String(text||'')
   .toLowerCase()
   .replace(/[-_/]+/g,' ')
   .replace(/[,;+\n]+/g,' | ')
   .replace(/\s+(?:and|plus|also|aur)\s+/g,' | ')
   .split('|')
   .map(norm)
   .filter(Boolean);
}

function quantityFromSegment(segment,product,resolvedSize=null){
 const s=norm(segment);
 const explicit=s.match(/\b(?:qty|quantity)\s*(\d{1,3})\b|\b(\d{1,3})\s*(?:pieces?|pcs?|items?|units?|packs?|packets?)\b/);
 if(explicit)return safeQuantity(Number(explicit[1]||explicit[2]));
 const measured=s.match(/\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|ek|aik|do|teen|char|chaar|paanch)\s*(?:kg|kgs|kilograms?|liters?|litres?|packs?|packets?)\b/);
 if(measured)return safeQuantity(NUMBER_WORDS[measured[1]]||Number(measured[1]));
 const variantCount=s.match(/\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|ek|aik|do|teen|char|chaar|paanch)\s+(?=(?:extra\s+large|xl|large|medium|small|xs|s|m|l)\b)/);
 if(variantCount)return safeQuantity(NUMBER_WORDS[variantCount[1]]||Number(variantCount[1]));
 const leading=s.match(/^(?:i\s+(?:want|need)(?:\s+to\s+order)?\s+|please\s+order\s+|order\s+)?(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|ek|aik|do|teen|char|chaar|paanch)\b/);
 if(leading){
   const value=NUMBER_WORDS[leading[1]]||Number(leading[1]);
   const numericSizes=new Set((product?.sizes||[]).map(Number).filter(Number.isFinite));
   if(!(numericSizes.has(value)&&String(value)===String(resolvedSize||'')))return safeQuantity(value);
 }
 return 1;
}
function safeQuantity(value){return Number.isInteger(value)&&value>=1&&value<=100?value:1;}

function scoreProduct(segment,product){
 const s=norm(segment), terms=significantNameTerms(product);
 let best=0,term=null;
 for(const t of terms){
   const exact=wordForms(t).some(form=>new RegExp(`(?:^|\\s)${escapeRe(form)}(?:$|\\s)`).test(` ${s} `));
   const fuzzy=!exact&&t.split(' ').length>=2?fuzzyPhraseDistance(s,t):null;
   if(exact||fuzzy!=null){
     const score=t.split(' ').length*10+t.length-(fuzzy||0)*2;
     if(score>best){best=score;term=t;}
   }
 }
 return {score:best,term};
}

function wordForms(term){
 const value=norm(term),forms=[value],words=value.split(' ');
 const last=words[words.length-1];
 let plural;
 if(last.endsWith('y')&&last.length>2)plural=`${last.slice(0,-1)}ies`;
 else if(last.endsWith('s'))plural=`${last}es`;
 else plural=`${last}s`;
 forms.push([...words.slice(0,-1),plural].join(' '));
 return [...new Set(forms)];
}

// Product identity tolerates one bounded typo inside a multi-word name when
// another word still matches exactly. This recognizes "smrt watch" without
// turning arbitrary one-word fuzzy matches into products.
function fuzzyPhraseDistance(segment,term){
 const source=norm(segment).split(' '),target=norm(term).split(' ');
 if(target.length<2||source.length<target.length)return null;
 let best=null;
 for(let i=0;i<=source.length-target.length;i++){
   let distance=0,exactWords=0,valid=true;
   for(let j=0;j<target.length;j++){
     const a=source[i+j],b=target[j];
     if(a===b){exactWords++;continue;}
     if(a.length<3||b.length<4||Math.abs(a.length-b.length)>1){valid=false;break;}
     const d=levenshtein(a,b);
     if(d>1){valid=false;break;}
     distance+=d;
   }
   if(valid&&exactWords>=1&&distance>=1&&(best==null||distance<best))best=distance;
 }
 return best;
}

function extractProductRequests(text,products=[]){
 const segments=splitRequests(text),items=[],ambiguous=[],leadingVariantSegments=[];
 let inheritedProduct=null;
 for(const segment of segments){
   const ranked=products.map(p=>({product:p,...scoreProduct(segment,p)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
   if(!ranked.length){
     if(inheritedProduct){
       const attrs=attributes.extract(segment,inheritedProduct);
       if((attrs.color||attrs.size)&&isVariantContinuation(segment,attrs)){
         items.push(toItem(inheritedProduct,segment,quantityFromSegment(segment,inheritedProduct,attrs.size),attrs,true));
       }
     }else if(looksLikeDetachedVariant(segment)){
       // Natural Roman-Urdu and English requests often put the product last:
       // "2 large aur aik small ... polo shirt". Keep the leading variant
       // clauses until the single explicit product identity is known.
       leadingVariantSegments.push(segment);
     }
     continue;
   }

   // Preserve support for compact messages that omit a separator between two
   // explicit product names.
   const strong=ranked.filter(x=>{
     const term=norm(x.term||''), name=norm(x.product.name||'');
     return term && (term===name || term.split(' ').length>=2);
   });
   const rankedByProduct=[...new Map(ranked.map(x=>[x.product.id,x])).values()];
   const positions=rankedByProduct.map(x=>({...x,position:phrasePosition(segment,x.term),length:norm(x.term).length}));
   // A short alias such as "shirt" is safe when the caller has narrowed the
   // products to one pending shirt. Against the full catalog it stays ambiguous.
   const locallyUnambiguous=positions.filter(x=>x.position>=0&&!positions.some(other=>{
     if(other.product.id===x.product.id||other.position<0)return false;
     const xEnd=x.position+x.length,otherEnd=other.position+other.length;
     return x.position<otherEnd&&other.position<xEnd;
   }));
   // Prefer the longest non-overlapping identities. Without this guard a full
   // product such as "Small Fruit Gift Basket" is incorrectly split into the
   // real product plus another catalog item that happens to alias "gift
   // basket". Disjoint exact names are still preserved as separate products.
   let identityCandidates=[...new Map([...strong,...locallyUnambiguous].map(x=>[x.product.id,x])).values()];
   const specificIdentities=identityCandidates.filter(x=>norm(x.term).split(' ').length>=2);
   if(specificIdentities.length){
     identityCandidates=identityCandidates.filter(candidate=>{
       const term=norm(candidate.term);
       if(term.split(' ').length!==1)return true;
       // A generic family word inside a more specific identity is not another
       // requested product. "small shirt ... polo shirt" means Polo Shirt,
       // not Cotton T-Shirt plus Polo Shirt.
       return !specificIdentities.some(specific=>norm(specific.term).split(' ').includes(term));
     });
   }
   const distinctStrong=maximalIdentityMatches(segment,identityCandidates);
   if(distinctStrong.length>1){
     const localSegments=productLocalSegments(segment,distinctStrong);
     for(const x of distinctStrong){
       const local=localSegments.get(x.product.id)||segment;
       const attrs=attributes.extract(local,x.product);
       items.push(toItem(x.product,local,quantityFromSegment(local,x.product,attrs.size),attrs,false));
     }
     inheritedProduct=distinctStrong[distinctStrong.length-1].product;
     continue;
   }

   const top=ranked[0], same=ranked.filter(x=>x.score===top.score);
   const attrs=attributes.extract(segment,top.product);
   const quantity=quantityFromSegment(segment,top.product,attrs.size);
   if(same.length>1 && String(top.term||'').split(' ').length===1){
     // A later shorthand variant clause ("t-shirts white, size small")
     // belongs to the only matching product already named earlier in the same
     // compound request. Keep it ambiguous when two matching shirt products
     // were actually named, so the engine never silently guesses.
     const mentionedIds=new Set(items.map(item=>item.productId));
     const mentioned=same.filter(candidate=>mentionedIds.has(candidate.product.id));
     if(mentioned.length===1){
       const selected=mentioned[0].product;
       const selectedAttrs=attributes.extract(segment,selected);
       items.push(toItem(selected,segment,quantityFromSegment(segment,selected,selectedAttrs.size),selectedAttrs,true));
       inheritedProduct=selected;
     }else{
       ambiguous.push({segment,quantity,term:top.term,candidates:same.map(x=>({productId:x.product.id,name:x.product.name}))});
       inheritedProduct=null;
     }
   }else{
     items.push(toItem(top.product,segment,quantity,attrs,false));
     inheritedProduct=top.product;
   }
 }
 const productIds=[...new Set(items.map(item=>item.productId))];
 if(leadingVariantSegments.length&&productIds.length===1&&!ambiguous.length){
   const product=products.find(entry=>entry.id===productIds[0]);
   if(product){
     const inherited=[];
     for(const segment of leadingVariantSegments){
       const attrs=attributes.extract(segment,product);
       if(!attrs.color&&!attrs.size)continue;
       inherited.push(toItem(product,segment,quantityFromSegment(segment,product,attrs.size),attrs,true));
     }
     if(inherited.length)items.unshift(...inherited);
   }
 }
 return {items:collapseVariantHeaders(items),ambiguous,segments};
}

function looksLikeDetachedVariant(segment){
 const s=norm(segment);
 const attribute=/\b(extra\s+large|xl|large|medium|small|xs|black|white|blue|navy|brown|silver|gold)\b/.test(s);
 const quantity=/\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|ek|aik|do|teen|char|chaar|paanch)\b/.test(s);
 return attribute&&quantity;
}

function maximalIdentityMatches(segment,matches){
 const spans=matches.map(match=>{
   const start=phrasePosition(segment,match.term),length=norm(match.term).length;
   return {...match,start,end:start<0?-1:start+length,length};
 });
 return spans.filter(current=>!spans.some(other=>
   other.product.id!==current.product.id
   && current.start>=0&&other.start>=0
   && other.start<=current.start&&other.end>=current.end
   && other.length>current.length
   && other.score>=current.score
 )).map(({start,end,length,...match})=>match);
}

function phrasePosition(segment,term){
 const source=` ${norm(segment)} `,needle=` ${norm(term)} `;
 const index=source.indexOf(needle);
 return index<0?-1:Math.max(0,index-1);
}
function productLocalSegments(segment,matches){
 const source=norm(segment);
 const ordered=matches.map(match=>({...match,position:phrasePosition(source,match.term)})).filter(x=>x.position>=0).sort((a,b)=>a.position-b.position);
 const out=new Map();
 for(let index=0;index<ordered.length;index+=1){
   const current=ordered[index],next=ordered[index+1];
   out.set(current.product.id,source.slice(index===0?0:current.position,next?next.position:source.length).trim());
 }
 return out;
}

function isVariantContinuation(segment,attrs){
 const s=norm(segment);
 if(/^(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|ek|aik|do|teen|char|chaar|paanch)\b/.test(s))return true;
 if(attrs.color&&s.startsWith(norm(attrs.color)))return true;
 return /^(?:in\s+)?size\b/.test(s);
}

function toItem(product,segment,quantity,attrs,inherited){
 return {productId:product.id,name:product.name,quantity,color:attrs.color||null,size:attrs.size||null,segment,...(inherited?{inherited:true}:{})};
}

function collapseVariantHeaders(items){
 const remove=new Set();
 for(let i=0;i<items.length;i++){
   const header=items[i];
   if(header.quantity<=1||header.color||header.size)continue;
   const variants=[];
   for(let j=i+1;j<items.length&&items[j].productId===header.productId&&items[j].inherited;j++)variants.push(items[j]);
   if(variants.length>=2&&variants.every(x=>x.color||x.size)&&variants.reduce((sum,x)=>sum+x.quantity,0)===header.quantity)remove.add(i);
 }
 return items.filter((_,index)=>!remove.has(index)).map(({inherited,...item})=>item);
}

function extractMultiProducts(text,products=[]){return extractProductRequests(text,products).items;}
function escapeRe(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
module.exports={extractMultiProducts,extractProductRequests,splitRequests,significantNameTerms,quantityFromSegment,maximalIdentityMatches};
