const {canonicalize}=require('../../universal-vocabulary/src');
const {NluContextBuilder}=require('../../multilingual-nlu/src/nluContextBuilder');
const {TRAINING_EXAMPLES}=require('./trainingExamples');
const {hasAcquisitionCue}=require('../../conversation-intelligence/src/acquisitionIntent');

const INFORMATION_INTENTS=new Set([
  'service.list','service.info','service.price','service.duration',
  'product.list','product.info','product.price','product.stock','cart.view',
  'booking.status','order.status','availability.check',
  'business.info','business.name','business.contact','business.hours','business.location','business.policy'
]);
const CHANGE_INTENTS=new Set([
  'booking.modify','booking.cancel','cart.remove','cart.update','order.modify',
  'order.cancel','order.return','order.exchange','conversation.correct'
]);
const TRANSACTIONAL_INTENTS=new Set([
  'booking.create','booking.modify','booking.cancel','cart.add','cart.remove','cart.update',
  'order.create','order.modify','order.cancel','order.return','order.exchange',
  'customer.update','conversation.confirm','conversation.reject','conversation.correct'
]);
const SOCIAL_INTENTS=new Set(['conversation.greeting','conversation.thanks','conversation.small_talk']);

/**
 * A small, dependency-free statistical router.
 *
 * It trains a multinomial Naive Bayes classifier over word, word-bigram,
 * prefix and character n-gram features, then calibrates that probability with
 * nearest-paraphrase cosine similarity. It never generates text, calls tools,
 * reads cross-tenant data, or executes an action.
 */
class LightweightSemanticRouter{
  constructor({
    enabled=true,
    examples=TRAINING_EXAMPLES,
    contextBuilder=new NluContextBuilder(),
    minConfidence=.76,
    minMargin=.08,
    minSimilarity=.2,
    maxLocalIntents=2,
    logger=null
  }={}){
    this.enabled=enabled;
    this.examples=examples;
    this.contextBuilder=contextBuilder;
    this.minConfidence=minConfidence;
    this.minMargin=minMargin;
    this.minSimilarity=minSimilarity;
    this.maxLocalIntents=maxLocalIntents;
    this.logger=logger;
    this.model=train(examples);
  }

  async analyze({tenant,message,state,services={},pending=null,messageFrame=null,clauseSemantics=null}={}){
    const started=performance.now();
    if(!this.enabled||tenant?.features?.semanticRouter===false)return disabledResult();
    const raw=String(message?.text||'').trim();
    if(!raw)return emptyResult();
    let context={vocabulary:[],tenant:{enabled_capabilities:[...(tenant?.capabilities||[])]}};
    try{context=await this.contextBuilder.build({tenant,state,services,pending});}
    catch(error){this.logger?.warn?.('semantic_router.context_failed',{error:error.message});}

    const tenantMatches=matchTenantVocabulary(raw,context.vocabulary||[]);
    const whole=this.classify(raw,{tenant,context,tenantMatches,pending});
    const clauses=semanticClauses(raw,clauseSemantics);
    const clauseRoutes=clauses.length>1
      ? clauses.map(text=>({text,...this.classify(text,{tenant,context,tenantMatches:matchTenantVocabulary(text,context.vocabulary||[]),pending})}))
      : [];
    const intents=collectIntents(whole,clauseRoutes);
    const primary=choosePrimary(intents,whole);
    const signals=complexitySignals(raw,{pending,messageFrame,clauseRoutes,intents});
    const ambiguity=ambiguitySignals(raw,{pending,primary,whole,messageFrame,tenantMatches});
    const accepted=Boolean(primary)
      &&primary.confidence>=this.minConfidence
      &&primary.margin>=this.minMargin
      &&primary.similarity>=this.minSimilarity
      &&ambiguity.length===0
      &&intents.filter(item=>!SOCIAL_INTENTS.has(item.name)).length<=this.maxLocalIntents;
    const escalation=escalationDecision({accepted,primary,intents,signals,ambiguity,thresholds:this});
    const messageSemantics=describeMessage(primary?.name||'other',raw,Boolean(pending),ambiguity);
    return Object.freeze({
      version:'1.0',engine:'local_statistical_semantic_router',model:'seeded_multinomial_nb_char_word_v1',
      used:true,accepted,decision:accepted?'accepted':escalation.reason==='complex_multi_intent'?'complex':'uncertain',
      language:detectLanguage(raw),
      primaryIntent:primary,
      intents:Object.freeze(intents.slice(0,8).map(Object.freeze)),
      message:Object.freeze(messageSemantics),
      workflow:Object.freeze({relationship:workflowRelationship(primary?.name,Boolean(pending),raw)}),
      tenantMatches:Object.freeze(tenantMatches.slice(0,12).map(Object.freeze)),
      ambiguity:Object.freeze(ambiguity),
      complexity:Object.freeze(signals),
      escalation:Object.freeze(escalation),
      authority:Object.freeze({interpretation:'nova_local_semantic_router',execution:'nova_deterministic_core',mayExecute:false}),
      timingMs:Number((performance.now()-started).toFixed(3))
    });
  }

