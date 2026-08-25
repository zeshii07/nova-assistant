/**
 * Tenant-neutral product guide for Nova's public marketing chat.
 *
 * The guide deliberately answers only about Nova and general conversation. It
 * never enters a tenant workflow or reads tenant/customer data. Responses and
 * follow-up suggestions are deterministic so the public endpoint stays safe,
 * quick, and useful even when no external language-model provider is enabled.
 */
function replyToNovaVisitor(rawText,{previousTopic=null,language='auto'}={}){
  const result=replyToNovaVisitorEnglish(rawText,{previousTopic});
  const resolved=resolveLanguage(rawText,language);
  if(resolved!=='roman_urdu')return {...result,language:'english'};
  return {
    ...result,
    language:'roman_urdu',
    reply:ROMAN_REPLIES[result.topic]||ROMAN_REPLIES.fallback,
    suggestions:ROMAN_SUGGESTIONS[result.topic]||ROMAN_SUGGESTIONS.default
  };
}

function replyToNovaVisitorEnglish(rawText,{previousTopic=null}={}){
  const text=String(rawText||'').trim();
  const normalized=normalize(text);
  if(!normalized)return answer('empty','Please ask me anything about Nova. I can explain what I do, how onboarding works, or which business problems I solve.');

  if(isShortAcceptance(normalized)&&previousTopic)return contextualFollowUp(previousTopic);

  if(matches(normalized,[/who (?:made|built|created|developed) (?:you|nova)/,/your (?:creator|developer|maker)/,/kis ne (?:banaya|bnaya)/])){
    return answer('creator','Zeeshan made me with love to solve customer-related automations for businesses. I was designed to make customer conversations faster, friendlier, and easier to manage. Would you like to see the business tasks I can handle?');
  }
  if(matches(normalized,[/^how are you(?: today| doing)?$/,/^how r u$/,/^how do you do$/,/^kese ho$/,/^kaise ho$/,/^kya haal(?: hai)?$/,/^what s up$/,/^whats up$/])){
    return answer('small_talk','I’m doing great, thank you 😊 I’m always happy to chat and explain how Nova can help. Are you exploring me as an assistant, or as a booking and customer-support agent for your business?');
  }
  if(/^(?:hi|hello|hey|salam|assalam|good morning|good afternoon|good evening)\b/.test(normalized)){
    return answer('greeting','Hello! 👋 I’m Nova, an AI business assistant built for customer conversations and automation. You can ask what I do, why I was made, or how I could help your business. What would you like to explore first?');
  }
  if(matches(normalized,[/thank/,/thanks/,/shukriya/]))return answer('thanks','You’re very welcome 😊 I’m here whenever you want to explore customer automation, bookings, sales, or support. What would you like to look at next?');
  if(matches(normalized,[/goodbye/,/bye bye/,/^bye$/,/see you/]))return answer('goodbye','Goodbye for now 👋 When you return, ask me about any customer workflow or business problem you would like Nova to automate.');
  if(matches(normalized,[/you are (?:great|amazing|awesome|good)/,/i like you/,/nice work/]))return answer('compliment','Thank you — that means a lot 😊 I’m built to make business conversations feel this natural while keeping the underlying work reliable. Want to see a practical use case?');

  if(matches(normalized,[/what is nova/,/tell me about nova/,/who are you/,/introduce yourself/,/nova kya hai/])){
    return answer('identity','I’m Nova, a configurable AI customer-engagement platform. I combine friendly conversation with reliable workflows for bookings, service requests, product discovery, checkout, CRM updates, and customer support. Do you want the short business overview or a deeper technical explanation?');
  }
  if(matches(normalized,[/which (?:types? of )?business/,/what (?:types? of )?business/,/industr(?:y|ies)/,/businesses can use/,/who (?:is|are) nova for/,/use nova for my/])){
    return answer('industries','Nova can support cleaning and home services, retail and e-commerce, restaurants, clinics and healthcare, education, salons, repair teams, consultants, property services, and other appointment- or order-driven businesses. The shared engine stays the same; each business supplies its own services, products, rules, and brand. What type of business do you have?');
  }
  if(matches(normalized,[/whatsapp/,/web ?site/,/web chat/,/channel/,/instagram/,/facebook/,/api\b/,/where can nova work/])){
    return answer('channels','Nova can power website chat, HTTP API integrations, developer testing, and WhatsApp workflows. Its channel adapters keep the business logic reusable, so the same configured service or product rules can serve more than one customer channel. Which channel matters most to you?');
  }
  if(matches(normalized,[/safe|secure|security|privacy|protect .*data|customer data|data (?:separate|isolat)|tenant data|other business.*data/])){
    return answer('privacy','Nova is designed around tenant isolation: each business keeps separate configuration, customer records, carts, bookings, orders, and operational history. Public marketing chat does not read tenant customer data, and developer endpoints can be protected with an access token in production. Would you like to know more about customer memory or deployment security?');
  }
  if(matches(normalized,[/onboard|onboarding|set ?up|configure|add my business|start using|new tenant|without cod|no cod/])){
    return answer('onboarding','A business can be onboarded by providing its profile, branding, services or products, prices, policies, contact information, and required booking fields through the onboarding tools. Nova then uses the shared workflow engine—new tenant-specific code should not be necessary for normal business setup. Would you like to hear about service businesses or retail onboarding?');
  }
  if(!/language model/.test(normalized)&&matches(normalized,[/language|urdu|roman urdu|multilingual|speak english|zabaan/])){
    return answer('languages','Nova supports friendly English, Urdu, and Roman Urdu conversations, including common spelling variations and mixed-language customer messages. Business facts and workflow validation remain configuration-driven regardless of the customer’s language. Which language would your customers use most?');
  }
  if(matches(normalized,[/human (?:agent|support|handoff|take over)|real person|staff (?:member|take over)|escalat|talk to (?:a )?human/])){
    return answer('human_handoff','Yes. Nova can pause a workflow, keep the customer’s progress safe, and hand the conversation to a human when a request is sensitive, unsupported, or needs staff judgment. The exact handoff channel and operating rules are configured for the business. Which situations would you want your team to handle personally?');
  }
  if(matches(normalized,[/different from .*chatbot|versus .*chatbot|vs .*chatbot|basic chatbot|normal chatbot|why not .*chatbot/])){
    return answer('comparison','A basic chatbot often stops at answering text. Nova combines conversation with validated business actions: it can calculate configured prices, collect required fields, maintain carts, create bookings or requests, update CRM details, and safely amend or cancel transactions. Want an example from bookings or online retail?');
  }
  if(matches(normalized,[/customi[sz]|branding|brand color|brand name|white label|own assistant|personality|tone of voice/])){
    return answer('customization','Yes. Each business can configure its assistant name, branding, catalog or services, prices, policies, prompts, required fields, and business knowledge while reusing Nova’s central workflow capabilities. What part would you want customized first: brand voice, services, or customer flow?');
  }
  if(matches(normalized,[/without (?:a )?(?:language model|llm|ai api)|deterministic|how .*architecture|technical architecture|how does nova work|groq|model provider/])){
    return answer('architecture','Nova uses a deterministic workflow core for validation, pricing, state, tenant boundaries, carts, bookings, and writes. Optional language models can help interpret ambiguous language, but the core workflows can run without an external model provider. This keeps important business actions predictable and testable. Would you like to hear about tenant configuration or testing?');
  }
  if(matches(normalized,[/integrat|calendar|crm system|payment gateway|external system|connect to/])){
    return answer('integrations','Nova’s modular services can connect customer channels, CRM storage, calendars, inventory, payment workflows, knowledge sources, and external business APIs. Integrations are enabled deliberately per deployment; Nova does not pretend an external calendar or payment provider exists when it has not been configured. Which integration are you considering?');
  }
  if(matches(normalized,[/deploy|deployment|host|hosting|render|cloud|production|server/])){
    return answer('deployment','Nova is a Node.js service that can be hosted on platforms such as Render or another suitable cloud environment. Production setup should provide persistent storage, environment secrets, HTTPS, developer access protection, logging, and any required channel webhooks. Are you asking about a small demo deployment or a production business rollout?');
  }
  if(matches(normalized,[/analytics|report|metric|insight|performance|conversion|lead/])){
    return answer('analytics','Nova records structured activities, replay information, transactions, and customer workflow outcomes that can support operational reporting. A production deployment can connect those events to dashboards or analytics systems without exposing private customer data in the public demo. Which result would you want to measure—leads, bookings, orders, or support resolution?');
  }
  if(matches(normalized,[/what (?:can|do) you do|what can nova do|capabilit|features?|tasks?|use cases?|help (?:a |my )?business|kya kar sak/])){
    return answer('capabilities',[
      'Nova is a configurable AI customer-engagement platform for businesses. I can:',
      '• Answer questions about products, services, prices, policies, and availability',
      '• Guide bookings, service requests, shopping carts, checkout, and order changes',
      '• Reuse customer details safely and maintain tenant-scoped CRM history',
      '• Handle friendly English, Urdu, and Roman Urdu conversations',
      '• Support new businesses through configuration instead of custom workflow code',
      '',
      'Do you want to explore Nova as a booking agent, sales assistant, or customer-support agent?'
    ].join('\n'));
  }
  if(matches(normalized,[/why (?:were you|was nova) (?:made|built|created)/,/business problem/,/problems? (?:do|can) you solve/,/purpose/,/why nova/])){
    return answer('purpose','Nova was built to reduce missed leads, repetitive support work, slow booking and ordering, inconsistent answers, and manual customer follow-up. It gives every business a reusable assistant while keeping its services, products, prices, policies, and customer records separate. Which problem would you most like to automate?');
  }
  if(matches(normalized,[/booking|appointment|reservation|service request|reschedul|cancel.*booking/])){
    return answer('bookings','For booking-driven businesses, Nova can explain services and prices, collect scope, date, time, address, and contact details, reuse saved customer information, present a final review, and then create, change, or cancel the correct request. Would you like an example for cleaning, a restaurant, or a clinic?');
  }
  if(matches(normalized,[/ecommerce|e commerce|retail|shopping|catalog|cart|checkout|order|sell product/])){
    return answer('commerce','For retail, Nova can browse configured categories, explain product details, collect color, size, and quantity together, maintain an isolated active cart, reuse delivery information, confirm checkout, and support order changes. Would you like to see how product discovery or checkout works?');
  }
  if(matches(normalized,[/crm|remember customer|customer memory|saved details|customer profile|contact details/])){
    return answer('crm','Nova can maintain a tenant-scoped customer profile and safely reuse saved names, phone numbers, emails, and prior delivery or service details. Customers can review or change one field without re-entering everything else. Would customer memory be useful for repeat bookings or repeat purchases in your business?');
  }
  if(matches(normalized,[/price|pricing|cost|charge|subscription|plan/])){
    return answer('pricing','Nova’s public demo focuses on capabilities rather than a fixed pricing plan. Deployment needs can vary by channels, integrations, traffic, storage, and business workflows. Would you like to describe your business and expected customer volume?');
  }
  if(matches(normalized,[/demo|test nova|try nova|contact|talk to zeeshan|get started|next step|how can i use/])){
    return answer('get_started','You can explore my capabilities here, then use the developer console to test configured tenant workflows. For a real business rollout, the next step is to define the business type, customer channels, services or products, and the actions Nova should automate. What kind of business would you like to start with?');
  }
  if(matches(normalized,[/personal assistant|my assistant|booking agent|support agent|sales agent|for my business|use nova/])){
    return answer('fit','I can be configured as a business-facing assistant for bookings, sales, service requests, product discovery, checkout, and customer support. A business provides its catalog, services, rules, and contact information; Nova supplies the reusable conversation workflows. What kind of business would you like Nova to support?');
  }
  if(matches(normalized,[/book|buy|clean|appointment|product|service/])){
    return answer('tenant_boundary','This public chat is Nova’s marketing guide, so it does not place a real tenant booking or order. The Nova platform can power those workflows for an onboarded business, including pricing, customer details, changes, and confirmations. Would you like to learn how that would work for your business?');
  }
  return answer('fallback','I’m Nova, and this public chat is for friendly conversation and questions about customer-facing business automation. I can discuss capabilities, industries, channels, onboarding, security, integrations, deployment, pricing context, or practical workflows. Which area should we explore?');
}

