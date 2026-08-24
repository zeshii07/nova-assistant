const {
  LANGUAGES, MESSAGE_TYPES, WORKFLOW_RELATIONSHIPS, ACTION_SEMANTICS,
  CERTAINTY_LEVELS, INTENTS, REQUESTED_INFORMATION, ENTITY_PROPERTIES
} = require('./nluSchema');

const V1_ROOT_REQUIRED = Object.freeze([
  'schema_version', 'language', 'message_type', 'intent', 'confidence',
  'workflow_relationship', 'entities', 'customer_fields',
  'requested_information', 'corrections', 'ambiguities'
]);
const V1_ROOT_ALLOWED = Object.freeze([...V1_ROOT_REQUIRED, 'intents']);
const V1_ENTITY_KEYS = Object.freeze([
  'service', 'service_id', 'product', 'product_id', 'date_text', 'date_normalized',
  'time_text', 'time_normalized', 'end_time_text', 'duration_hours', 'staff',
  'quantity', 'cleaner_count', 'property_type', 'bedrooms', 'balconies',
  'interior_windows', 'washrooms', 'halls', 'address', 'recurrence',
  'supplies_required', 'equipment_required'
]);
const V2_ROOT_KEYS = Object.freeze([
  'schema_version', 'language', 'message_type', 'action_semantics', 'certainty',
  'intent', 'intents', 'confidence', 'workflow_relationship', 'entities',
  'service_items', 'product_items', 'customer_fields', 'requested_information',
  'missing_information', 'corrections', 'ambiguities'
]);
const CUSTOMER_KEYS = Object.freeze(['name', 'phone', 'email']);
const SERVICE_ITEM_KEYS = Object.freeze(['service', 'service_id', 'quantity', 'unit', 'service_variant', 'property_type', 'bedrooms', 'staff', 'duration_hours', 'confidence']);
const PRODUCT_ITEM_KEYS = Object.freeze(['product', 'product_id', 'quantity', 'unit', 'size', 'color', 'variant', 'confidence']);

/**
 * Validate the probabilistic boundary before anything reaches orchestration.
 * v1 is retained only for rolling upgrades and historical test fixtures. New
 * provider calls use v2 and must contain every declared field.
 */
function validateNluOutput(value) {
  const errors=[];
  if(!plainObject(value))return {valid:false,errors:['root must be a plain object'],value:null};
  const legacy=value.schema_version==='1.0';
  if(!legacy&&value.schema_version!=='2.0')errors.push('schema_version must equal 2.0 (or legacy 1.0)');
  if(legacy){requiredKeys(value,V1_ROOT_REQUIRED,'root',errors);allowedKeys(value,V1_ROOT_ALLOWED,'root',errors);}
  else exactKeys(value,V2_ROOT_KEYS,'root',errors);

  enumValue(value.language,LANGUAGES,'language',errors);
  enumValue(value.message_type,MESSAGE_TYPES,'message_type',errors);
  enumValue(value.intent,INTENTS,'intent',errors);
  enumValue(value.workflow_relationship,WORKFLOW_RELATIONSHIPS,'workflow_relationship',errors);
  confidence(value.confidence,'confidence',errors);
  if(!legacy){
    enumValue(value.action_semantics,ACTION_SEMANTICS,'action_semantics',errors);
    enumValue(value.certainty,CERTAINTY_LEVELS,'certainty',errors);
  }

  validateIntentItems(value.intents,legacy,errors);
  validateEntities(value.entities,legacy,errors);
  validateExactNullableObject(value.customer_fields,CUSTOMER_KEYS,'customer_fields',legacy,errors);
  validateStringArray(value.requested_information,'requested_information',legacy?12:16,errors,REQUESTED_INFORMATION);
  validateStringArray(value.ambiguities,'ambiguities',legacy?10:12,errors);
  if(!legacy)validateStringArray(value.missing_information,'missing_information',20,errors);
  validateCorrections(value.corrections,legacy?10:12,errors);
  if(!legacy){
    validateItemArray(value.service_items,SERVICE_ITEM_KEYS,'service_items',12,errors);
    validateItemArray(value.product_items,PRODUCT_ITEM_KEYS,'product_items',20,errors);
  }
  if(errors.length)return {valid:false,errors,value:null};
  return {valid:true,errors:[],value:deepFreeze(normalize(value,legacy))};
}

function validateIntentItems(value,legacy,errors){
  if(value===undefined&&legacy)return;
  if(!Array.isArray(value)||(value.length>(legacy?8:12))){errors.push(`intents must be an array with at most ${legacy?8:12} items`);return;}
  value.forEach((item,index)=>{
    if(!plainObject(item)){errors.push(`intents.${index} must be a plain object`);return;}
    exactKeys(item,['intent','message_type','confidence'],`intents.${index}`,errors);
    enumValue(item.intent,INTENTS,`intents.${index}.intent`,errors);
    enumValue(item.message_type,MESSAGE_TYPES,`intents.${index}.message_type`,errors);
    confidence(item.confidence,`intents.${index}.confidence`,errors);
  });
}

function validateEntities(value,legacy,errors){
  if(!plainObject(value)){errors.push('entities must be a plain object');return;}
  const keys=legacy?V1_ENTITY_KEYS:Object.keys(ENTITY_PROPERTIES);
  if(legacy)allowedKeys(value,keys,'entities',errors);else exactKeys(value,keys,'entities',errors);
  for(const [key,raw] of Object.entries(value)){
    const descriptor=ENTITY_PROPERTIES[key];
    if(descriptor)validateNullable(raw,descriptor.type,`entities.${key}`,errors);
  }
  for(const key of ['date_normalized','alternative_date_normalized'])if(value[key]!=null&&!/^\d{4}-\d{2}-\d{2}$/.test(value[key]))errors.push(`entities.${key} must be YYYY-MM-DD`);
  for(const key of ['time_normalized','alternative_time_normalized'])if(value[key]!=null&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(value[key]))errors.push(`entities.${key} must be HH:MM`);
}