  classify(value,{tenant,context,tenantMatches=[],pending=null}={}){
    const features=featureVector(value);
    if(!features.size)return null;
    const featureWeight=sum(features.values());
    const scores=[];
    for(const intent of this.model.intents){
      const stats=this.model.classes.get(intent);
      let logScore=Math.log(stats.documents/this.model.documentCount);
      for(const [feature,weight] of features){
        const count=stats.features.get(feature)||0;
        logScore+=weight*Math.log((count+this.model.alpha)/(stats.featureTotal+this.model.alpha*this.model.vocabularySize));
      }
      const normalized=logScore/Math.max(1,featureWeight);
      const similarity=bestPrototypeSimilarity(features,stats.prototypes);
      const contextBoost=contextualBoost(intent,value,{tenant,context,tenantMatches,pending});
      scores.push({intent,nbScore:normalized,similarity,contextBoost});
    }
    const posterior=softmax(scores.map(item=>item.nbScore+item.contextBoost*.025),.075);
    const ranked=scores.map((item,index)=>{
      const similarityEvidence=Math.min(1,item.similarity/.72);
      const confidence=clamp(.05+.5*posterior[index]+.43*similarityEvidence+item.contextBoost,0,.995);
      return {...item,posterior:posterior[index],confidence};
    }).sort((a,b)=>b.confidence-a.confidence||b.similarity-a.similarity);
    const best=ranked[0],second=ranked[1];
    if(!best)return null;
    const margin=Math.max(0,best.confidence-Number(second?.confidence||0));
    return Object.freeze({
      name:best.intent,
      confidence:Number(best.confidence.toFixed(4)),
      margin:Number(margin.toFixed(4)),
      similarity:Number(best.similarity.toFixed(4)),
      posterior:Number(best.posterior.toFixed(4)),
      alternatives:Object.freeze(ranked.slice(1,4).map(item=>Object.freeze({name:item.intent,confidence:Number(item.confidence.toFixed(4)),similarity:Number(item.similarity.toFixed(4))})))
    });
  }
}

function train(examples){
  const alpha=.18;
  const classes=new Map();
  const vocabulary=new Set();
  let documentCount=0;
  for(const [intent,utterances] of Object.entries(examples)){
    const stats={documents:utterances.length,features:new Map(),featureTotal:0,prototypes:[]};
    for(const utterance of utterances){
      documentCount+=1;
      const vector=featureVector(utterance);
      stats.prototypes.push(vector);
      for(const [feature,weight] of vector){
        vocabulary.add(feature);
        stats.features.set(feature,(stats.features.get(feature)||0)+weight);
        stats.featureTotal+=weight;
      }
    }
    classes.set(intent,stats);
  }
  return Object.freeze({alpha,classes,intents:Object.freeze([...classes.keys()]),documentCount,vocabularySize:vocabulary.size});
}

function featureVector(value){
  const text=canonicalize(value).slice(0,600);
  const tokens=text.split(' ').filter(Boolean);
  const out=new Map();
  const add=(key,weight)=>out.set(key,Math.max(out.get(key)||0,weight));
  for(const token of tokens){
    add(`w:${token}`,2.25);
    if(token.length>=5)add(`p:${token.slice(0,4)}`,.8);
  }
  for(let i=0;i<tokens.length-1;i++)add(`b:${tokens[i]}_${tokens[i+1]}`,2.65);
  const compact=`^${text.replace(/\s+/g,'_')}$`;
  for(const size of [3,4])for(let i=0;i<=compact.length-size;i++)add(`c${size}:${compact.slice(i,i+size)}`,size===4?.36:.24);
  return out;
}

