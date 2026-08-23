const LANGUAGES = Object.freeze(['en', 'ur', 'roman_ur', 'ar', 'mixed', 'other']);
const MESSAGE_TYPES = Object.freeze(['answer', 'question', 'request', 'greeting', 'correction', 'confirmation', 'rejection', 'other']);
const WORKFLOW_RELATIONSHIPS = Object.freeze(['continue', 'interrupt', 'replace', 'cancel', 'unrelated']);
const INTENTS = Object.freeze([
  'booking.create', 'booking.modify', 'booking.cancel',
  'booking.status',
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
  'service_list',
  'service_price', 'service_duration', 'service_details',
  'product_list',
  'product_price', 'product_stock', 'product_details',
  'business_info', 'business_name', 'business_contact',
  'business_hours', 'business_location', 'business_policy',
  'availability', 'cancellation_policy', 'rescheduling_policy',
  'arrival_policy', 'booking_confirmation', 'other'
]);

const nullableString = { type:['string', 'null'] };
const nullableNumber = { type:['number', 'null'] };
const nullableBoolean = { type:['boolean', 'null'] };

const ENTITY_PROPERTIES = Object.freeze({
  service:nullableString,
  service_id:nullableString,
  product:nullableString,
  product_id:nullableString,
  date_text:nullableString,
  date_normalized:{ type:['string', 'null'], pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
  time_text:nullableString,
  time_normalized:{ type:['string', 'null'], pattern:'^([01][0-9]|2[0-3]):[0-5][0-9]$' },
  end_time_text:nullableString,
  duration_hours:nullableNumber,
  staff:nullableString,
  quantity:nullableNumber,
  cleaner_count:nullableNumber,
  property_type:nullableString,
  bedrooms:nullableNumber,
  balconies:nullableNumber,
  interior_windows:nullableNumber,
  washrooms:nullableNumber,
  halls:nullableNumber,
  address:nullableString,
  recurrence:nullableString,
  supplies_required:nullableBoolean,
  equipment_required:nullableBoolean
});

const NOVA_NLU_SCHEMA = Object.freeze({
  type:'object',
  additionalProperties:false,
  required:[
    'schema_version', 'language', 'message_type', 'intent', 'confidence',
    'workflow_relationship', 'entities', 'customer_fields',
    'requested_information', 'corrections', 'ambiguities'
  ],
  properties:{
    schema_version:{ type:'string', const:'1.0' },
    language:{ type:'string', enum:LANGUAGES },
    message_type:{ type:'string', enum:MESSAGE_TYPES },
    intent:{ type:'string', enum:INTENTS },
    intents:{
      type:'array', maxItems:8,
      items:{
        type:'object', additionalProperties:false,
        required:['intent','message_type','confidence'],
        properties:{
          intent:{type:'string',enum:INTENTS},
          message_type:{type:'string',enum:MESSAGE_TYPES},
          confidence:{type:'number',minimum:0,maximum:1}
        }
      }
    },
    confidence:{ type:'number', minimum:0, maximum:1 },
    workflow_relationship:{ type:'string', enum:WORKFLOW_RELATIONSHIPS },
    entities:{
      type:'object', additionalProperties:false,
      required:[], properties:ENTITY_PROPERTIES
    },
    customer_fields:{
      type:'object', additionalProperties:false,
      required:[],
      properties:{ name:nullableString, phone:nullableString, email:nullableString }
    },
    requested_information:{
      type:'array', maxItems:12, uniqueItems:true,
      items:{ type:'string', enum:REQUESTED_INFORMATION }
    },
    corrections:{
      type:'array', maxItems:10,
      items:{
        type:'object', additionalProperties:false,
        required:['field', 'from', 'to'],
        properties:{ field:{type:'string'}, from:nullableString, to:nullableString }
      }
    },
    ambiguities:{ type:'array', maxItems:10, items:{type:'string'} }
  }
});

module.exports = {
  LANGUAGES, MESSAGE_TYPES, WORKFLOW_RELATIONSHIPS, INTENTS,
  REQUESTED_INFORMATION, ENTITY_PROPERTIES, NOVA_NLU_SCHEMA
};