function contextualFollowUp(previousTopic){
  const followUps={
    capabilities:()=>answer('industries','Great — Nova can be configured for cleaning and home services, retail, restaurants, clinics, education, salons, repairs, consultants, and many other booking- or order-driven businesses. Which type sounds closest to yours?'),
    creator:()=>answer('capabilities','Absolutely. Nova handles customer questions, booking and service-request flows, product discovery, carts and checkout, CRM detail reuse, transaction changes, and human handoff. Which capability would you like to explore first?'),
    onboarding:()=>answer('get_started','A practical starting point is to gather the business name, brand voice, contact information, products or services, prices, policies, and required customer fields. Nova’s onboarding tools turn that information into a working tenant. Is your business service-based or product-based?'),
    channels:()=>answer('integrations','Nova can keep the same central business rules across website chat, APIs, and configured messaging channels. The next design choice is which external systems—such as CRM, calendar, inventory, or payments—must be connected. Which one matters most?'),
    pricing:()=>answer('get_started','To scope a Nova rollout, I would start with your business type, expected conversation volume, channels, integrations, and the workflows you want automated. What kind of business are you planning for?')
  };
  return (followUps[previousTopic]||(()=>answer('capabilities','Sure — I can go deeper into Nova’s customer support, booking, commerce, CRM, security, onboarding, and integration capabilities. Which one interests you most?')))();
}