function bestPrototypeSimilarity(query,prototypes){
  let best=0;
  for(const candidate of prototypes)best=Math.max(best,cosine(query,candidate));
  return best;
}
function cosine(a,b){
  let dot=0,aa=0,bb=0;
  for(const value of a.values())aa+=value*value;
  for(const value of b.values())bb+=value*value;
  const [small,large]=a.size<=b.size?[a,b]:[b,a];
  for(const [key,value] of small)if(large.has(key))dot+=value*large.get(key);
  return aa&&bb?dot/Math.sqrt(aa*bb):0;
}

function contextualBoost(intent,raw,{tenant,context,tenantMatches,pending}){
  const n=canonicalize(raw),capabilities=new Set(context?.tenant?.enabled_capabilities||tenant?.capabilities||[]);
  const productMatch=tenantMatches.some(item=>item.kind==='product'&&item.score>=.78);
  const serviceMatch=tenantMatches.some(item=>item.kind==='service'&&item.score>=.78);
  let boost=0;
  if(productMatch&&/^(?:product\.|cart\.|order\.)/.test(intent))boost+=.055;
  if(serviceMatch&&/^(?:service\.|booking\.|availability\.)/.test(intent))boost+=.055;
  if(!capabilities.has('catalog')&&/^(?:product\.|cart\.|order\.)/.test(intent))boost-=.05;
  if(!capabilities.has('booking')&&!capabilities.has('cleaning')&&/^(?:booking\.|service\.|availability\.)/.test(intent))boost-=.035;
  if(pending&&['conversation.confirm','conversation.reject','conversation.correct'].includes(intent))boost+=.035;
  if(/\b(?:price|cost|charges?|rate|kitn|qeemat|قیمت|سعر)\b/.test(n)&&/\.(?:price)$/.test(intent))boost+=.04;
  if(/\b(?:book|appointment|schedule|reserve|booking|chahiye|karwa|حجز|موعد)\b/.test(n)&&intent==='booking.create')boost+=.035;
  if(hasAcquisitionCue(n)&&serviceMatch&&intent==='booking.create')boost+=.075;
  if(hasAcquisitionCue(n)&&productMatch&&['cart.add','order.create'].includes(intent))boost+=.065;
  if(/\b(?:return|wapas|واپس|إرجاع)\b/.test(n)&&intent==='order.return')boost+=.045;
  if(/\b(?:exchange|replace|swap|badal|بدل|استبدال)\b/.test(n)&&intent==='order.exchange')boost+=.045;
  return boost;
}

function matchTenantVocabulary(raw,vocabulary){
  const query=canonicalize(raw),qVector=featureVector(query),matches=[];
  for(const item of vocabulary||[]){
    let best=0,matched=null,exact=false;
    for(const alias of [item.name,...(item.aliases||[])]){
      const normalized=canonicalize(alias);
      if(!normalized)continue;
      if((` ${query} `).includes(` ${normalized} `)){best=1;matched=alias;exact=true;break;}
      if(normalized.length>=4){
        const similarity=cosine(qVector,featureVector(normalized));
        if(similarity>best){best=similarity;matched=alias;}
      }
    }
    if(best>=(exact?1:.68))matches.push({kind:item.kind,id:item.id,name:item.name,matchedAlias:matched,score:Number(best.toFixed(4)),exact});
  }
  return matches.sort((a,b)=>b.score-a.score||Number(b.exact)-Number(a.exact));
}

