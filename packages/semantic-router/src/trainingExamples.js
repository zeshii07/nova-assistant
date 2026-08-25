/*
 * Domain-independent seed utterances for Nova's local semantic router.
 *
 * These examples are not business truth. They teach conversational meaning
 * only. Tenant product/service names are added dynamically from the current
 * tenant's Control Plane vocabulary at inference time.
 */
const TRAINING_EXAMPLES=Object.freeze({
  'conversation.greeting':[
    'hello','hi there','hey how are you','good morning','assalam o alaikum','salam kia hal hai',
    'aoa kaisay ho','اسلام علیکم','مرحبا','السلام عليكم كيف حالك'
  ],
  'conversation.thanks':[
    'thank you','thanks a lot','great thanks','much appreciated','shukriya','bohat shukriya',
    'مہربانی','شکریہ','شكرا','شكرا جزيلا'
  ],
  'conversation.small_talk':[
    'how are you doing today','what are you doing','how is your day','hope you are well',
    'kia haal hai aaj','aap kaise hain','kya kar rahe ho','آپ کیسے ہیں','كيف حالك اليوم'
  ],
  'conversation.confirm':[
    'confirm','yes confirm it','go ahead','proceed with it','that is correct','final kar do',
    'haan confirm','theek hai kar dein','جی تصدیق کریں','نعم أكد الطلب','تمام نفذ'
  ],
  'conversation.reject':[
    'no do not do that','stop this','leave it','never mind','i do not approve','nahi rehne dein',
    'mat karo','cancel this step','نہیں رہنے دیں','لا لا تنفذ','توقف'
  ],
  'conversation.correct':[
    'actually i meant something else','sorry change that','not this but that','make that different',
    'mera matlab yeh nahi tha','asal mein isay change karo','nahi doosra wala',
    'میرا مطلب کچھ اور تھا','أقصد شيئا آخر','صحح ذلك'
  ],
  'booking.create':[
    'i want to book an appointment','please schedule this service','arrange a visit for tomorrow',
    'i need a cleaner on friday','book a consultation at 3 pm','reserve this service for me',
    'i am looking for a service for my villa','i was looking to get my apartment cleaned',
    'could someone clean my place','help me arrange a cleaner','set me up with this service',
    'i need someone to sort out the cleaning','can your team come and clean my house',
    'i am interested in getting this treatment','save me a table for friday evening',
    'mujhe kal booking karwani hai','appointment rakh dein','service book kr do','mujhy kal ghar saaf krwana hai',
    'مجھے کل اپائنٹمنٹ چاہیے','أريد حجز موعد','احجز لي هذه الخدمة غدا'
  ],
  'booking.modify':[
    'change my booking time','move the appointment to monday','reschedule my service',
    'make my booking one hour later','change the date of my visit','update tomorrow request',
    'kal wali booking adjust kar do','time thora late kar dein','appointment ka din badal do',
    'میری بکنگ کا وقت بدل دیں','غير موعد الحجز','أجل الموعد إلى الغد'
  ],
  'booking.cancel':[
    'cancel my booking','i want to cancel the appointment','remove my reservation',
    'do not send the team anymore','stop tomorrow service','booking cancel kar do',
    'kal wali request cancel kar dein','میری بکنگ منسوخ کریں','ألغ الحجز','لا أريد الموعد'
  ],
  'booking.status':[
    'show my booking','what is my appointment status','give me my service request details',
    'is my reservation confirmed','show my booked services','meri booking dikhao',
    'request ka status kya hai','میری بکنگ کی تفصیل','ما حالة حجزي','اعرض موعدي'
  ],
  'availability.check':[
    'are you available tomorrow','check availability at 4 pm','do you have a free slot',
    'what time is the team available','any available time is fine','send them whenever they are free',
    'kal team kis time free hai','jis time available ho','koi khali slot bata dein',
    'کل جو وقت دستیاب ہو','هل يوجد موعد متاح','أي وقت متاح مناسب'
  ],
  'service.list':[
    'what services do you offer','show me all your services','what kind of work do you provide',
    'tell me the available services','what can your business do','aap kon kon si services dete hain',
    'services ki list dikhao','kya kya service available hai','آپ کون سی خدمات دیتے ہیں',
    'ما الخدمات التي تقدمونها','اعرض جميع الخدمات'
  ],
  'service.info':[
    'tell me about this service','what is included in the service','how does this service work',
    'do you provide mattress cleaning','what do you clean','is this service offered',
    'is service mein kya hota hai','kya aap yeh kaam karte hain','اس سروس میں کیا شامل ہے',
    'ماذا تشمل هذه الخدمة','هل تقدمون هذه الخدمة'
  ],
  'service.price':[
    'what are the charges for this service','how much does the service cost','give me a quotation',
    'tell me the cleaning price','what is your hourly rate','how much for a three seater sofa',
    'is ki price kya hai','kitne charges hain','rate bata dein','اس سروس کی قیمت کیا ہے',
    'كم سعر الخدمة','أريد معرفة التكلفة'
  ],
  'service.duration':[
    'how long does this service take','what is the service duration','how many hours will it need',
    'when will the work finish','kitna time lage ga','service kitni dair ki hai',
    'کتنا وقت لگے گا','كم تستغرق الخدمة','ما مدة الموعد'
  ],
  'product.list':[
    'what products do you have','show me all products','what do you sell','list available items',
    'let me browse your catalog','which products are available','aap ke paas kya kya hai',
    'products ki list dikhao','kya saman milta hai','آپ کیا فروخت کرتے ہیں',
    'ما المنتجات المتوفرة','اعرض قائمة المنتجات'
  ],
  'product.info':[
    'tell me about this product','show product details','what features does it have',
    'what kind of shoes are these','give me information about the shirt','is product ki details batao',
    'yeh item kaisa hai','اس چیز کی تفصیل','أعطني تفاصيل المنتج','ما مواصفات هذا المنتج'
  ],
  'product.price':[
    'what is the price of this product','how much is the shirt','tell me the item cost',
    'price of the blue jeans','what does this product cost','is ki qeemat kya hai',
    'kitne ka hai','product ka rate batao','اس کی قیمت کیا ہے','كم سعر هذا المنتج'
  ],
  'product.stock':[
    'is this product in stock','how many are available','do you have this size available',
    'is the black one available','check product stock','yeh stock mein hai','kitne pieces baqi hain',
    'کیا یہ دستیاب ہے','هل المنتج متوفر','كم قطعة متاحة'
  ],
  'cart.view':[
    'show my cart','what is in my cart','give me the current cart summary','show selected items',
    'what have i added','mera cart dikhao','cart mein kya hai','میری ٹوکری دکھائیں',
    'ماذا في سلة التسوق','اعرض السلة'
  ],
  'cart.add':[
    'add this item to my cart','put two shirts in the cart','i want to buy this product',
    'add jeans and shoes','i will take this one','yeh cart mein add kar do',
    'i am looking for running shoes','trying to find a kettle','help me find a black shirt',
    'i am interested in these headphones','shopping for a water bottle',
    'mujhe do shirts chahiye','is item ko shamil karo','اس چیز کو کارٹ میں ڈالیں',
    'أضف المنتج إلى السلة','أريد شراء هذا المنتج'
  ],
  'cart.remove':[
    'remove this item from my cart','delete the shirt from the order','take one bottle out',
    'remove two products','i do not want this item anymore','cart se shirt nikal do',
    'aik item kam kar do','یہ چیز کارٹ سے نکال دیں','احذف المنتج من السلة','أزل قطعة واحدة'
  ],
  'cart.update':[
    'change the item size in my cart','update the color to black','make one shirt large',
    'change the quantity from two to three','edit this cart item','shirt ka size badal do',
    'color blue kar dein','کارٹ میں سائز تبدیل کریں','غير لون المنتج','عدل الكمية'
  ],
  'order.create':[
    'place my order','i want to order these products','start an order for these items',
    'buy all of these','prepare this order','mera order bana dein','yeh sab order karna hai',
    'میرا آرڈر بنائیں','أنشئ طلبا لهذه المنتجات','أريد طلب هذه الأشياء'
  ],
  'order.modify':[
    'change my existing order','edit the products in my order','update the delivery order',
    'modify order quantity','order mein tabdeeli karni hai','mera order adjust karo',
    'میرے آرڈر میں تبدیلی کریں','عدل طلبي الحالي','غير محتويات الطلب'
  ],
  'order.cancel':[
    'cancel my order','i do not want this order','stop the delivery order',
    'delete my placed order','mera order cancel kar do','order nahi chahiye',
    'میرا آرڈر منسوخ کریں','ألغ طلبي','لا أريد الطلب'
  ],
  'order.return':[
    'i want to return this product','take these shirts back','return my purchased item',
    'the item does not fit so i want a return','shirt wapas karni hai','product return kar do',
    'یہ چیز واپس کرنی ہے','أريد إرجاع المنتج','أعد هذا الطلب'
  ],
  'order.exchange':[
    'exchange this product','replace the small shirt with a large one','swap this item for another size',
    'i want a replacement','small ki jagah large kar do','shirt exchange karni hai','actually exchange the small shirt from my last order for large',
    'چھوٹی شرٹ بڑی سے بدل دیں','أريد استبدال المنتج','بدل المقاس الصغير بالكبير'
  ],
  'order.status':[
    'where is my order','show my order history','what is my delivery status',
    'has my order shipped','track the order','mera order kahan hai','order history dikhao',
    'میرے آرڈر کی حالت','أين طلبي','اعرض سجل الطلبات'
  ],
  'business.info':[
    'tell me about your business','what kind of company are you','give me business information',
    'what does your company do','apne business ke bare mein batao','aap ka kaam kya hai',
    'اپنے کاروبار کے بارے میں بتائیں','أخبرني عن نشاطكم','ما طبيعة عملكم'
  ],
  'business.name':[
    'what is your business name','what is the company called','tell me your shop name',
    'business ka naam kya hai','aap ki company ka nam','کاروبار کا نام کیا ہے',
    'ما اسم الشركة','ما اسم المتجر'
  ],
  'business.contact':[
    'what is your phone number','show contact details','how can i contact the business',
    'give me your email address','customer support number','aap ka contact number kya hai',
    'email aur phone bata dein','رابطہ نمبر کیا ہے','ما رقم التواصل','أعطني البريد الإلكتروني'
  ],
  'business.hours':[
    'what are your opening hours','when do you close','are you open on sunday',
    'business timings please','what time do you open','aap kab khulte hain','timing kya hai',
    'دکان کب کھلتی ہے','ما ساعات العمل','متى تغلقون'
  ],
  'business.location':[
    'where are you located','what is your address','show the business location',
    'which areas do you serve','where is your office','aap kahan hain','shop ka address batao',
    'آپ کا پتہ کیا ہے','أين موقعكم','ما عنوان المتجر'
  ],
  'business.policy':[
    'what is your cancellation policy','tell me the refund policy','what are the delivery rules',
    'what happens if staff are late','do you accept returns','policy kya hai','cancel karne ki fee kya hai',
    'واپسی کی پالیسی کیا ہے','ما سياسة الإلغاء','ما شروط الاسترجاع'
  ],
  'customer.update':[
    'my name is ali khan','use this phone number','change my email address','update my contact details',
    'mera naam zeeshan hai','mera number yeh hai','میرا نام علی ہے','رقم هاتفي هو','حدث بياناتي'
  ],
  'complaint':[
    'i want to make a complaint','the service was very bad','my order arrived damaged',
    'the team never arrived','i am unhappy with this','mujhe shikayat karni hai','service achi nahi thi',
    'مجھے شکایت ہے','أريد تقديم شكوى','الخدمة كانت سيئة'
  ],
  'human.request':[
    'let me talk to a person','connect me with an agent','i need human support',
    'call your manager','team member se baat karwao','insan se baat karni hai',
    'نمائندے سے بات کرائیں','أريد التحدث مع موظف','حولني إلى الدعم'
  ]
});

module.exports={TRAINING_EXAMPLES};
