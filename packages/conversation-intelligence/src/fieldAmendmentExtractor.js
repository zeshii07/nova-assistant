const {normalizeText}=require('./text');

const FIELD_LABELS=Object.freeze({
  name:'(?:full\s+)?(?:name|naam|nme)',
  phone:'(?:phone|mobile|contact)(?:\s+(?:number|no))?|number',
  email:'e[ -]?mail(?:\s+address)?',
  address:'(?:delivery|service|home|full)?\s*address|location',
  city:'(?:delivery\s+)?city',
  landmark:'(?:nearby\s+)?landmark',
  paymentMethod:'payment(?:\s+method)?'
});

/**
 * Extract an explicit customer/detail replacement without executing it.
 * Capability handlers remain responsible for validation and persistence.
 */
function extractFieldAmendment(raw,{allowedFields=Object.keys(FIELD_LABELS)}={}){
  const source=String(raw||'').trim();
  const text=normalizeText(source);
  if(!source)return null;
  const updateCue=/\b(?:change|update|edit|correct|replace|switch|set|use|new|instead|should be|kar do|kr do|kardo|badal do|tabdeel)\b/.test(text);
  if(!updateCue)return null;
  for(const field of allowedFields){
    const label=FIELD_LABELS[field];if(!label)continue;
    const labelRegex=new RegExp(`\\b(?:my|the|mera|meri|apna|apni)?\\s*(?:${label})\\b`,'iu');
    if(!labelRegex.test(source))continue;
    let value=extractValue(source,field,label);
    return {field,rawValue:value,action:'replace',explicit:true};
  }
  return null;
}

function extractValue(source,field,label){
  const patterns=[
    new RegExp(`\\b(?:change|update|edit|correct|replace|switch|set)\\s+(?:my|the|mera|meri|apna|apni)?\\s*(?:${label})\\s*(?:to|as|is|=|:)?\\s+(.+)$`,'iu'),
    new RegExp(`\\buse\\s+(?:my|the|mera|meri|apna|apni)?\\s*(?:${label})\\s*(?:as|is|=|:)?\\s+(.+)$`,'iu'),
    new RegExp(`\\b(?:my|the|mera|meri|apna|apni)?\\s*(?:${label})\\s+(?:should\\s+be|is\\s+now|is|to|=|:)\\s+(.+)$`,'iu'),
    new RegExp(`\\b(?:use|set)\\s+(.+?)\\s+(?:as|for)\\s+(?:my|the|mera|meri)?\\s*(?:${label})\\b`,'iu'),
    new RegExp(`\\b(?:new|updated|correct)\\s+(?:${label})\\s*(?:is|=|:)?\\s+(.+)$`,'iu'),
    new RegExp(`\\b(?:my|mera|meri)\\s+(?:${label})\\s+(.+?)\\s+(?:kar\\s*do|kr\\s*do|kardo|badal\\s*do|tabdeel\\s*karo)\\b`,'iu')
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
  if(field==='phone'){
    const match=result.match(/\+?\d[\d ()-]{4,24}\d/);return match?match[0].trim():result;
  }
  if(field==='email'){
    const match=result.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);return match?match[0].toLowerCase():result;
  }
  return result||null;
}

module.exports={extractFieldAmendment,FIELD_LABELS};