function collectIntents(whole,clauses){
  const raw=[];
  if(whole)raw.push(whole);
  for(const clause of clauses||[])if(clause.name&&clause.confidence>=.68&&clause.similarity>=.17)raw.push(clause);
  const best=new Map();
  for(const item of raw){const previous=best.get(item.name);if(!previous||item.confidence>previous.confidence)best.set(item.name,item);}
  return [...best.values()].sort((a,b)=>intentPriority(b.name)-intentPriority(a.name)||b.confidence-a.confidence)
    .map(item=>({name:item.name,confidence:item.confidence,margin:item.margin,similarity:item.similarity}));
}
function choosePrimary(intents,whole){
  if(!intents.length)return whole;
  const top=[...intents].sort((a,b)=>intentPriority(b.name)-intentPriority(a.name)||b.confidence-a.confidence)[0];
  const source=top.name===whole?.name?whole:top;
  return source?Object.freeze({...source}):null;
}
function intentPriority(intent){
  if(['booking.cancel','order.cancel','cart.remove','order.return','order.exchange'].includes(intent))return 100;
  if(['booking.modify','cart.update','order.modify','conversation.correct'].includes(intent))return 90;
  if(TRANSACTIONAL_INTENTS.has(intent))return 80;
  if(INFORMATION_INTENTS.has(intent))return 60;
  if(SOCIAL_INTENTS.has(intent))return 20;
  return 10;
}

function semanticClauses(raw,clauseSemantics){
  const supplied=(clauseSemantics?.clauses||[]).map(item=>String(item.text||'').trim()).filter(Boolean);
  if(supplied.length>1)return supplied.slice(0,8);
  return String(raw||'')
    .split(/(?:[.!?;\n]+|\bbut\b|\bhowever\b|\baur phir\b|\band (?:also|then|please|tell|show|check|change|add|remove|what|can|could|i want|i need)\b)/i)
    .map(value=>value.trim()).filter(value=>value.split(/\s+/).length>=2).slice(0,8);
}

function complexitySignals(raw,{pending,messageFrame,clauseRoutes,intents}){
  const n=canonicalize(raw),tokens=n.split(' ').filter(Boolean);
  const businessIntents=intents.filter(item=>!SOCIAL_INTENTS.has(item.name));
  const conditional=/\b(?:if|unless|otherwise|or else|agar|warna|اگر|ورنہ|إذا|وإلا)\b/.test(n);
  const alternatives=/\b(?:first choice|second choice|prefer|alternative|instead|warna|ورنہ|بديل)\b/.test(n);
  const correctionWithAction=businessIntents.some(item=>CHANGE_INTENTS.has(item.name))&&businessIntents.length>1;
  const score=[tokens.length>36,clauseRoutes.length>=3,businessIntents.length>=3,conditional&&alternatives,correctionWithAction].filter(Boolean).length;
  return {score,tokenCount:tokens.length,clauseCount:Math.max(1,clauseRoutes.length),intentCount:businessIntents.length,conditional,alternatives,correctionWithAction,activeWorkflow:Boolean(pending),frameMultipleIntents:Boolean(messageFrame?.hasMultipleIntents)};
}

function ambiguitySignals(raw,{pending,primary,whole,messageFrame,tenantMatches}){
  const n=canonicalize(raw),out=[];
  const change=/\b(?:change|adjust|move|remove|cancel|replace|update|badal|hata|بدل|منسوخ|غير|ألغ)\b/.test(n);
  const unresolvedReference=/\b(?:it|this|that|one|request|wali|wala|usay|isko|اسے|یہ|ذلك|هذا)\b/.test(n);
  if(change&&unresolvedReference&&!pending&&!/\b(?:booking|appointment|order|cart|service|product|shirt|cleaning)\b/.test(n)&&!tenantMatches.length)out.push('unresolved_reference');
  if(primary&&whole&&primary.margin<.035)out.push('competing_intents');
  if(messageFrame?.hasMultipleIntents&&primary?.confidence<.8)out.push('weak_multi_intent');
  return [...new Set(out)];
}

function escalationDecision({accepted,primary,intents,signals,ambiguity,thresholds}){
  if(signals.intentCount>thresholds.maxLocalIntents||signals.score>=3)return {recommended:true,reason:'complex_multi_intent'};
  if(ambiguity.includes('unresolved_reference'))return {recommended:true,reason:'ambiguous_reference'};
  if(!primary)return {recommended:true,reason:'no_local_semantic_route'};
  if(primary.similarity<thresholds.minSimilarity)return {recommended:true,reason:'low_semantic_similarity'};
  if(primary.margin<thresholds.minMargin)return {recommended:true,reason:'competing_local_intents'};
  if(primary.confidence<thresholds.minConfidence)return {recommended:true,reason:'low_local_confidence'};
  if(!accepted)return {recommended:true,reason:ambiguity[0]||'local_uncertain'};
  return {recommended:false,reason:'local_semantic_confident'};
}