const SUGGESTIONS={
  greeting:['What can Nova do?','What problems does Nova solve?','Who made Nova?'],
  identity:['Show me Nova’s capabilities','Which businesses can use Nova?','How is Nova different from a chatbot?'],
  capabilities:['Which businesses can use Nova?','How does onboarding work?','Is customer data secure?'],
  industries:['How does Nova handle bookings?','How does Nova help retail?','Can Nova use my branding?'],
  purpose:['How is Nova different from a chatbot?','Can humans take over?','How do I get started?'],
  channels:['What integrations are supported?','Can Nova work on WhatsApp?','How is Nova deployed?'],
  privacy:['How does customer memory work?','Can a human take over?','How is Nova deployed securely?'],
  onboarding:['Can I customize Nova?','What integrations are supported?','How do I get started?'],
  architecture:['Can Nova support new businesses without code?','How do you protect customer data?','How is Nova tested?'],
  bookings:['How does Nova remember customers?','Can bookings be changed or cancelled?','Which businesses can use Nova?'],
  commerce:['How does checkout work?','How does Nova remember delivery details?','Can I customize the product catalog?'],
  creator:['What can Nova do?','Why was Nova made?','How do I get started?'],
  small_talk:['Tell me about Nova','What can you automate?','Who made you?'],
  default:['What can Nova do?','Which businesses can use Nova?','How do I get started?']
};

