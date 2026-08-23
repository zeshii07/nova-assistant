/**
 * Generates stable multilingual assistant responses.
 * Transactional facts are passed in as approved data and never invented here.
 */
class ResponseEngine {
  reply({ intent, language, tenant, fact }) {
    const name = tenant.branding?.assistantName || tenant.name;
    const lang = language || "english";
    if (intent === 'unsupported_capability') return this.specialUnsupported(fact, lang);
    if (intent === 'price_concern') return this.specialPriceConcern(lang);
    if (fact) return this.factReply(intent, fact, lang);

    const dictionary = {
      english: {
        greet: tenant.branding?.welcomeMessage || `Hello! I’m ${name}. How can I help you?`,
        thanks: "You're welcome 😊 Message me anytime if you need anything else.",
        goodbye: "Goodbye! Feel free to message anytime.",
        small_talk: "I'm doing well, thank you! 😊 How are you? What can I help you with today?",
        price_concern: "I understand 😄 The price can feel a little high. If you want, I can help you compare other available options before you decide.",
        unsupported_capability: `Sorry 😊 ${fact || "That service"} isn't something this business currently offers. I can still help with the services and products that are available here.`,
        assistant_identity: `I’m ${name}, an AI assistant for ${tenant.name}.`,
        missing: "I don’t have approved information about that yet. Please contact the team for confirmation.",
        fallback: "I’m not fully sure what you mean. You can ask about the business, services, hours, contact details, or location."
      },
      roman_urdu: {
        greet: tenant.branding?.welcomeMessageRomanUrdu || `Assalam-o-alaikum! Main ${name} hoon. Main aapki kya madad kar sakta hoon?`,
        thanks: "Khushi hui 😊 Agar kisi aur cheez ki zarurat ho to message kar dein.",
        goodbye: "Allah Hafiz! Aap kabhi bhi message kar sakte hain.",
        small_talk: "Main bilkul theek hoon, shukriya 😊 Aap sunayein? Aaj main aapki kis cheez mein madad karun?",
        price_concern: "Haan 😄 price thori zyada lag sakti hai. Agar chahein to main available alternatives compare karwa deta hoon.",
        unsupported_capability: `Maazrat 😊 ${fact || "Yeh service"} is business mein filhal available nahi hai. Jo services ya products yahan available hain un mein main zaroor madad kar sakta hoon.`,
        assistant_identity: `Main ${tenant.name} ka AI assistant ${name} hoon.`,
        missing: "Is baat ki approved information mere paas abhi nahi hai. Tasdeeq ke liye team se rabta karein.",
        fallback: "Main baat puri tarah samajh nahi saka. Aap business, services, timings, contact ya location ke bare mein pooch sakte hain."
      },
      urdu: {
        greet: tenant.branding?.welcomeMessageUrdu || `السلام علیکم! میں ${name} ہوں۔ میں آپ کی کیا مدد کر سکتا ہوں؟`,
        thanks: "خوشی ہوئی 😊 اگر مزید مدد چاہیے تو پیغام کریں۔",
        goodbye: "اللہ حافظ! آپ کسی بھی وقت پیغام کر سکتے ہیں۔",
        small_talk: "میں بالکل ٹھیک ہوں، شکریہ 😊 آپ سنائیے؟ آج میں آپ کی کس چیز میں مدد کروں؟",
        price_concern: "جی 😄 قیمت کچھ زیادہ لگ سکتی ہے۔ اگر چاہیں تو میں دوسرے دستیاب آپشنز بتا سکتا ہوں۔",
        unsupported_capability: `معذرت 😊 ${fact || "یہ سروس"} اس کاروبار میں فی الحال دستیاب نہیں ہے۔ دستیاب خدمات یا مصنوعات میں میں ضرور مدد کر سکتا ہوں۔`,
        assistant_identity: `میں ${tenant.name} کا اے آئی اسسٹنٹ ${name} ہوں۔`,
        missing: "اس بارے میں منظور شدہ معلومات میرے پاس موجود نہیں۔ تصدیق کے لیے ٹیم سے رابطہ کریں۔",
        fallback: "میں بات مکمل طور پر نہیں سمجھ سکا۔ آپ کاروبار، خدمات، اوقات، رابطہ یا مقام کے بارے میں پوچھ سکتے ہیں۔"
      },
      arabic: {
        greet: tenant.branding?.welcomeMessageArabic || `مرحبًا! أنا ${name}. كيف يمكنني مساعدتك؟`,
        thanks: "على الرحب والسعة 😊 راسلني في أي وقت إذا احتجت إلى مساعدة أخرى.",
        goodbye: "إلى اللقاء! يمكنك مراسلتنا في أي وقت.",
        small_talk: "أنا بخير، شكرًا لك 😊 كيف يمكنني مساعدتك اليوم؟",
        price_concern: "أتفهم ذلك 😄 قد يبدو السعر مرتفعًا قليلًا. يمكنني مساعدتك في مقارنة الخيارات المتاحة قبل أن تقرر.",
        unsupported_capability: `عذرًا 😊 ${fact || "هذه الخدمة"} غير متاحة لدى هذا النشاط حاليًا. يمكنني مساعدتك في الخدمات أو المنتجات المتاحة هنا.`,
        assistant_identity: `أنا ${name}، المساعد الذكي لدى ${tenant.name}.`,
        missing: "لا تتوفر لدي معلومات معتمدة عن ذلك حاليًا. يرجى التواصل مع الفريق للتأكيد.",
        fallback: "لم أفهم طلبك بالكامل. يمكنك السؤال عن النشاط أو الخدمات أو المنتجات أو أوقات العمل أو بيانات التواصل."
      }
    };
    const selected = dictionary[lang] || dictionary.english;
    return selected[intent] || selected.fallback;
  }