function describeMessage(intent,raw,hasPending,ambiguity){
  const information=INFORMATION_INTENTS.has(intent);
  const confirmation=intent==='conversation.confirm',rejection=intent==='conversation.reject';
  const correction=CHANGE_INTENTS.has(intent);
  return {
    type:confirmation?'confirmation':rejection?'rejection':correction?'correction':information?'question':SOCIAL_INTENTS.has(intent)?'greeting':'request',
    actionSemantics:information?'information_only':confirmation?'confirmation':rejection?'rejection':correction?'change_request':TRANSACTIONAL_INTENTS.has(intent)?'draft_request':'none',
    certainty:ambiguity.length?'ambiguous':/\b(?:maybe|perhaps|might|possibly|shayad|شاید|ربما)\b/.test(canonicalize(raw))?'implicit':'explicit',
    activeWorkflow:hasPending
  };
}
function workflowRelationship(intent,pending,raw){
  if(!pending)return 'continue';
  if(INFORMATION_INTENTS.has(intent)||SOCIAL_INTENTS.has(intent))return 'interrupt';
  if(['booking.cancel','order.cancel'].includes(intent))return 'cancel';
  if(CHANGE_INTENTS.has(intent))return 'replace';
  if(/\b(?:instead|not .* but|replace|badal|بلکہ|بدل)\b/.test(canonicalize(raw)))return 'replace';
  return 'continue';
}

function detectLanguage(raw){
  const text=String(raw||''),n=canonicalize(text);
  const hasArabicScript=/[\u0600-\u06ff]/.test(text),hasLatin=/[a-z]/i.test(text);
  const urduScript=/[ٹڈڑںھہےیگپچژک]/.test(text)||/\b(?:مجھے|میری|کیا|نہیں|چاہیے|کر|دیں|آپ)\b/.test(text);
  const romanTokens=(n.match(/\b(?:aap|ap|mujhe|mujhy|mera|meri|kya|kia|kon|kaun|hai|hain|chahiye|kar|kr|do|dein|dete|wala|wali|kal|aaj|kitna|kitne|batao|dikhao|badal)\b/g)||[]).length;
  const englishTokens=(n.match(/\b(?:the|is|are|what|which|how|my|i|want|need|please|show|tell|book|order|service|product)\b/g)||[]).length;
  if(hasArabicScript&&hasLatin)return 'mixed';
  if(hasArabicScript)return urduScript?'ur':'ar';
  if(romanTokens>=2&&englishTokens>=2)return 'mixed';
  if(romanTokens>=2)return 'roman_ur';
  return 'en';
}

function softmax(values,temperature=1){
  const max=Math.max(...values),exps=values.map(value=>Math.exp((value-max)/temperature)),total=sum(exps);
  return exps.map(value=>value/Math.max(total,Number.EPSILON));
}
function sum(values){let total=0;for(const value of values)total+=value;return total;}
function clamp(value,min,max){return Math.min(max,Math.max(min,value));}
function disabledResult(){return Object.freeze({version:'1.0',engine:'local_statistical_semantic_router',used:false,accepted:false,decision:'disabled',escalation:Object.freeze({recommended:false,reason:'router_off'}),authority:Object.freeze({interpretation:'none',execution:'nova_deterministic_core',mayExecute:false}),timingMs:0});}
function emptyResult(){return Object.freeze({version:'1.0',engine:'local_statistical_semantic_router',used:true,accepted:false,decision:'empty',primaryIntent:null,intents:Object.freeze([]),tenantMatches:Object.freeze([]),ambiguity:Object.freeze([]),escalation:Object.freeze({recommended:false,reason:'empty_message'}),authority:Object.freeze({interpretation:'nova_local_semantic_router',execution:'nova_deterministic_core',mayExecute:false}),timingMs:0});}

module.exports={
  LightweightSemanticRouter,featureVector,train,matchTenantVocabulary,detectLanguage,
  INFORMATION_INTENTS,CHANGE_INTENTS,TRANSACTIONAL_INTENTS,SOCIAL_INTENTS
};
