const {normalizeText}=require('./text');

// Field labels cover English, Roman Urdu, Urdu script, and Arabic so a single
// "میرا نام علی کر دو" or "غيّر اسمي إلى علي" is recognised the same way as
// "change my name to Ali". The Urdu/Arabic labels are paired with their Latin
// equivalents so the same downstream validator can normalize the value.
const FIELD_LABELS=Object.freeze({
  name:'(?:full\\s+)?(?:name|naam|nme|nam|نام|اسم|إسم)',
  phone:'(?:phone|mobile|contact|فون|موبائل|رقم|هاتف|رقم الهاتف)(?:\\s+(?:number|no|نمبر|رقم))?|number|نمبر',
  email:'e[ -]?mail(?:\\s+address)?|ای[- ]?میل|ایڈریس ای[- ]?میل|بريد(?:\\s+الكتروني)?|إيميل',
  address:'(?:delivery|service|home|full|پتہ|پتا|عنوان)?\\s*(?:address|location|پتہ|پتا|عنوان)|پتہ|پتا|عنوان',
  city:'(?:delivery\\s+)?city|شہر|مدينة',
  landmark:'(?:nearby\\s+)?landmark|نشانی|علامة',
  paymentMethod:'payment(?:\\s+method)?|ادائیگی|ادا اگی|طريقة(?:\\s+الدفع)?'
});

/**
 * Extract an explicit customer/detail replacement without executing it.
 * Capability handlers remain responsible for validation and persistence.
 */
function extractFieldAmendment(raw,{allowedFields=Object.keys(FIELD_LABELS)}={}){
  const source=String(raw||'').trim();
  const text=normalizeText(source);
  if(!source)return null;
  // Reusing an existing CRM value is acceptance, not a request to replace it.
  // Let the active workflow resolve the saved value from the tenant-scoped
  // customer profile instead of opening a field-edit prompt.
  if(/\b(?:use|keep|take)\b[\s\S]{0,24}\b(?:previous|previuos|earlier|old|same|saved|existing|current|configured|purana|pahly wala)\b[\s\S]{0,20}\b(?:name|phone|number|contact|email|address|details?|information)\b/i.test(source)
    || /\bno new (?:name|phone|number|contact|email|address)\b[\s\S]{0,24}\b(?:old|previous|saved)\b/i.test(source))return null;
  const updateCue=/\b(?:change|update|edit|correct|replace|switch|set|use|new|instead|should be|kar do|kr do|kardo|badal do|tabdeel)\b/.test(text)
    || /\b(?:change|update|edit|correct|replace|switch)\b/i.test(source)
    || /(?:بدل|تبدیل|کر دو|کر دو|کڑ دو|تبدیلی)/.test(source)
    || /(?:غيّر|تغيير|تعديل|استبدال)/.test(source);
  if(!updateCue)return null;
  // Unicode-aware boundary helpers. JavaScript's \b is ASCII-only and does not
  // fire at Urdu/Arabic script edges, so a custom lookaround is required.
  const B='(?<![\\p{L}\\p{N}_])';
  const E='(?![\\p{L}\\p{N}_])';
  for(const field of allowedFields){
    const label=FIELD_LABELS[field];if(!label)continue;
    const labelRegex=new RegExp(`${B}(?:my|the|mera|meri|apna|apni|میرا|میری|اپنا|اپنی)?\\s*(?:${label})${E}`,'iu');
    if(!labelRegex.test(source))continue;
    let value=extractValue(source,field,label);
    // A cue elsewhere in a long, multi-intent message is not enough to turn
    // an informational field mention into an amendment. For example, "tell
    // me your phone ... do not change the number of cleaners" is not a phone
    // replacement request. We only fall back to the null-value amendment
    // path when the label is IMMEDIATELY followed by an action verb (e.g.
    // "name change kr do" with no concrete new value supplied).
    if(value==null){
      // Action verbs that, when appearing immediately after a field label,
      // indicate the customer wants to start a field edit without supplying
      // a value yet. We surface this as a null-rawValue amendment so the
      // capability can prompt for the new value rather than silently storing
      // the verb itself (e.g. "Change") as the customer's name.
      const actionVerbAfterLabel=new RegExp(`${B}(?:my|the|mera|meri|apna|apni|میرا|میری|اپنا|اپنی)?\\s*(?:${label})\\s+(?:change|update|edit|correct|replace|switch|set|use|new|instead|karwa|krwa|badal|tabdeel|بدل|تبدیل|کروان|غيّر|تغيير|تعديل|استبدال)${E}`,'iu');
      if(actionVerbAfterLabel.test(source)){
        return {field,rawValue:null,action:'replace',explicit:true};
      }
      continue;
    }
    if(field==='phone'&&/^of\s+(?:cleaners?|workers?|people|items?|products?|pieces?|hours?|bedrooms?)\b/i.test(value))continue;
    return {field,rawValue:value,action:'replace',explicit:true};
  }
  return null;
}

