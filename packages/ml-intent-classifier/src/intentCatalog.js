/**
 * Nova ML Intent Classifier — Intent Catalog
 *
 * Defines the catalog of business intents Nova's ML classifier can predict.
 * Each intent has:
 *  - canonicalId: stable string used everywhere (e.g., "booking.create")
 *  - capabilityId: which capability adapter owns this intent
 *  - description: human-readable one-liner (used for trace logging)
 *  - examples: multilingual training utterances (en + roman_urdu + urdu + arabic)
 *
 * The catalog intentionally mirrors the semantic router's TRAINING_EXAMPLES
 * (packages/semantic-router/src/trainingExamples.js) but adds:
 *  - explicit intent→capability mapping (so the hybrid router can boost the
 *    right capability when ML predicts an intent)
 *  - per-intent weight tuning (transactional intents weighted higher than
 *    informational ones, matching the existing intentPriority ladder)
 *  - additional examples harvested from the v9.4.1 stress-test kit and the
 *    400-query v13.0 stress suite (covers typos, mixed-script, multilingual)
 *
 * IMPORTANT: examples are SEED data, not business truth. Tenant-specific
 * vocabulary (product/service names) is added at inference time by the
 * hybrid router (see mlIntentClassifier.js → contextualBoost).
 */

const INTENT_CATALOG = Object.freeze([
  // === Conversation social intents ===
  {
    canonicalId: 'conversation.greeting',
    capabilityId: 'assistant',
    description: 'Hello / hi / assalam o alaikum',
    weight: 0.85,
    examples: [
      'hello','hi there','hey how are you','good morning','good evening',
      'assalam o alaikum','salam kia hal hai','aoa kaisay ho','aoa',
      'اسلام علیکم','السلام عليكم','مرحبا','السلام عليكم كيف حالك',
      'salam','hey','hola','good afternoon'
    ]
  },
  {
    canonicalId: 'conversation.thanks',
    capabilityId: 'assistant',
    description: 'Thank you / shukriya',
    weight: 0.85,
    examples: [
      'thank you','thanks a lot','great thanks','much appreciated','thanks',
      'shukriya','bohat shukriya','thank u','thx','appreciate it',
      'مہربانی','شکریہ','شكرا','شكرا جزيلا','جزاك الله خيرا'
    ]
  },
  {
    canonicalId: 'conversation.small_talk',
    capabilityId: 'assistant',
    description: 'How are you / casual chat',
    weight: 0.80,
    examples: [
      'how are you doing today','what are you doing','how is your day',
      'hope you are well','kia haal hai aaj','aap kaise hain','kya kar rahe ho',
      'آپ کیسے ہیں','كيف حالك اليوم','what can you do','who are you'
    ]
  },
  {
    canonicalId: 'conversation.confirm',
    capabilityId: null, // cross-cutting — handled by every capability
    description: 'Yes / confirm / go ahead',
    weight: 1.0,
    examples: [
      'confirm','yes confirm it','go ahead','proceed with it','that is correct',
      'final kar do','haan confirm','theek hai kar dein','yes','ok','okay',
      'جی تصدیق کریں','نعم أكد الطلب','تمام نفذ','haan','sahi hai'
    ]
  },
  {
    canonicalId: 'conversation.reject',
    capabilityId: null,
    description: 'No / cancel / never mind',
    weight: 1.0,
    examples: [
      'no do not do that','stop this','leave it','never mind','i do not approve',
      'nahi rehne dein','mat karo','cancel this step','no','na','nahi',
      'نہیں رہنے دیں','لا لا تنفذ','توقف','no thanks','not now'
    ]
  },
  {
    canonicalId: 'conversation.correct',
    capabilityId: null,
    description: 'Actually I meant / change that',
    weight: 0.95,
    examples: [
      'actually i meant something else','sorry change that','not this but that',
      'make that different','mera matlab yeh nahi tha','asal mein isay change karo',
      'nahi doosra wala','wait that is wrong','actually',
      'میرا مطلب کچھ اور تھا','أقصد شيئا آخر','صحح ذلك'
    ]
  },

  // === Booking / Cleaning workflow ===
  {
    canonicalId: 'booking.create',
    capabilityId: 'cleaning',
    description: 'Book / schedule / reserve a service',
    weight: 1.0,
    examples: [
      'i want to book an appointment','please schedule this service',
      'arrange a visit for tomorrow','i need a cleaner on friday',
      'book a consultation at 3 pm','reserve this service for me',
      'i am looking for a service for my villa','i was looking to get my apartment cleaned',
      'could someone clean my place','help me arrange a cleaner',
      'set me up with this service','i need someone to sort out the cleaning',
      'can your team come and clean my house','i am interested in getting this treatment',
      'mujhe kal booking karwani hai','appointment rakh dein','service book kr do',
      'mujhy kal ghar saaf krwana hai','booking kar do','book kar lo',
      'مجھے کل اپائنٹمنٹ چاہیے','أريد حجز موعد','احجز لي هذه الخدمة غدا',
      'i want to book cleaning for tomorrow','schedule for next monday',
      'arrange cleaning at 10 am','can i book a service','need someone to clean'
    ]
  },
  {
    canonicalId: 'booking.modify',
    capabilityId: 'cleaning',
    description: 'Change booking time/date',
    weight: 0.95,
    examples: [
      'change my booking time','move the appointment to monday','reschedule my service',
      'make my booking one hour later','change the date of my visit',
      'update tomorrow request','kal wali booking adjust kar do',
      'time thora late kar dein','appointment ka din badal do','shift to next week',
      'میری بکنگ کا وقت بدل دیں','غير موعد الحجز','أجل الموعد إلى الغد'
    ]
  },
  {
    canonicalId: 'booking.cancel',
    capabilityId: 'cleaning',
    description: 'Cancel a booking',
    weight: 1.0,
    examples: [
      'cancel my booking','i want to cancel the appointment','remove my reservation',
      'do not send the team anymore','stop tomorrow service','booking cancel kar do',
      'kal wali request cancel kar dein','cancel this booking',
      'میری بکنگ منسوخ کریں','ألغ الحجز','لا أريد الموعد'
    ]
  },
  {
    canonicalId: 'booking.status',
    capabilityId: 'cleaning',
    description: 'Check booking status',
    weight: 0.85,
    examples: [
      'show my booking','what is my appointment status','give me my service request details',
      'is my reservation confirmed','show my booked services','meri booking dikhao',
      'request ka status kya hai','where is my booking','when is my appointment',
      'میری بکنگ کی تفصیل','ما حالة حجزي','اعرض موعدي'
    ]
  },
  {
    canonicalId: 'cleaning.service_request',
    capabilityId: 'cleaning',
    description: 'I need cleaning of X',
    weight: 1.0,
    examples: [
      'i want cleaning of my apartment','i need sofa cleaning',
      'mujhy ghar ki safai chahiye','carpet cleaning chahiye',
      'deep cleaning karwani hai','mattress cleaning',
      'مجھے صفائی چاہیے','أريد تنظيف','i need my carpet cleaned',
      'sofa shampoo service','clean my kitchen','washroom cleaning',
      'curtain cleaning','furniture cleaning'
    ]
  },
  {
    canonicalId: 'cleaning.multi_service_request',
    capabilityId: 'cleaning',
    description: 'Multiple services in one message',
    weight: 1.0,
    examples: [
      'i want cleaning of my apartment and also sofa cleaning',
      'book office cleaning and a 3 seater sofa cleaning',
      'i need deep apartment cleaning plus carpet cleaning',
      'mujhy ghar ki safai aur sofa cleaning chahiye',
      'مجھے اپارٹمنٹ کی صفائی اور صوفہ کلیننگ چاہیے',
      'i want office cleaning sofa cleaning and carpet cleaning',
      'apartment cleaning and mattress cleaning'
    ]
  },
  {
    canonicalId: 'cleaning.scope_info',
    capabilityId: 'cleaning',
    description: 'What is included in deep cleaning?',
    weight: 0.80,
    examples: [
      'what is included in deep cleaning','what does deep cleaning cover',
      'deep cleaning mein kya kya aata hai','deep cleaning includes',
      'what is the difference between standard and deep',
      'گہری صفائی میں کیا شامل ہے','ماذا يشمل التنظيف العميق'
    ]
  },
  {
    canonicalId: 'cleaning.service_list',
    capabilityId: 'cleaning',
    description: 'What cleaning services do you provide?',
    weight: 0.85,
    examples: [
      'what cleaning services do you provide','do you provide deep cleaning',
      'do you clean carpets','do you wash sofas','will you clean furniture',
      'kya aap carpet clean karte hain','aap kon kon si cleaning karte hain',
      'کیا آپ صوفہ صاف کرتے ہیں','هل تقومون بتنظيف السجاد'
    ]
  },
  {
    canonicalId: 'service.price',
    capabilityId: 'cleaning',
    description: 'How much does X cost?',
    weight: 0.90,
    examples: [
      'how much for 3 bedroom apartment deep cleaning',
      'what are the charges for sofa cleaning',
      'price of carpet cleaning','how much does deep cleaning cost',
      'rate for cleaning','kitne ka milega','charges kya hain',
      '3 bdroom apartment deep cleaning charges',
      'کیا قیمت ہے','كم السعر','كم تكلفة'
    ]
  },
  {
    canonicalId: 'availability.check',
    capabilityId: 'availability',
    description: 'Are you available on X?',
    weight: 0.90,
    examples: [
      'are you available tomorrow','is saturday open','do you have a slot on monday',
      'kal available ho','kya aap kal free hain',
      'کیا آپ کل دستیاب ہیں','هل أنتم متاحون غدا','are you open on friday'
    ]
  },
  {
    canonicalId: 'service.duration',
    capabilityId: 'cleaning',
    description: 'How long does the service take?',
    weight: 0.80,
    examples: [
      'how long does deep cleaning take','how many hours for apartment cleaning',
      'kitna time lagega','service kitni der ki hai',
      'کتنا وقت لگے گا','كم يستغرق التنظيف'
    ]
  },

  // === Catalog / commerce ===
  {
    canonicalId: 'product.list',
    capabilityId: 'catalog',
    description: 'Show me products',
    weight: 0.90,
    examples: [
      'show me products','what products do you have','list your items',
      'show me watches','display available products',
      'products dikhao','kya kya available hai',
      'اپنے پروڈکٹس دکھائیں','اعرض المنتجات'
    ]
  },
  {
    canonicalId: 'product.info',
    capabilityId: 'catalog',
    description: 'Tell me about this product',
    weight: 0.85,
    examples: [
      'tell me about this product','what is this watch','details of this item',
      'product ki detail do','is product ke baare mein batao',
      'اس پروڈکٹ کی تفصیل دیں','أخبرني عن هذا المنتج'
    ]
  },
  {
    canonicalId: 'product.price',
    capabilityId: 'catalog',
    description: 'How much is this product?',
    weight: 0.85,
    examples: [
      'how much is this','price of this product','cost of this watch',
      'is ki qeemat kya hai','product ka rate',
      'اس کی قیمت کیا ہے','كم سعر هذا'
    ]
  },
  {
    canonicalId: 'cart.add',
    capabilityId: 'commerce',
    description: 'Add to cart',
    weight: 1.0,
    examples: [
      'add to cart','i want to buy this','add this to my order',
      'cart mein dalo','mujhe yeh chahiye',
      'اس کو کارٹ میں ڈالیں','أضف إلى السلة'
    ]
  },
  {
    canonicalId: 'cart.view',
    capabilityId: 'commerce',
    description: 'Show my cart',
    weight: 0.80,
    examples: [
      'show my cart','what is in my cart','view cart','cart dikhao',
      'cart mein kya hai','اپنا کارٹ دکھائیں','اعرض السلة'
    ]
  },
  {
    canonicalId: 'cart.update',
    capabilityId: 'commerce',
    description: 'Change cart item quantity/variant',
    weight: 0.90,
    examples: [
      'change quantity to 2','update my cart','make it 3 items',
      'cart update kar do','quantity barha do','quantity kam kar do',
      'کارٹ اپ ڈیٹ کریں','حدث السلة'
    ]
  },
  {
    canonicalId: 'cart.remove',
    capabilityId: 'commerce',
    description: 'Remove from cart',
    weight: 0.95,
    examples: [
      'remove this from cart','i do not want this anymore','take this out',
      'cart se hata do','isko remove kar do',
      'اس کو ہٹا دیں','أزل من السلة'
    ]
  },
  {
    canonicalId: 'order.create',
    capabilityId: 'commerce',
    description: 'Place order / checkout',
    weight: 1.0,
    examples: [
      'place my order','checkout','i want to order this','confirm my order',
      'order place kar do','checkout kar lo','mujhe order karna hai',
      'اپنا آرڈر پلیس کریں','أكد الطلب','checkout please'
    ]
  },
  {
    canonicalId: 'order.status',
    capabilityId: 'commerce',
    description: 'Where is my order?',
    weight: 0.85,
    examples: [
      'where is my order','order status please','when will my order arrive',
      'mera order kahan hai','order kab ayega',
      'میرا آرڈر کہاں ہے','أين طلب','متى سيصل الطلب'
    ]
  },
  {
    canonicalId: 'order.cancel',
    capabilityId: 'commerce',
    description: 'Cancel my order',
    weight: 1.0,
    examples: [
      'cancel my order','i want to cancel the order','stop my order',
      'order cancel kar do','mera order cancel kar dein',
      'میرا آرڈر منسوخ کریں','ألغ الطلب'
    ]
  },
  {
    canonicalId: 'order.return',
    capabilityId: 'commerce',
    description: 'Return / refund',
    weight: 0.95,
    examples: [
      'i want to return this','refund please','return my order',
      'wapas karna hai','refund chahiye','order wapas',
      'واپس کرنا ہے','إرجاع','استرجاع'
    ]
  },
  {
    canonicalId: 'order.exchange',
    capabilityId: 'commerce',
    description: 'Exchange / swap',
    weight: 0.95,
    examples: [
      'i want to exchange this','swap for another','replace this',
      'badalna hai','exchange karwana hai','doosra size chahiye',
      'بدلنا ہے','استبدال'
    ]
  },

  // === Business identity questions ===
  {
    canonicalId: 'business.info',
    capabilityId: 'assistant',
    description: 'Tell me about this business',
    weight: 0.85,
    examples: [
      'tell me about your business','what do you do','what is your business',
      'aap kya karte hain','aap ka business kya hai',
      'آپ کا بزنس کیا ہے','ماذا تفعلون'
    ]
  },
  {
    canonicalId: 'business.name',
    capabilityId: 'assistant',
    description: 'What is your name?',
    weight: 0.85,
    examples: [
      'what is your name','your name please','who are you',
      'aap ka naam kya hai','tumhara naam',
      'آپ کا نام کیا ہے','ما اسمك'
    ]
  },
  {
    canonicalId: 'business.contact',
    capabilityId: 'assistant',
    description: 'How do I contact you?',
    weight: 0.85,
    examples: [
      'how do i contact you','phone number','email address','contact info',
      'aap ka number kya hai','contact kaise karein',
      'رابطہ کیسے کریں','كيف أتواصل معكم'
    ]
  },
  {
    canonicalId: 'business.hours',
    capabilityId: 'assistant',
    description: 'What are your hours?',
    weight: 0.85,
    examples: [
      'what are your hours','when are you open','opening times',
      'aap kab khulte hain','working hours',
      'آپ کب کھلتے ہیں','متى تفتحون'
    ]
  },
  {
    canonicalId: 'business.location',
    capabilityId: 'assistant',
    description: 'Where are you located?',
    weight: 0.85,
    examples: [
      'where are you located','your address','where is your shop',
      'aap kahan ho','shop kahan hai',
      'آپ کہاں ہیں','أين أنتم'
    ]
  },

  // === CRM / customer data ===
  {
    canonicalId: 'customer.update',
    capabilityId: 'crm',
    description: 'Update my profile',
    weight: 0.90,
    examples: [
      'my name is ali','my phone is 0300','update my details',
      'mera naam ali hai','mera number',
      'میرا نام علی ہے','اسمي علي','update profile'
    ]
  },

  // === Knowledge questions ===
  {
    canonicalId: 'knowledge.question',
    capabilityId: 'assistant',
    description: 'General knowledge question',
    weight: 0.75,
    examples: [
      'how do i clean a stain','what is the best way to remove grease',
      'can i use bleach on marble','how often should i deep clean',
      'stain kaise hataye','grease kaise saaf karein',
      'داغ کیسے ہٹائیں','كيف أنظف البقعة'
    ]
  }
]);