function validateExactNullableObject(value,keys,label,legacy,errors){
  if(!plainObject(value)){errors.push(`${label} must be a plain object`);return;}
  if(legacy)allowedKeys(value,keys,label,errors);else exactKeys(value,keys,label,errors);
  for(const key of Object.keys(value))validateNullable(value[key],['string','null'],`${label}.${key}`,errors);
}

function validateItemArray(value,keys,label,max,errors){
  if(!Array.isArray(value)||value.length>max){errors.push(`${label} must be an array with at most ${max} items`);return;}
  value.forEach((item,index)=>{
    if(!plainObject(item)){errors.push(`${label}.${index} must be a plain object`);return;}
    exactKeys(item,keys,`${label}.${index}`,errors);
    for(const [key,raw] of Object.entries(item)){
      if(key==='confidence')confidence(raw,`${label}.${index}.confidence`,errors);
      else if(['quantity','bedrooms','staff','duration_hours'].includes(key))validateNullable(raw,['number','null'],`${label}.${index}.${key}`,errors);
      else validateNullable(raw,['string','null'],`${label}.${index}.${key}`,errors);
    }
  });
}

function validateCorrections(value,max,errors){
  if(!Array.isArray(value)||value.length>max){errors.push(`corrections must be an array with at most ${max} items`);return;}
  value.forEach((item,index)=>{
    if(!plainObject(item)){errors.push(`corrections.${index} must be a plain object`);return;}
    exactKeys(item,['field','from','to'],`corrections.${index}`,errors);
    if(!safeString(item.field,64,false))errors.push(`corrections.${index}.field must be a non-empty string`);
    validateNullable(item.from,['string','null'],`corrections.${index}.from`,errors);
    validateNullable(item.to,['string','null'],`corrections.${index}.to`,errors);
  });
}

function normalize(value,legacy){
  const out=structuredClone(value);
  out.confidence=Number(out.confidence);
  out.intents=(out.intents||[]).map(item=>({...item,confidence:Number(item.confidence)}));
  for(const [key,raw] of Object.entries(out.entities||{}))if(typeof raw==='string')out.entities[key]=clean(raw,240);
  for(const [key,raw] of Object.entries(out.customer_fields||{}))if(typeof raw==='string')out.customer_fields[key]=clean(raw,160);
  out.ambiguities=(out.ambiguities||[]).map(x=>clean(x,240)).filter(Boolean);
  out.missing_information=(out.missing_information||[]).map(x=>clean(x,80)).filter(Boolean);
  out.corrections=(out.corrections||[]).map(x=>({field:clean(x.field,64),from:clean(x.from,160),to:clean(x.to,160)}));
  if(!legacy){
    out.service_items=out.service_items.map(item=>normalizeItem(item));
    out.product_items=out.product_items.map(item=>normalizeItem(item));
  }
  return out;
}
function normalizeItem(item){const out={...item,confidence:Number(item.confidence)};for(const [key,raw] of Object.entries(out))if(typeof raw==='string')out[key]=clean(raw,160);return out;}
function clean(value,max){if(typeof value!=='string')return value??null;return value.trim().slice(0,max)||null;}
function confidence(value,label,errors){if(!Number.isFinite(value)||value<0||value>1)errors.push(`${label} must be between 0 and 1`);}
function exactKeys(value,expected,label,errors){const actual=Object.keys(value).sort(),wanted=[...expected].sort();for(const missing of wanted.filter(key=>!actual.includes(key)))errors.push(`${label}.${missing} is required`);for(const extra of actual.filter(key=>!wanted.includes(key)))errors.push(`${label}.${extra} is not allowed`);}
function requiredKeys(value,expected,label,errors){for(const key of expected)if(!Object.hasOwn(value,key))errors.push(`${label}.${key} is required`);}
function allowedKeys(value,expected,label,errors){for(const extra of Object.keys(value).filter(key=>!expected.includes(key)))errors.push(`${label}.${extra} is not allowed`);}
function enumValue(value,allowed,label,errors){if(!allowed.includes(value))errors.push(`${label} is invalid`);}
function validateNullable(value,types,label,errors){const allowed=Array.isArray(types)?types:[types];if(value===null&&allowed.includes('null'))return;if(typeof value==='string'&&allowed.includes('string')&&safeString(value,240,true))return;if(typeof value==='number'&&allowed.includes('number')&&Number.isFinite(value))return;if(typeof value==='boolean'&&allowed.includes('boolean'))return;errors.push(`${label} has an invalid type or length`);}
function validateStringArray(value,label,max,errors,allowed=null){if(!Array.isArray(value)||value.length>max){errors.push(`${label} must be an array with at most ${max} items`);return;}for(const item of value){if(!safeString(item,240,false))errors.push(`${label} contains an invalid string`);else if(allowed&&!allowed.includes(item))errors.push(`${label} contains an unsupported value`);}}
function safeString(value,max,emptyAllowed){return typeof value==='string'&&value.length<=max&&(emptyAllowed||value.trim().length>0);}
function plainObject(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;}
function deepFreeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))deepFreeze(child);}return value;}

module.exports={validateNluOutput};
