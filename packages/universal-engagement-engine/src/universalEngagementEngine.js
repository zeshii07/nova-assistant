const { normalizeText, numberFromText, normalizeWeekdayTypos, normalizeUrduDigits } = require('../../conversation-intelligence/src/text');
const {isConfirmation,isWorkflowAcceptance}=require('../../conversation-intelligence/src/confirmation');

class UniversalEngagementEngine {
  constructor({ now = () => process.env.NOVA_TEST_NOW ? new Date(process.env.NOVA_TEST_NOW) : new Date(), timezone = process.env.NOVA_DEFAULT_TIMEZONE || 'Asia/Karachi' } = {}) { this.now = now; this.timezone=timezone; }

  scope() {
    return Object.freeze({
      parseField: (field, raw, options) => this.parseField(field, raw, options),
      addItem: (state, item, options) => this.addItem(state, item, options),
      nextMissing: (requiredFields, fields) => this.nextMissing(requiredFields, fields),
      prompt: (field, config, language) => this.prompt(field, config, language),
      summary: (state, config) => this.summary(state, config),
      isReady: (requiredFields, fields) => !this.nextMissing(requiredFields, fields),
      normalizeState: (state, config) => this.normalizeState(state, config),
      validateDate: (value, options) => this.parseDate(value, options),
      validatePhone: (value, options) => this.parsePhone(value, options),
      parseDeclaredName: (value) => this.parseDeclaredName(value),
      validateFieldAnswer: (field, value, options) => this.validateFieldAnswer(field, value, options),
      isFieldRefusal: (value) => this.isFieldRefusal(value),
      referencesStoredField: (field, value) => this.referencesStoredField(field, value),
      referencesStoredDetails: (value) => this.referencesStoredDetails(value)
    });
  }

  normalizeState(state = {}, config = {}) {
    return {
      kind: state.kind || config.mode || config.kind || 'engagement',
      status: state.status || 'collecting',
      items: Array.isArray(state.items) ? structuredClone(state.items) : [],
      fields: { ...(state.fields || state.slots || {}) },
      pendingField: state.pendingField || null,
      metadata: { ...(state.metadata || {}) }
    };
  }

  addItem(state = {}, item, { quantity = 1, attributes = {}, replace = false } = {}) {
    const next = this.normalizeState(state);
    if (replace) next.items = [];
    const id = item.id || item.offeringId || item.productId || normalizeText(item.name || item.subject || 'item');
    const key = stableKey(id, attributes);
    const existing = next.items.find(x => x.key === key);
    if (existing) existing.quantity = Math.max(1, Number(existing.quantity || 1) + Number(quantity || 1));
    else next.items.push({
      key, id, name: item.name || item.subject || String(id), type: item.type || 'offering',
      quantity: Math.max(1, Number(quantity || 1)), price: item.price ?? null,
      attributes: { ...attributes }, metadata: { ...(item.metadata || {}) }
    });
    return next;
  }

  nextMissing(requiredFields = [], fields = {}) {
    return requiredFields.find(field => !hasValue(fields[field])) || null;
  }

  parseField(field, raw, options = {}) {
    const original = String(raw || '').trim();
    if (!original) return invalid(field, `Please provide ${pretty(field)}.`);
    if(field==='name'){
      const declared=this.parseDeclaredName(original);
      if(declared.valid)return declared;
    }
    const text=this.extractContextualFieldAnswer(field,original);
    const semantic=this.validateFieldAnswer(field,text,options);
    if(!semantic.valid) return semantic;
    if (field === 'name') return this.parseName(text, options);
    if (field === 'phone') return this.parsePhone(text, options);
    if (field === 'date') return this.parseDate(text, options);
    if (field === 'time') return this.parseTime(text, options);
    if (field === 'grade') return this.parseGrade(text);
    if (field === 'partySize' || field === 'quantity' || field === 'durationHours') return this.parsePositiveNumber(field, text, options);
    if (field === 'email') return this.parseEmail(text);
    if (field === 'paymentMethod') {
      const t=normalizeText(text); const methods=[['Cash on Delivery',/\b(cash on delivery|cash|cod)\b/],['JazzCash',/\bjazz\s*cash\b/],['EasyPaisa',/\beasy\s*paisa\b/],['Bank Transfer',/\bbank(?: transfer)?\b/]];
      const found=methods.find(([,pattern])=>pattern.test(t));
      return found ? valid(found[0]) : invalid(field,'Please choose a valid payment method: Cash on Delivery, JazzCash, EasyPaisa, or Bank Transfer.');
    }
    if (field === 'landmark' && /^(skip|none|n\/a|nahi|nahin)$/i.test(text)) return valid('');
    const min = Number(options.minLength ?? (field === 'address' ? 5 : 2));
    return text.length >= min ? valid(text) : invalid(field, `${pretty(field)} looks too short. Please provide a little more detail.`);
  }