  specialUnsupported(domain, language) {
    const label = domain || "that service";
    if (language === "roman_urdu") return `Maazrat 😊 ${label} is business mein filhal available nahi hai. Jo services ya products yahan available hain un mein main zaroor madad kar sakta hoon.`;
    if (language === "urdu") return `معذرت 😊 ${label} اس کاروبار میں فی الحال دستیاب نہیں ہے۔ دستیاب خدمات یا مصنوعات میں میں ضرور مدد کر سکتا ہوں۔`;
    if (language === "arabic") return `عذرًا 😊 ${label} غير متاحة لدى هذا النشاط حاليًا. يمكنني مساعدتك في الخدمات أو المنتجات المتاحة هنا.`;
    return `Sorry 😊 ${label} isn't something this business currently offers. I can still help with the products and services available here.`;
  }

  specialPriceConcern(language) {
    if (language === "roman_urdu") return "Haan 😄 price thori zyada lag sakti hai. Agar chahein to main available alternatives compare karwa deta hoon.";
    if (language === "urdu") return "جی 😄 قیمت کچھ زیادہ لگ سکتی ہے۔ اگر چاہیں تو میں دوسرے دستیاب آپشنز بتا سکتا ہوں۔";
    if (language === "arabic") return "أتفهم ذلك 😄 قد يبدو السعر مرتفعًا قليلًا. يمكنني مساعدتك في مقارنة الخيارات المتاحة قبل أن تقرر.";
    return "I understand 😄 The price can feel a little high. If you want, I can help you compare other available options before you decide.";
  }

  factReply(intent, fact, language) {
    const labels = {
      english: { ask_business_info:"", ask_about: "", ask_services: "Our services: ", ask_hours: "Business hours: ", ask_contact: "Contact: ", ask_location: "Location: ", ask_delivery: "Delivery: ", ask_takeaway: "Takeaway: ", ask_payment: "Payment methods: ", ask_returns: "Returns: ", ask_faq: "Common questions:\n" },
      roman_urdu: { ask_business_info:"", ask_about: "", ask_services: "Hamari services: ", ask_hours: "Business timings: ", ask_contact: "Rabta: ", ask_location: "Location: ", ask_delivery: "Delivery: ", ask_takeaway: "Takeaway: ", ask_payment: "Payment methods: ", ask_returns: "Return policy: ", ask_faq: "Aam sawalat:\n" },
      urdu: { ask_business_info:"", ask_about: "", ask_services: "ہماری خدمات: ", ask_hours: "کاروباری اوقات: ", ask_contact: "رابطہ: ", ask_location: "مقام: ", ask_delivery: "ڈیلیوری: ", ask_takeaway:"ٹیک اوے: ", ask_payment: "ادائیگی کے طریقے: ", ask_returns: "واپسی کی پالیسی: ", ask_faq: "عام سوالات:\n" },
      arabic: { ask_business_info:"", ask_about:"", ask_services:"خدماتنا: ", ask_hours:"ساعات العمل: ", ask_contact:"التواصل: ", ask_location:"الموقع: ", ask_delivery:"التوصيل: ", ask_takeaway:"الاستلام: ", ask_payment:"طرق الدفع: ", ask_returns:"سياسة الإرجاع: ", ask_faq:"الأسئلة الشائعة:\n" }
    };
    const prefix = (labels[language] || labels.english)[intent] || "";
    return `${prefix}${fact}`;
  }
}
module.exports = { ResponseEngine };