function extractValue(source,field,label){
  const B='(?<![\\p{L}\\p{N}_])';
  const E='(?![\\p{L}\\p{N}_])';
  const patterns=[
    new RegExp(`\\b(?:change|update|edit|correct|replace|switch|set)\\s+(?:my|the|mera|meri|apna|apni|میرا|میری|اپنا|اپنی)?\\s*(?:${label})\\s*(?:to|as|is|=|:|کر|کر دو|کر دو)?\\s+(.+)$`,'iu'),
    new RegExp(`\\buse\\s+(?:my|the|mera|meri|apna|apni|میرا|میری|اپنا|اپنی)?\\s*(?:${label})\\s*(?:as|is|=|:)?\\s+(.+)$`,'iu'),
    new RegExp(`\\b(?:my|the|mera|meri|apna|apni|میرا|میری|اپنا|اپنی)?\\s*(?:${label})\\s+(?:should\\s+be|is\\s+now|is|to|=|:)\\s+(.+)$`,'iu'),
    new RegExp(`\\b(?:use|set)\\s+(.+?)\\s+(?:as|for)\\s+(?:my|the|mera|meri|میرا|میری)?\\s*(?:${label})\\b`,'iu'),
    new RegExp(`\\b(?:new|updated|correct)\\s+(?:${label})\\s*(?:is|=|:)?\\s+(.+)$`,'iu'),
    // Roman-Urdu SOV with explicit possessor: "mera naam Zeeshan kr do"
    new RegExp(`\\b(?:my|mera|meri)\\s+(?:${label})\\s+(.+?)\\s+(?:kar\\s*do|kr\\s*do|kardo|badal\\s*do|tabdeel\\s*karo)\\b`,'iu'),
    // Roman-Urdu SOV without possessor: "naam Zeeshan sy Ali kr do" / "naam Ali badal do"
    new RegExp(`${B}(?:${label})${E}\\s+(.+?)\\s+(?:kar\\s*do|kr\\s*do|kardo|badal\\s*do|tabdeel\\s*karo)\\b`,'iu'),
    // Urdu-script SOV: "نام علی کر دو" / "میرا نام علی بدل دو"
    new RegExp(`(?:میرا|میری|اپنا|اپنی)?\\s*(?:${label})\\s+(.+?)\\s+(?:کر\\s*دو|بدل\\s*دو|تبدیل\\s*کرو)${E}`,'iu')
  ];
  for(const pattern of patterns){
    const match=source.match(pattern);
    if(match){
      const cleaned=cleanValue(match[1],field);
      if(cleaned)return cleaned;
    }
  }
  return null;
}

function cleanValue(value,field){
  let result=String(value||'').trim()
    .replace(/\s+(?:please|thanks|thank you)$/i,'')
    .replace(/\s+(?:kar\s*do|kr\s*do|kardo|badal\s*do|tabdeel\s*karo)$/i,'')
    .replace(/^[\s:=-]+|[\s,;.!]+$/g,'')
    .trim();
  // If the captured "value" is itself one of the action verbs, the customer
  // almost certainly said something like "name change kr do" (i.e. "I want to
  // change my name") without supplying a new value. Returning null here lets
  // the capability enter the field-edit flow and ask for the new value rather
  // than silently storing the verb itself as the customer's name.
  const actionVerbs=/^(change|update|edit|correct|replace|switch|set|use|new|karwa|krwa|badal|tabdeel|بدل|تبدیل|کروان|کڑ|غيّر|تغيير|تعديل|استبدال)$/i;
  if(actionVerbs.test(result))return null;
  if(field==='phone'){
    const match=result.match(/\+?\d[\d ()-]{4,24}\d/);return match?match[0].trim():result;
  }
  if(field==='email'){
    const match=result.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);return match?match[0].toLowerCase():result;
  }
  return result||null;
}

module.exports={extractFieldAmendment,FIELD_LABELS};
