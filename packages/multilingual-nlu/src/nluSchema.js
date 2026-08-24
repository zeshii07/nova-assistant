const LANGUAGES = Object.freeze(['en', 'ur', 'roman_ur', 'ar', 'mixed', 'other']);
const MESSAGE_TYPES = Object.freeze(['answer', 'question', 'request', 'greeting', 'correction', 'confirmation', 'rejection', 'other']);
const WORKFLOW_RELATIONSHIPS = Object.freeze(['continue', 'interrupt', 'replace', 'cancel', 'unrelated']);
const ACTION_SEMANTICS = Object.freeze(['information_only', 'draft_request', 'change_request', 'confirmation', 'rejection', 'none']);
const CERTAINTY_LEVELS = Object.freeze(['explicit', 'implicit', 'ambiguous']);
const INTENTS = Object.freeze([
  'booking.create', 'booking.modify', 'booking.cancel', 'booking.status',
  'availability.check',
  'service.list', 'service.info', 'service.price', 'service.duration',
  'product.list', 'product.info', 'product.price', 'product.stock',
  'cart.view', 'cart.add', 'cart.remove', 'cart.update',
  'order.create', 'order.modify', 'order.cancel', 'order.return', 'order.exchange',
  'business.info', 'business.name', 'business.contact',
  'business.hours', 'business.location', 'business.policy',
  'customer.update', 'order.status', 'complaint', 'human.request',
  'conversation.confirm', 'conversation.reject', 'conversation.correct',
  'other'
]);
const REQUESTED_INFORMATION = Object.freeze([
  'service_list', 'service_price', 'service_duration', 'service_details',
  'product_list', 'product_price', 'product_stock', 'product_details',
  'business_info', 'business_name', 'business_contact',
  'business_hours', 'business_location', 'business_policy',
  'availability', 'cancellation_policy', 'rescheduling_policy',
  'arrival_policy', 'booking_confirmation', 'cart_contents', 'order_status', 'other'
]);

const nullableString = Object.freeze({ type:['string', 'null'] });
const nullableNumber = Object.freeze({ type:['number', 'null'] });
const nullableBoolean = Object.freeze({ type:['boolean', 'null'] });
const nullableDate = Object.freeze({ type:['string', 'null'], pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' });
const nullableTime = Object.freeze({ type:['string', 'null'], pattern:'^([01][0-9]|2[0-3]):[0-5][0-9]$' });

const ENTITY_PROPERTIES = Object.freeze({
  service:nullableString,
  service_id:nullableString,
  product:nullableString,
  product_id:nullableString,
  date_text:nullableString,
  date_normalized:nullableDate,
  alternative_date_text:nullableString,
  alternative_date_normalized:nullableDate,
  time_text:nullableString,
  time_normalized:nullableTime,
  alternative_time_text:nullableString,
  alternative_time_normalized:nullableTime,
  end_time_text:nullableString,
  duration_hours:nullableNumber,
  staff:nullableString,
  quantity:nullableNumber,
  cleaner_count:nullableNumber,
  property_type:nullableString,
  property_size:nullableString,
  bedrooms:nullableNumber,
  balconies:nullableNumber,
  interior_windows:nullableNumber,
  washrooms:nullableNumber,
  halls:nullableNumber,
  address:nullableString,
  location:nullableString,
  recurrence:nullableString,
  supplies_required:nullableBoolean,
  equipment_required:nullableBoolean,
  time_flexible:nullableBoolean,
  booking_id:nullableString,
  order_id:nullableString,
  service_variant:nullableString,
  size:nullableString,
  color:nullableString,
  unit:nullableString
});

const intentItem = Object.freeze({
  type:'object', additionalProperties:false,
  required:['intent', 'message_type', 'confidence'],
  properties:{
    intent:{type:'string', enum:INTENTS},
    message_type:{type:'string', enum:MESSAGE_TYPES},
    confidence:{type:'number', minimum:0, maximum:1}
  }
});

const serviceItem = Object.freeze({
  type:'object', additionalProperties:false,
  required:['service', 'service_id', 'quantity', 'unit', 'service_variant', 'property_type', 'bedrooms', 'staff', 'duration_hours', 'confidence'],
  properties:{
    service:nullableString, service_id:nullableString, quantity:nullableNumber,
    unit:nullableString, service_variant:nullableString, property_type:nullableString,
    bedrooms:nullableNumber, staff:nullableNumber, duration_hours:nullableNumber,
    confidence:{type:'number', minimum:0, maximum:1}
  }
});

const productItem = Object.freeze({
  type:'object', additionalProperties:false,
  required:['product', 'product_id', 'quantity', 'unit', 'size', 'color', 'variant', 'confidence'],
  properties:{
    product:nullableString, product_id:nullableString, quantity:nullableNumber,
    unit:nullableString, size:nullableString, color:nullableString,
    variant:nullableString, confidence:{type:'number', minimum:0, maximum:1}
  }
});

/**
 * Provider contract v2. Every field is explicit so a probabilistic provider
 * cannot smuggle execution instructions or tenant data through extra keys.
 * Local validation still accepts the historical v1 shape for test fixtures
 * and rolling deployments; only newly requested provider output uses v2.
 */
const NOVA_NLU_SCHEMA = Object.freeze({
  type:'object',
  additionalProperties:false,
  required:[
    'schema_version', 'language', 'message_type', 'action_semantics', 'certainty',
    'intent', 'intents', 'confidence', 'workflow_relationship', 'entities',
    'service_items', 'product_items', 'customer_fields', 'requested_information',
    'missing_information', 'corrections', 'ambiguities'
  ],
  properties:{
    schema_version:{type:'string', const:'2.0'},
    language:{type:'string', enum:LANGUAGES},
    message_type:{type:'string', enum:MESSAGE_TYPES},
    action_semantics:{type:'string', enum:ACTION_SEMANTICS},
    certainty:{type:'string', enum:CERTAINTY_LEVELS},
    intent:{type:'string', enum:INTENTS},
    intents:{type:'array', maxItems:12, items:intentItem},
    confidence:{type:'number', minimum:0, maximum:1},
    workflow_relationship:{type:'string', enum:WORKFLOW_RELATIONSHIPS},
    entities:{type:'object', additionalProperties:false, required:Object.keys(ENTITY_PROPERTIES), properties:ENTITY_PROPERTIES},
    service_items:{type:'array', maxItems:12, items:serviceItem},
    product_items:{type:'array', maxItems:20, items:productItem},
    customer_fields:{
      type:'object', additionalProperties:false, required:['name', 'phone', 'email'],
      properties:{name:nullableString, phone:nullableString, email:nullableString}
    },
    requested_information:{type:'array', maxItems:16, uniqueItems:true, items:{type:'string', enum:REQUESTED_INFORMATION}},
    missing_information:{type:'array', maxItems:20, uniqueItems:true, items:{type:'string'}},
    corrections:{
      type:'array', maxItems:12,
      items:{
        type:'object', additionalProperties:false, required:['field', 'from', 'to'],
        properties:{field:{type:'string'}, from:nullableString, to:nullableString}
      }
    },
    ambiguities:{type:'array', maxItems:12, items:{type:'string'}}
  }
});

module.exports = {
  LANGUAGES, MESSAGE_TYPES, WORKFLOW_RELATIONSHIPS, ACTION_SEMANTICS,
  CERTAINTY_LEVELS, INTENTS, REQUESTED_INFORMATION, ENTITY_PROPERTIES,
  NOVA_NLU_SCHEMA
};