  extractContextualFieldAnswer(field,raw){
    const text=String(raw||'').trim();
    if(field==='city'){
      const patterns=[
        /^(?:i\s+want\s+(?:it\s+)?in|deliver(?:\s+it)?\s+to|send(?:\s+it)?\s+to|city\s+(?:is|=)|delivery\s+(?:in|to))\s+([\p{L} .'-]{2,60})$/iu,
        /^(?:in|to)\s+([\p{L} .'-]{2,60})$/iu
      ];
      for(const r of patterns){const m=text.match(r);if(m)return m[1].trim();}
    }
    if(field==='address'){
      const patterns=[
        /^(?:(?:my\s+|delivery\s+)?address\s+(?:is|=)|deliver(?:\s+it)?\s+to|send(?:\s+it)?\s+to)\s+(.{5,180})$/iu
      ];
      for(const r of patterns){const m=text.match(r);if(m)return m[1].trim();}
    }
    if(field==='phone'){
      const m=text.match(/^(?:(?:my\s+)?(?:phone|mobile|contact|number)(?:\s+number)?\s*(?:is|=|:)?|use|it\s+is)\s*(\+?[\d ()-]{8,25})$/iu);
      if(m)return m[1].trim();
    }
    if(field==='email'){
      const m=text.match(/^(?:(?:my\s+)?email(?:\s+address)?\s*(?:is|=|:)?|use)\s*([^\s]+@[^\s]+)$/iu);
      if(m)return m[1].trim();
    }
    if(field==='landmark'){
      const m=text.match(/^(?:near|nearby|landmark\s+(?:is|=))\s+(.{2,100})$/iu);
      if(m)return m[1].trim();
    }
    return text;
  }

  isFieldRefusal(raw){
    const text=normalizeText(raw);
    return /^(?:no|no thanks|skip|prefer not(?: to)?|rather not(?: to)?|i (?:do not|don t|dont) want to (?:share|give|provide)(?: it| that| this| my details?)?(?: with you)?|i won t share(?: it)?|not sharing(?: it)?|nahi|nahin|rehne dein)$/i.test(text);
  }

  referencesStoredField(field,raw){
    const text=normalizeText(raw);
    const labels={name:'name',phone:'(?:phone|number|contact)',address:'address',date:'date',time:'time'};
    const label=labels[field]||String(field||'');
    const normalized=text.replace(/previuos|privious|pervious/g,'previous');
    // Short answers are safe here because callers only invoke this method
    // while a prompt has explicitly offered a saved value for one field.
    if(/^(?:yes\s+)?(?:use|use it|use this|use that|use previous|use old|same|same one|keep it)$/i.test(normalized))return true;
    return new RegExp(`\\b(?:i (?:already )?(?:told|gave|shared) you (?:my )?${label}|you (?:already )?(?:have|know) (?:my )?${label}|use (?:my )?(?:previous|earlier|old|same|saved|existing|current|configured) ${label}|use (?:the )?(?:existing|current|configured|saved) ${label}|same ${label} as before|previous ${label}|no new ${label}[\\s\\S]{0,24}(?:old|previous|saved) ${label})\\b`,'i').test(normalized);
  }

  referencesStoredDetails(raw){
    const text=normalizeText(raw).replace(/previuos|privious|pervious/g,'previous');
    return /^(?:yes\s+)?use(?:\s+my|\s+the)?\s+(?:(?:previous|old|saved|existing|current|configured)(?:\s+(?:contact|customer|delivery|profile))?\s+)?(?:details|information|info|name and details)$|^(?:yes\s+)?(?:use|keep)\s+(?:all\s+)?(?:the\s+)?other\s+(?:provided\s+)?details$|^(?:yes\s+)?use\s+(?:my\s+)?configured\s+name\s+and\s+details$|^(?:meri|meray|mere)\s+(?:purani|pehli|saved)\s+(?:details|maloomat|information)\s+(?:use|rakh|laga)\s*(?:karo|kar dein)?$|^(?:purani|pehli)\s+(?:details|maloomat)\s+(?:theek|same|use)|^(?:میری|میرے)\s+(?:پرانی|محفوظ)\s+(?:تفصیلات|معلومات)\s+(?:استعمال|رکھ)/i.test(text);
  }

  validateFieldAnswer(field, raw, options = {}) {
    const text=String(raw||'').trim();
    const n=normalizeText(text);
    // Approval/continuation language belongs to the active workflow. It must
    // never become a customer's name, address, city, phone, or email even if a
    // routing adapter fails to claim the turn first.
    if(['name','address','city','landmark','phone','email'].includes(field)&&(isConfirmation(text)||isWorkflowAcceptance(text)))
      return invalid(field,`That looks like a workflow confirmation, not your ${pretty(field).toLowerCase()}.`);
    // A pending customer-detail field must never consume a new question,
    // catalog/service request, cancellation, confirmation, or unrelated command.
    const questionOrAction =
      /[?؟]\s*$/.test(text)
      || /^(?:what|which|where|when|why|how|who|do you|does|can i|can you|could you|is there|are there|show|list|tell me|i want|i need|add|remove|cancel|confirm|track|book|order|buy|purchase|mujhy|mujhe|mujhay|main|mai)\b/i.test(text)
      || /\b(?:do you have|do you sell|do you offer|what products|what services|show my cart|track my order|cancel my|confirm my|add .* (?:order|cart)|chahiye|chahiyy|chahy|chaheye|karwani|karwana|krani|lyni|leni|lyna|lena|khareedna|kharidna|bhi chahi)\b|^(?:کیا|کون|کہاں|کب|کیسے|کیوں|مجھے|میں)|(?:چاہیے|خریدنا|بکنگ|منسوخ|دکھائیں)/i.test(text);
    if(['name','address','city','landmark','phone','email'].includes(field) && questionOrAction)
      return invalid(field, `That looks like a separate question or request, not your ${pretty(field).toLowerCase()}. I’ll keep this request paused. ${this.prompt(field,{},'english')}`);

    if(field==='city'){
      if(!/^[\p{L} .'-]{2,60}$/u.test(text) || text.split(/\s+/).length>5)
        return invalid(field,'Please enter the city name only, for example “Lahore”.');
    }
    if(field==='address'){
      if(text.length<5 || text.length>180)
        return invalid(field,'Please enter a valid full address, for example “House 12, Model Town, Lahore”.');
      if(/^(?:hello|thanks|thank you|yes|no|ok|okay|skip)$/i.test(text))
        return invalid(field,'That does not look like a delivery/service address. Please provide the full address.');
      const addressEvidence=/\d|\b(?:house|home|apartment|apt|flat|villa|office|shop|unit|room|floor|building|tower|plaza|plot|block|sector|phase|street|road|rd|lane|avenue|ave|boulevard|market|bazar|bazaar|mall|town|village|circle|society|colony|near|opposite|behind|beside|dha|jvc|lahore|karachi|islamabad|rawalpindi|dubai|sharjah|abu dhabi|uae|pakistan)\b/i.test(text);
      const addressParts=text.split(/\s+/).filter(Boolean);
      const alphabeticParts=(text.match(/[\p{L}][\p{L}'-]*/gu)||[]).filter((part)=>part.length>=2);
      const locationOnly=addressParts.length<2&&!/\d|\b(?:house|apartment|apt|flat|villa|office|shop|unit|building|tower|plaza|plot)\b/i.test(text);
      if(!addressEvidence||locationOnly||alphabeticParts.length<2)
        return invalid(field,'That does not look like a complete delivery/service address. Include a house, apartment, building, street, area, or nearby location.');
    }
    if(field==='landmark' && !/^(skip|none|n\/a|nahi|nahin)$/i.test(text)){
      if(text.length<2 || text.length>100)
        return invalid(field,'Please provide a short nearby landmark, or say “skip”.');
    }
    return {valid:true,value:text};
  }

  parseDeclaredName(raw) {
    const value=String(raw||'').trim();
    // Questions such as "mera name kia hai?" ask for profile recall; they are
    // not declarations of a person named "Kia" or "Kya".
    if(/\b(?:mera|meri)\s+(?:name|naam|nme)\s+(?:kia|kya)\s+(?:hai|hn|hoon|hun)?\b[?!.]*$/iu.test(value))
      return {valid:false,field:'name',message:'This is a name lookup question, not a name declaration.'};
    const patterns=[
      /\b(?:my name is|my nme is|my naam is|my name's|call me|mera name|mera naam)\s+([\p{L}][\p{L} .'-]{0,60}?)(?=\s+(?:hai|hn|hoon|hun|what is|what's|who are|can i|could i|i want|i need|i would|do you|please|and can|and i|and (?:my )?(?:email|phone|mobile|contact|number|address)|but|because)\b|[?!,;]|$)/iu,
      /\bmain\s+([\p{L}][\p{L} .'-]{0,50}?)\s+(?:hn|hoon|hun)\b/iu
    ];
    for(const pattern of patterns){
      const m=value.match(pattern);
      if(m){
        const parsed=this.parseName(m[1].trim());
        if(parsed.valid) return parsed;
      }
    }
    return {valid:false,field:'name',message:'No explicit name declaration found.'};
  }
  parseName(raw) {
    let value = String(raw).trim();
    const embedded = value.match(/\b(?:use|save|take)\s+(?:my\s+)?name(?:\s+as)?\s+([\p{L}][\p{L} .'-]{1,60})$/iu)
      || value.match(/^\s*use\s+([\p{L}][\p{L} .'-]{1,60})$/iu)
      || value.match(/\bmy\s+(?:name|nme|naam)\s+(?:is|=)\s+([\p{L}][\p{L} .'-]{1,60})$/iu)
      || value.match(/\bmera\s+(?:name|naam|nme)\s+(?:is\s+)?([\p{L}][\p{L} .'-]{1,60}?)(?:\s+(?:hai|hn|hoon|hun))?$/iu);
    if (embedded) value = embedded[1].trim();
    // Short acknowledgements often wrap the actual field answer. Remove only
    // a leading acknowledgement when a plausible name still follows it.
    value=value.replace(/^(?:ok(?:ay)?|yes|yeah|yep|sure|k)\s+([\p{L}][\p{L} .'-]{1,60})$/iu,'$1').trim();
    const forbidden = /\b(order|product|service|appointment|phone|address|price|thanks|hello|cancel|confirm|track|book|buy|add|remove|shoes?|shirt|rice|oil|milk|facial|haircut|information|question|payment|delivery|clean|cleaning|today|tomorrow|date|time|email|want|need|like|doing|available|told you|already have|already know)\b/i;
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length >= 1 && words.length <= 5 && value.length >= 2 && value.length <= 70 && /^[\p{L} .'-]+$/u.test(value) && !forbidden.test(value) && !/^(?:i|we|you|he|she|they|this|that|it)\b/i.test(value)) return valid(titleCase(value));
    return invalid('name', 'Please send the name only, for example “Zeeshan Ahmad”. If you want to ask something else, you can do that too and I’ll keep this request paused.');
  }

  parsePhone(raw, options = {}) {
    const source=String(raw).trim();
    if(/[\p{L}]/u.test(source))return invalid('phone','Please send only the contact number, for example 03012345678 or +923012345678.');
    const numberGroups=source.match(/\+?\d[\d ()-]*\d/g)||[];
    if(numberGroups.length!==1)return invalid('phone','Please enter one valid contact number, for example 03012345678 or +923012345678.');
    const normalized = numberGroups[0].replace(/[^\d+]/g, '');
    const digits = normalized.replace(/\D/g, '');
    const min = Number(options.minDigits || 10), max = Number(options.maxDigits || 15);
    if (digits.length < min || digits.length > max) return invalid('phone', `That phone number is not valid. Please enter a valid contact number with ${min}-${max} digits, for example 03012345678 or +923012345678.`);
    return valid(normalized);
  }

  parseEmail(raw){
    const value=String(raw||'').trim().replace(/[.,;]+$/,'').toLowerCase();
    const validShape=/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(value);
    return validShape&&value.length<=254?valid(value):invalid('email','That email address does not look valid. Please enter an address such as name@example.com.');
  }

  parseDate(raw, options = {}) {
    const text = normalizeWeekdayTypos(raw);
    const today = calendarDay(options.now ? new Date(options.now) : this.now(),options.timezone||this.timezone);
    let date = null, display = null;

    // An explicit calendar date is more specific than a weekday mentioned in
    // the same sentence ("Friday, 21 August"). Parse it first.
    let m = String(raw).match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{4}))?\b/);
    if (m) {
      const day = +m[1], month = +m[2], year = m[3] ? +m[3] : inferYear(today, month, day);
      date = makeDate(year, month, day);
    }
    if (!date) {
      m = String(raw).match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
      if (m) date = makeDate(+m[1], +m[2], +m[3]);
    }
    if (!date) {
      const monthPattern = MONTHS.join('|');
      m = String(raw).match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})(?:\\s+(\\d{4}))?\\b`, 'i'));
      if (m) {
        const month = MONTHS.indexOf(m[2].toLowerCase()) + 1, day = +m[1], year = m[3] ? +m[3] : inferYear(today, month, day);
        date = makeDate(year, month, day);
      }
      if(!date){
        m=String(raw).match(new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,'i'));
        if(m){
          const month=MONTHS.indexOf(m[1].toLowerCase())+1,day=+m[2],year=m[3]?+m[3]:inferYear(today,month,day);
          date=makeDate(year,month,day);
        }
      }
    }
    if (!date) {
      if (/\b(day after tomorrow|parson|parso)\b|پرسوں/.test(text)) date = addDays(today, 2);
      else if (/\b(tomorrow|kal|agl[aeiy]+ din)\b|کل|اگلے دن/.test(text)) date = addDays(today, 1);
      else if (/\b(today|aaj|aj)\b|آج/.test(text)) date = today;
      else {
        const weekday=WEEKDAYS.find(x=>new RegExp(`\\b${x}\\b`).test(text));
        if(weekday) date=nextWeekday(today,WEEKDAYS.indexOf(weekday));
      }
    }
    if (!date) return invalid('date', 'Please enter a date such as 24/02/2027, 2027-02-24, “24 May”, or “tomorrow”.');
    if (options.allowPast !== true && date < today) return invalid('date', `That date is in the past. Please choose ${formatDate(today)} or a future date.`);
    display = formatDate(date);
    return { valid: true, value: display, date };
  }

  parseTime(raw) {
    // Preserve ':' for 24-hour clocks while still accepting Urdu/Arabic digits.
    const value = normalizeUrduDigits(String(raw)).trim().toLowerCase();
    const window='(?:subah|subha|sabah|savere|sawere|savera|fajr|morning|shaam|sham|evening|dopahar|dopehar|dupehar|afternoon|raat|rat|night|صبح|سویرے|شام|دوپہر|رات)';
    let roman=value.match(new RegExp(`(?:^|\\s)(${window})\\s+(\\d{1,2})(?:(?::|\\s)(\\d{2}))?\\s*(?:bjy|baje|bajay|bajy|بجے)?(?:$|\\s)`,'iu'));
    if(roman){
      const hour=Number(roman[2]),min=Number(roman[3]||0);
      if(hour>=1&&hour<=12&&min<=59){
        const marker=/^(?:shaam|sham|evening|dopahar|dopehar|dupehar|afternoon|raat|rat|night|شام|دوپہر|رات)$/iu.test(roman[1])?'pm':'am';
        return valid(`${hour}${roman[3]?':'+String(min).padStart(2,'0'):''} ${marker}`);
      }
    }
    roman=value.match(new RegExp(`(?:^|\\s)(\\d{1,2})(?:(?::|\\s)(\\d{2}))?\\s*(?:bjy|baje|bajay|bajy|بجے)?\\s+(${window})(?:$|\\s)`,'iu'));
    if(roman){
      const hour=Number(roman[1]),min=Number(roman[2]||0);
      if(hour>=1&&hour<=12&&min<=59){
        const marker=/^(?:shaam|sham|evening|dopahar|dopehar|dupehar|afternoon|raat|rat|night|شام|دوپہر|رات)$/iu.test(roman[3])?'pm':'am';
        return valid(`${hour}${roman[2]?':'+String(min).padStart(2,'0'):''} ${marker}`);
      }
    }
    let m = value.match(/\b(\d{1,2})(?:(?::|\s)(\d{2}))?\s*(am|pm)\b/);
    if (m) {
      const hour = +m[1], min = +(m[2] || 0);
      if (hour >= 1 && hour <= 12 && min <= 59) return valid(`${hour}${m[2] ? ':' + String(min).padStart(2, '0') : ''} ${m[3]}`);
    }
    m = value.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (m) return valid(`${String(+m[1]).padStart(2, '0')}:${m[2]}`);
    return invalid('time', 'Please enter a valid time, for example 9:00 PM or 21:00.');
  }

  parseGrade(raw) {
    const m = normalizeText(raw).match(/\b(?:grade|class)?\s*(\d{1,2})(?:st|nd|rd|th)?\b|\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:grade|class)\b/);
    const value = m ? +(m[1] || m[2]) : null;
    return value && value <= 20 ? valid(String(value)) : invalid('grade', 'Please enter the grade, for example 8, Grade 8, or 8th grade.');
  }

  parsePositiveNumber(field, raw, options = {}) {
    const n = numberFromText(raw);
    const min = Number(options.min ?? 1), max = Number(options.max ?? 999);
    return Number.isFinite(n) && n >= min && n <= max ? valid(n) : invalid(field, `Please enter a valid ${pretty(field)} between ${min} and ${max}.`);
  }

  prompt(field, config = {}, language = 'english') {
    const common = {
      name:'May I have your full name?', phone:'What is the best contact phone number to reach you on?',
      email:'You may also provide an email address, or skip this optional field.',
      date:'What date would you prefer?', time:'What time would you prefer?',
      address:'What address should I use?', city:'Which city?', grade:'Which grade/class?',
      partySize:'How many people?', quantity:'How many would you like?'
    };
    const base=config.prompts?.[field] || common[field] || `Please provide ${pretty(field)}.`;
    const hints={
      date:'Please enter a date, for example 24/02/2027, “24 May”, or “tomorrow”.',
      time:'Please enter a time, for example 9:00 PM or 21:00.',
      phone:'Please enter a valid contact number with 10-15 digits.',
      email:'For example: name@example.com.',
      grade:'For example: 8, Grade 8, or 8th grade.'
    };
    return hints[field] ? `${base}\n${hints[field]}` : base;
  }

  summary(state = {}, config = {}) {
    const s = this.normalizeState(state, config);
    const lines = [];
    if (s.items.length) {
      lines.push(config.itemsLabel || 'Selections:');
      for (const item of s.items) {
        const attrs = Object.values(item.attributes || {}).filter(Boolean);
        lines.push(`• ${item.name}${attrs.length ? ` (${attrs.join(', ')})` : ''}${item.quantity > 1 ? ` × ${item.quantity}` : ''}`);
      }
    }
    for (const [field, value] of Object.entries(s.fields)) if (hasValue(value)) lines.push(`${config.labels?.[field] || pretty(field)}: ${value}`);
    return lines.join('\n');
  }
}

const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
const WEEKDAYS=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
function valid(value){ return {valid:true,value}; }
function invalid(field, message){ return {valid:false,field,message}; }
function hasValue(v){ return v !== null && v !== undefined && v !== ''; }
function pretty(s){ return String(s).replace(/([A-Z])/g,' $1').replace(/^./,x=>x.toUpperCase()); }
function titleCase(v){ return String(v).replace(/\b\p{L}/gu,c=>c.toUpperCase()); }
function stableKey(id,attrs){ return `${id}:${Object.entries(attrs||{}).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('|')}`; }
function startOfDay(d){ return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())); }
function calendarDay(value,timezone){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);
  const fields=Object.fromEntries(parts.filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));
  return new Date(Date.UTC(fields.year,fields.month-1,fields.day));
}
function addDays(d,n){ const x=new Date(d); x.setUTCDate(x.getUTCDate()+n); return x; }
function nextWeekday(today,target){ const diff=(target-today.getUTCDay()+7)%7 || 7; return addDays(today,diff); }
function inferYear(today,month,day){ const current=today.getFullYear(); const candidate=makeDate(current,month,day); return candidate && candidate>=today ? current : current+1; }
function makeDate(y,m,d){ if(y<2000||m<1||m>12||d<1||d>31)return null; const x=new Date(Date.UTC(y,m-1,d)); return x.getUTCFullYear()===y&&x.getUTCMonth()===m-1&&x.getUTCDate()===d?startOfDay(x):null; }
function formatDate(d){ return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`; }

module.exports={UniversalEngagementEngine};
