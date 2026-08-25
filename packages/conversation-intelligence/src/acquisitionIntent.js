const {normalizeText}=require('./text');

/*
 * Domain-neutral customer-acquisition language.
 *
 * Business adapters supply the domain evidence (a matched service, product,
 * menu item, treatment, and so on). This module answers only whether the
 * customer is trying to obtain something, so every tenant gets the same broad
 * paraphrase handling without copying phrases into tenant configuration.
 */
function hasAcquisitionCue(value){
  const n=normalizeText(value);
  if(!n)return false;
  return /\b(?:(?:i\s+(?:(?:am|was|'m)\s+)?)?(?:looking|searching|shopping)\s+for|looking to|trying to (?:find|get|buy|book|arrange)|interested in|hoping to (?:get|book|arrange)|i want|i need|i would like|i'd like|would love|can i get|can i have|could i get|may i get|help me (?:get|find|book|arrange|with)|set me up with|sort out|arrange|book|schedule|reserve|purchase|buy|order|send (?:me|someone|a team)|need someone|want someone)\b/.test(n)
    || /\b(?:get|have|want|need)\b[\s\S]{0,45}\b(?:cleaned|fixed|repaired|done|delivered|booked|scheduled)\b/.test(n)
    || /\b(?:can|could|would)\s+(?:you|someone|your team|a team)\s+(?:come|clean|repair|fix|deliver|arrange|book|schedule|reserve|send|help)\b/.test(n)
    || /\b(?:save|hold)\s+(?:me|us)\s+(?:a|an|the)?\s*(?:table|slot|appointment|session|place)\b/.test(n)
    || /\b(?:mujhe|mujhay|mujy|humain|humein|main|mai|mein)\b[\s\S]{0,80}\b(?:chahiye|chaheye|chahye|karna|karani|krani|karwana|karwani|krwana|lena|leni|khareed(?:na|ne|ni)?|kharid(?:na|ne|ni)?|book|booking)\b/.test(n)
    || /\b(?:karwa|karwani|karwana|krwa|krwani|krwana|krani|leni|lena|khareed(?:na|ne|ni)?|kharid(?:na|ne|ni)?)\b/.test(n)
    || /(?:مجھے|ہمیں)[\s\S]{0,80}(?:چاہیے|کروان|کران|خرید|لین|بکنگ)/.test(n);
}

function isServiceEvidence(value){
  const n=normalizeText(value);
  return /\b(?:service|clean|cleaned|cleaning|cleaner|maid|appointment|consultation|visit|lesson|class|course|haircut|facial|treatment|repair|reservation|table|session|inspection|delivery|installation|safai|saaf|khidmat|appointment|mulaqat)\b|صفائی|خدمت|ملاقات|مرمت/.test(n);
}

function isProductEvidence(value){
  const n=normalizeText(value);
  return /\b(?:product|item|something|buy|purchase|order|cart|shoes?|shirts?|jeans?|clothes?|footwear|food|meal|kettle|bottle|pan|watch|earbuds?|bag|wallet|saman|cheez|khareed|kharid)\b|سامان|چیز|خرید/.test(n);
}

function acquisitionIntent(value,{serviceEvidence=null,productEvidence=null}={}){
  const requested=hasAcquisitionCue(value);
  const service=serviceEvidence==null?isServiceEvidence(value):Boolean(serviceEvidence);
  const product=productEvidence==null?isProductEvidence(value):Boolean(productEvidence);
  const kind=service&&!product?'service':product&&!service?'product':service&&product?'ambiguous':null;
  return Object.freeze({requested,service,product,kind});
}

module.exports={hasAcquisitionCue,isServiceEvidence,isProductEvidence,acquisitionIntent};