function answer(topic,reply){return {topic,reply,suggestions:SUGGESTIONS[topic]||SUGGESTIONS.default};}
function matches(text,patterns){return patterns.some(pattern=>pattern.test(text));}
function normalize(value){return String(value||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
function isShortAcceptance(value){return /^(?:yes|yes please|sure|okay|ok|please|tell me more|go ahead|bilkul|jee|ji)$/.test(value);}

function resolveLanguage(value,requested='auto'){
  if(requested==='english'||requested==='roman_urdu')return requested;
  const text=normalize(value);
  return /\b(?:aap|ap|main|mai|mein|mujhe|mujhy|mujhay|mera|meri|kya|kia|kaise|kese|kis ne|kon|kyun|kyu|hai|hain|ho|bata|batao|bataye|kar sak|karna|chahiye|samjhao|shukriya|salam|bhai|theek|bilkul|kaam|zabaan|banaya|bnaya)\b/.test(text)?'roman_urdu':'english';
}

const ROMAN_REPLIES=Object.freeze({
  empty:'Nova ke bare mein kuch bhi poochhein. Main apni capabilities, onboarding, security ya business problems ke bare mein bata sakti hoon.',
  creator:'Zeeshan ne mujhe businesses ki customer-related automation solve karne ke liye bohat pyar se banaya hai 😊 Kya aap dekhna chahenge ke main kaun se business tasks handle kar sakti hoon?',
  small_talk:'Main bilkul theek hoon, shukriya 😊 Aap sunayein? Kya aap mujhe personal assistant, booking agent, sales agent ya customer-support agent ke tor par explore kar rahe hain?',
  greeting:'Salam! 👋 Main Nova hoon—customer conversations aur business automation ke liye AI assistant. Aap pooch sakte hain main kya karti hoon, kyun banayi gayi, ya aapke business mein kaise help kar sakti hoon.',
  thanks:'Bohat shukriya 😊 Jab chahein bookings, sales, customer support ya automation ke bare mein poochhein. Ab kis cheez ko explore karna chahenge?',
  goodbye:'Allah hafiz 👋 Jab wapas aayein to kisi bhi customer workflow ya business problem ke bare mein poochh sakte hain.',
  compliment:'Bohat shukriya 😊 Mera maqsad natural conversation ke sath reliable business work karna hai. Kya aap koi practical use case dekhna chahenge?',
  identity:'Main Nova hoon—configurable AI customer-engagement platform. Main friendly conversation ko bookings, service requests, product discovery, checkout, CRM aur customer support ke reliable workflows ke sath jorti hoon. Short overview chahiye ya technical detail?',
  industries:'Nova cleaning, home services, retail, restaurants, clinics, education, salons, repairs, consultants, property services aur dusre booking/order businesses ko support kar sakti hai. Shared engine same rehta hai; har business apne products, services aur rules deta hai. Aapka business kis type ka hai?',
  channels:'Nova website chat, HTTP API, developer testing aur WhatsApp workflows par kaam kar sakti hai. Central business rules multiple channels par reuse hote hain. Aapke liye kaunsa channel sab se important hai?',
  privacy:'Nova tenant isolation use karti hai: har business ki configuration, customers, carts, bookings aur orders alag rehte hain. Public chat tenant customer data nahi parhti. Customer memory ya deployment security mein se kis bare mein jan-na chahenge?',
  onboarding:'Business apna naam, branding, products ya services, prices, policies, contact information aur required fields provide karta hai. Nova ka shared engine in details se working tenant banata hai—normal setup ke liye naya tenant code zaroori nahi. Aap service business onboard karna chahte hain ya retail?',
  languages:'Nova English, Urdu aur Roman Urdu mein friendly conversation support karti hai, common typos aur mixed-language messages samet. Aapke customers zyada kaunsi language use karte hain?',
  human_handoff:'Ji haan. Nova workflow ko safe rakh kar human team ko handoff kar sakti hai jab request sensitive, unsupported ya staff judgment wali ho. Aap kin situations mein human takeover chahenge?',
  comparison:'Basic chatbot aksar sirf text answer karta hai. Nova validated business actions bhi karti hai—configured price, required details, carts, bookings, CRM updates aur transaction changes. Booking ya retail example dekhna chahenge?',
  customization:'Ji haan. Har business assistant name, branding, services, products, prices, policies, prompts aur tone configure kar sakta hai. Aap pehle brand voice, services ya customer flow customize karna chahenge?',
  architecture:'Nova deterministic workflow core se validation, pricing, state, tenant boundaries, carts aur bookings control karti hai. Optional language model ambiguous wording samajhne mein help karta hai, lekin transaction authority core ke paas rehti hai. Tenant configuration ya testing ke bare mein poochhna chahenge?',
  integrations:'Nova CRM, calendar, inventory, payment workflows, knowledge sources aur business APIs ke sath integrate ho sakti hai. Jo integration configured na ho Nova uska jhoota claim nahi karti. Aapko kaunsi integration chahiye?',
  deployment:'Nova Node.js service hai jo Render ya dusre cloud environment par host ho sakti hai. Production mein persistent storage, secrets, HTTPS, access protection, logs aur webhooks configure karne chahiye. Demo deployment chahiye ya production rollout?',
  analytics:'Nova leads, conversations, activities, bookings, orders aur outcomes ka structured record bana sakti hai. In events ko dashboards se connect kiya ja sakta hai. Aap leads, bookings, orders ya support resolution mein se kya measure karna chahenge?',
  capabilities:'Nova business ke liye ye kaam kar sakti hai:\n• Products, services, prices, policies aur availability answer karna\n• Bookings, service requests, carts, checkout aur changes handle karna\n• Saved customer details aur tenant-scoped CRM reuse karna\n• English, Urdu aur Roman Urdu conversation\n• Configuration se naye businesses support karna\n\nAap booking agent, sales assistant ya customer-support agent explore karna chahenge?',
  purpose:'Nova missed leads, repetitive support, slow booking/order, inconsistent answers aur manual follow-up kam karne ke liye banayi gayi hai. Har business ka data aur business truth alag rehta hai. Aap sab se pehle kaunsi problem automate karna chahenge?',
  bookings:'Booking businesses ke liye Nova services aur prices explain karti hai, scope/date/time/address/contact leti hai, saved details reuse karti hai, final review dikhati hai aur phir correct request create, change ya cancel karti hai. Cleaning, restaurant ya clinic example chahiye?',
  commerce:'Retail ke liye Nova categories browse, product details, color/size/quantity, isolated cart, saved delivery profile, checkout confirmation aur order changes handle karti hai. Product discovery ya checkout ka example chahiye?',
  crm:'Nova har tenant ka customer profile alag rakh kar saved name, phone, email aur delivery/service details reuse kar sakti hai. Customer sirf aik field change kare to baqi details dobara nahi poochhi jatin. Repeat bookings ya purchases mein yeh useful hoga?',
  pricing:'Public demo fixed pricing plan show nahi karta, kyun ke cost channels, integrations, traffic, storage aur workflows par depend karti hai. Aap apna business aur expected customer volume batana chahenge?',
  get_started:'Yahan aap Nova ki capabilities explore kar sakte hain aur Developer Console mein configured tenant workflows test kar sakte hain. Real rollout ke liye business type, channels, services/products aur automate hone wale actions define karein. Aap kis business se start karna chahenge?',
  fit:'Main booking, sales, service requests, product discovery, checkout aur support ke liye business assistant ban sakti hoon. Business apna catalog, services aur rules deta hai; Nova reusable workflows deti hai. Aapka business kis type ka hai?',
  tenant_boundary:'Yeh public chat Nova ki product guide hai, is liye yahan real tenant booking ya order place nahi hota. Onboarded business mein Nova pricing, customer details, changes aur confirmation ke sath yeh workflows chala sakti hai. Kya aap iska business example samajhna chahenge?',
  fallback:'Main Nova hoon. Is public chat mein aap customer automation, capabilities, industries, onboarding, security, integrations, deployment, pricing ya practical workflows ke bare mein English ya Roman Urdu mein poochh sakte hain. Kis topic se start karein?'
});

const ROMAN_SUGGESTIONS=Object.freeze({
  greeting:['Nova kya kar sakti hai?','Nova kyun banayi gayi?','Nova ko kis ne banaya?'],
  identity:['Nova ki capabilities dikhao','Kon se businesses Nova use kar sakte hain?','Nova chatbot se kaise different hai?'],
  capabilities:['Kon se businesses use kar sakte hain?','Onboarding kaise hoti hai?','Customer data safe hai?'],
  industries:['Nova bookings kaise handle karti hai?','Retail mein kaise help karti hai?','Kya branding customize ho sakti hai?'],
  commerce:['Checkout kaise kaam karta hai?','Delivery details kaise yaad rehti hain?','Catalog customize ho sakta hai?'],
  bookings:['Customer details kaise yaad rehti hain?','Booking change ho sakti hai?','Kin businesses ke liye hai?'],
  default:['Nova kya kar sakti hai?','Kon se businesses use kar sakte hain?','Start kaise karein?']
});

module.exports={replyToNovaVisitor};
