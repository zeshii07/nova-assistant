const {
  LANGUAGES, MESSAGE_TYPES, WORKFLOW_RELATIONSHIPS, INTENTS,
  REQUESTED_INFORMATION, ENTITY_PROPERTIES
} = require('./nluSchema');

const ROOT_REQUIRED_KEYS = Object.freeze([
  'schema_version', 'language', 'message_type', 'intent', 'confidence',
  'workflow_relationship', 'entities', 'customer_fields',
  'requested_information', 'corrections', 'ambiguities'
]);
const ROOT_ALLOWED_KEYS = Object.freeze([...ROOT_REQUIRED_KEYS, 'intents']);
const CUSTOMER_KEYS = Object.freeze(['name', 'phone', 'email']);

function validateNluOutput(value) {
  const errors = [];
  if (!plainObject(value)) return { valid:false, errors:['root must be a plain object'], value:null };
  requiredKeys(value, ROOT_REQUIRED_KEYS, 'root', errors);
  allowedKeys(value, ROOT_ALLOWED_KEYS, 'root', errors);
  if (value.schema_version !== '1.0') errors.push('schema_version must equal 1.0');
  enumValue(value.language, LANGUAGES, 'language', errors);
  enumValue(value.message_type, MESSAGE_TYPES, 'message_type', errors);
  enumValue(value.intent, INTENTS, 'intent', errors);
  if(value.intents!==undefined){
    if(!Array.isArray(value.intents)||value.intents.length>8)errors.push('intents must be an array with at most 8 items');
    else value.intents.forEach((item,index)=>{
      if(!plainObject(item)){errors.push(`intents.${index} must be a plain object`);return;}
      exactKeys(item,['intent','message_type','confidence'],`intents.${index}`,errors);
      enumValue(item.intent,INTENTS,`intents.${index}.intent`,errors);
      enumValue(item.message_type,MESSAGE_TYPES,`intents.${index}.message_type`,errors);
      if(!Number.isFinite(item.confidence)||item.confidence<0||item.confidence>1)errors.push(`intents.${index}.confidence must be between 0 and 1`);
    });
  }
  enumValue(value.workflow_relationship, WORKFLOW_RELATIONSHIPS, 'workflow_relationship', errors);
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) errors.push('confidence must be between 0 and 1');

  if (!plainObject(value.entities)) errors.push('entities must be a plain object');
  else {
    const keys = Object.keys(ENTITY_PROPERTIES);
    allowedKeys(value.entities, keys, 'entities', errors);
    for (const key of Object.keys(value.entities)) if (ENTITY_PROPERTIES[key]) validateNullable(value.entities[key], ENTITY_PROPERTIES[key].type, `entities.${key}`, errors);
    if (value.entities.date_normalized != null && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value.entities.date_normalized)) errors.push('entities.date_normalized must be YYYY-MM-DD');
    if (value.entities.time_normalized != null && !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value.entities.time_normalized)) errors.push('entities.time_normalized must be HH:MM');
  }
  if (!plainObject(value.customer_fields)) errors.push('customer_fields must be a plain object');
  else {
    allowedKeys(value.customer_fields, CUSTOMER_KEYS, 'customer_fields', errors);
    for (const key of Object.keys(value.customer_fields)) validateNullable(value.customer_fields[key], ['string', 'null'], `customer_fields.${key}`, errors);
  }
  validateStringArray(value.requested_information, 'requested_information', 12, errors, REQUESTED_INFORMATION);
  validateStringArray(value.ambiguities, 'ambiguities', 10, errors);
  if (!Array.isArray(value.corrections) || value.corrections.length > 10) errors.push('corrections must be an array with at most 10 items');
  else value.corrections.forEach((item, index) => {
    if (!plainObject(item)) { errors.push(`corrections.${index} must be a plain object`); return; }
    exactKeys(item, ['field', 'from', 'to'], `corrections.${index}`, errors);
    if (!safeString(item.field, 64, false)) errors.push(`corrections.${index}.field must be a non-empty string`);
    validateNullable(item.from, ['string', 'null'], `corrections.${index}.from`, errors);
    validateNullable(item.to, ['string', 'null'], `corrections.${index}.to`, errors);
  });
  if (errors.length) return { valid:false, errors, value:null };

  const normalized = structuredClone(value);
  normalized.confidence = Number(normalized.confidence);
  normalized.intents=(normalized.intents||[]).map((item)=>({...item,confidence:Number(item.confidence)}));
  for (const [key, raw] of Object.entries(normalized.entities)) {
    if (typeof raw === 'string') normalized.entities[key] = raw.trim().slice(0, 240) || null;
  }
  for (const [key, raw] of Object.entries(normalized.customer_fields)) {
    if (typeof raw === 'string') normalized.customer_fields[key] = raw.trim().slice(0, 160) || null;
  }
  normalized.ambiguities = normalized.ambiguities.map((x) => x.trim().slice(0, 240)).filter(Boolean);
  normalized.corrections = normalized.corrections.map((x) => ({
    field:x.field.trim().slice(0, 64),
    from:typeof x.from === 'string' ? x.from.trim().slice(0, 160) || null : null,
    to:typeof x.to === 'string' ? x.to.trim().slice(0, 160) || null : null
  }));
  return { valid:true, errors:[], value:deepFreeze(normalized) };
}

function exactKeys(value, expected, label, errors) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  for (const missing of wanted.filter((key) => !actual.includes(key))) errors.push(`${label}.${missing} is required`);
  for (const extra of actual.filter((key) => !wanted.includes(key))) errors.push(`${label}.${extra} is not allowed`);
}
function requiredKeys(value,expected,label,errors){for(const key of expected)if(!Object.hasOwn(value,key))errors.push(`${label}.${key} is required`);}
function allowedKeys(value, expected, label, errors) {
  for (const extra of Object.keys(value).filter((key) => !expected.includes(key))) errors.push(`${label}.${extra} is not allowed`);
}
function enumValue(value, allowed, label, errors) { if (!allowed.includes(value)) errors.push(`${label} is invalid`); }
function validateNullable(value, types, label, errors) {
  const allowed = Array.isArray(types) ? types : [types];
  if (value === null && allowed.includes('null')) return;
  if (typeof value === 'string' && allowed.includes('string') && safeString(value, 240, true)) return;
  if (typeof value === 'number' && allowed.includes('number') && Number.isFinite(value)) return;
  if (typeof value === 'boolean' && allowed.includes('boolean')) return;
  errors.push(`${label} has an invalid type or length`);
}
function validateStringArray(value, label, max, errors, allowed = null) {
  if (!Array.isArray(value) || value.length > max) { errors.push(`${label} must be an array with at most ${max} items`); return; }
  for (const item of value) {
    if (!safeString(item, 240, false)) errors.push(`${label} contains an invalid string`);
    else if (allowed && !allowed.includes(item)) errors.push(`${label} contains an unsupported value`);
  }
}
function safeString(value, max, emptyAllowed) { return typeof value === 'string' && value.length <= max && (emptyAllowed || value.trim().length > 0); }
function plainObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }

module.exports = { validateNluOutput };