// === Intent → Capability map (for hybrid routing) ===
const INTENT_CAPABILITY_MAP = Object.freeze(
  INTENT_CATALOG.reduce((map, intent) => {
    if (intent.capabilityId) map[intent.canonicalId] = intent.capabilityId;
    return map;
  }, {})
);

// === Intent priority ladder (mirrors the existing intentPriority function) ===
// Used by the hybrid router to break ties when multiple intents have similar
// ML confidence. Cancellation/modification intents win over informational.
const INTENT_PRIORITY = Object.freeze(
  INTENT_CATALOG.reduce((map, intent) => {
    let priority = 10;
    if (intent.canonicalId.startsWith('booking.cancel') || intent.canonicalId.startsWith('order.cancel')) priority = 100;
    else if (intent.canonicalId.startsWith('booking.modify') || intent.canonicalId.startsWith('cart.update') || intent.canonicalId.startsWith('cart.remove') || intent.canonicalId.startsWith('order.modify')) priority = 90;
    else if (intent.canonicalId.startsWith('booking.create') || intent.canonicalId.startsWith('cart.add') || intent.canonicalId.startsWith('order.create') || intent.canonicalId.startsWith('cleaning.')) priority = 80;
    else if (intent.canonicalId.startsWith('service.') || intent.canonicalId.startsWith('product.') || intent.canonicalId.startsWith('order.status') || intent.canonicalId.startsWith('booking.status') || intent.canonicalId.startsWith('availability.')) priority = 60;
    else if (intent.canonicalId.startsWith('business.') || intent.canonicalId.startsWith('knowledge.')) priority = 40;
    else if (intent.canonicalId.startsWith('conversation.')) priority = 20;
    map[intent.canonicalId] = priority;
    return map;
  }, {})
);

module.exports = {
  INTENT_CATALOG,
  INTENT_CAPABILITY_MAP,
  INTENT_PRIORITY,
};
