/**
 * v44.0 — Per-Domain Vocabulary Dictionaries
 *
 * Comprehensive vocabulary for each tenant domain. Used by:
 *   - TenantAdapterRegistry domain-default adapters (enrichText, extractEntities)
 *   - Conversation adapters (commerce/booking/cleaning) for domain-aware matching
 *   - The variation test corpus (as a coverage reference)
 *
 * Structure per domain:
 *   {
 *     typos:        { 'chiken': 'chicken', ... },          // typo → correction
 *     abbreviations:{ 'pls': 'please', ... },              // abbreviation → expansion
 *     synonyms:     { 'biryani': ['briyani','biriyani'], ... }, // product/service aliases
 *     quantityUnits:{ plate: 1, serving: 1, ... },         // domain-specific unit nouns
 *     orderTypeVerbs: ['dine in','takeaway', ...],          // order-type declaration verbs
 *     specialInstructions: ['less spicy','extra cheese'],   // domain-specific modifiers
 *     domainTerms:  ['menu','dish','chef'],                 // domain-only nouns
 *     bookingTerms: ['reserve','table','appointment'],      // booking trigger words
 *     romanUrdu:    { 'chahiye': 'want', ... },             // Roman Urdu → English
 *   }
 */
module.exports = {

  // ═══════════════════════════════════════════════════════════════════════════
  // RESTAURANT
  // ═══════════════════════════════════════════════════════════════════════════
  restaurant: {
    typos: {
      chiken: 'chicken', chickn: 'chicken', checken: 'chicken',
      biriyani: 'biryani', briyani: 'biryani', biryani: 'biryani', biriani: 'biryani',
      burgers: 'burger', burgar: 'burger', burgr: 'burger',
      beaf: 'beef', beeff: 'beef',
      pastaa: 'pasta', pastta: 'pasta',
      grill: 'grilled', griled: 'grilled',
      resturant: 'restaurant', restaurent: 'restaurant', restorant: 'restaurant',
      ordar: 'order', ordr: 'order', oder: 'order',
      delievery: 'delivery', delivry: 'delivery',
      takeawy: 'takeaway', takaway: 'takeaway',
      speciy: 'spicy', spicey: 'spicy',
      cheeze: 'cheese', chess: 'cheese',
      onins: 'onions', onion: 'onions',
    },
    abbreviations: {
      pls: 'please', plz: 'please', pl: 'please',
      wnt: 'want', wht: 'what', somw: 'some',
      ord: 'order', qty: 'quantity',
      cod: 'cash on delivery', pk: 'pack',
      dinein: 'dine in', dineinn: 'dine in',
      takeaway: 'takeaway', tko: 'takeout',
    },
    synonyms: {
      biryani: ['briyani','biriyani','biriani','biryani'],
      burger: ['burgar','burgr','burgers'],
      pasta: ['pastaa','pastta','pastas'],
      chicken: ['chiken','chickn','checken'],
      beef: ['beaf','beeff'],
    },
    quantityUnits: {
      plate: 1, plates: 1, serving: 1, servings: 1,
      piece: 1, pieces: 1, portion: 1, portions: 1,
      bowl: 1, bowls: 1, cup: 1, cups: 1, glass: 1, glasses: 1,
    },
    orderTypeVerbs: [
      'dine in','dine-in','dine inn','eat here','sit in','for here',
      'takeaway','take away','take out','to go','parcel','pack it up','pack it',
      'delivery','home delivery','deliver it','for delivery',
    ],
    specialInstructions: [
      'less spicy','extra spicy','no spice','mild','medium spicy','extra hot',
      'extra cheese','extra sauce','no onions','no garlic','no cilantro','no coriander',
      'extra raita','no raita','extra salad','no salad','dry','gravy on side',
      'mirch kam','mirch zyada','pyaaz nahi','lehsan nahi','dhania nahi',
      'kam mirch','zyada mirch','zyada cheese',
    ],
    domainTerms: [
      'menu','dish','dishes','chef','kitchen','food','meal','order','plate','serving',
      'cuisine','flavor','spice','spicy','raita','salad','gravy','curry','kebab','naan','roti',
    ],
    bookingTerms: [
      'reserve','reservation','table','book a table','party','guests','seats','people',
    ],
    romanUrdu: {
      chahiye: 'want', chahiyy: 'want', chahy: 'want',
      lena: 'want', leni: 'want', lyni: 'want', lyn: 'want',
      bhej: 'send', bhejo: 'send', 'bhej do': 'send',
      karna: 'do', karo: 'do', kar: 'do',
      khana: 'food', khane: 'food',
      order: 'order',
      aur: 'and', bhi: 'also', ek: 'one', do: 'two', teen: 'three', char: 'four', paanch: 'five',
      mirch: 'spice', pyaaz: 'onion', lehsan: 'garlic', dhania: 'coriander',
      kam: 'less', zyada: 'more',
      garam: 'hot', thanda: 'cold',
      'dine in karna hai': 'want to dine in',
      'delivery chahiye': 'want delivery',
      'takeaway karo': 'make it takeaway',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SALON
  // ═══════════════════════════════════════════════════════════════════════════
  salon: {
    typos: {
      haircut: 'haircut', 'hair cut': 'haircut', haircutt: 'haircut',
      hairstyling: 'hair styling', hairstyle: 'hair styling', 'hair style': 'hair styling',
      beardgrooming: 'beard grooming', 'beard trim': 'beard trimming', beardtrim: 'beard trimming',
      facial: 'facial', facials: 'facial',
      haircolor: 'hair color', haircolour: 'hair color',
      'hair cut': 'haircut',
    },
    abbreviations: {
      'hair cut': 'haircut', 'hair style': 'hairstyle', 'hair trim': 'haircut',
      'beard trim': 'beard grooming', 'beard shape': 'beard grooming',
      'hair color': 'hair color', 'hair dye': 'hair color',
    },
    synonyms: {
      haircut: ['hair cut','haircutt','hair trim','hair trimming'],
      'hair styling': ['hairstyle','hair style','blow dry','blow-dry','blowdry','hair styling'],
      'beard grooming': ['beard trim','beard trimming','beard shape','beard shaping','beardgrooming'],
      facial: ['facials','face cleanup','face treatment'],
      'hair color': ['hair color','haircolour','hair dye','hair coloring','hair coloring'],
    },
    quantityUnits: {
      session: 1, sessions: 1, appointment: 1, appointments: 1, treatment: 1, treatments: 1,
    },
    orderTypeVerbs: [], // not applicable for salon
    specialInstructions: [
      'short hair','long hair','medium length','hair trim only',
      'beard shape','beard line up','beard fade','clean shave',
      'organic products','sulfate free','natural color',
      'lady stylist','female stylist','male stylist',
      'morning slot','evening slot','weekend slot',
    ],
    domainTerms: [
      'salon','treatment','service','stylist','barber','beautician','grooming','beauty',
      'haircut','hairstyle','facial','color','beard','trim','shave','blow dry','manicure','pedicure',
      'spa','massage','waxing','threading','makeup','highlights','lowlights','balayage',
    ],
    bookingTerms: [
      'book','appointment','reserve','schedule','slot','stylist','session',
    ],
    romanUrdu: {
      'haircut karna hai': 'want a haircut',
      'beard trim karna hai': 'want beard grooming',
      'appointment chahiye': 'want an appointment',
      'kal sham': 'tomorrow evening',
      '5 baje': 'at 5',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CLEANING
  // ═══════════════════════════════════════════════════════════════════════════
  cleaning: {
    typos: {
      cleanig: 'cleaning', clening: 'cleaning', clning: 'cleaning', cleening: 'cleaning',
      appartment: 'apartment', aparatment: 'apartment',
      vila: 'villa', vila: 'villa',
      'deep clean': 'deep cleaning', 'deepcleaning': 'deep cleaning',
      'standard clean': 'standard cleaning', 'standardcleaning': 'standard cleaning',
      'sofa clean': 'sofa cleaning', 'carpet clean': 'carpet cleaning',
      'office clean': 'office cleaning',
      'move in': 'move in', 'move out': 'move out', movein: 'move in', moveout: 'move out',
      bedrums: 'bedrooms', bedroms: 'bedrooms', bedroms: 'bedrooms',
      bathrums: 'bathrooms', bathroms: 'bathrooms',
      seater: 'seater',
    },
    abbreviations: {
      'bhk': 'bedroom hall kitchen',
      '1bhk': '1 bedroom', '2bhk': '2 bedroom', '3bhk': '3 bedroom', '4bhk': '4 bedroom', '5bhk': '5 bedroom',
      'sq ft': 'square feet', 'sqft': 'square feet',
    },
    synonyms: {
      'deep cleaning': ['deep clean','deep clean service','deep cleaning service'],
      'standard cleaning': ['standard clean','basic cleaning','regular cleaning'],
      'sofa cleaning': ['sofa clean','couch cleaning','sofa shampoo'],
      'carpet cleaning': ['carpet clean','carpet shampoo','rug cleaning'],
      'office cleaning': ['office clean','commercial cleaning','workspace cleaning'],
      'move in cleaning': ['move-in cleaning','movein cleaning','move in clean'],
      'move out cleaning': ['move-out cleaning','moveout cleaning','move out clean'],
    },
    quantityUnits: {
      bedroom: 1, bedrooms: 1, bath: 1, bathroom: 1, bathrooms: 1,
      floor: 1, floors: 1, room: 1, rooms: 1, shop: 1, shops: 1,
      workspace: 1, workspaces: 1, seater: 1, seat: 1,
    },
    orderTypeVerbs: [],
    specialInstructions: [
      'eco friendly','green products','non toxic','pet safe','child safe',
      'deep scrub','surface clean','window cleaning','kitchen deep clean','bathroom deep clean',
      'inside cabinets','inside fridge','inside oven','laundry','ironing',
      'bring own supplies','bring own vacuum','no chemicals',
    ],
    domainTerms: [
      'cleaning','clean','safai','safaiwala','maid','cleaner','janitor','housekeeping',
      'deep clean','standard clean','sofa','carpet','rug','couch','mattress','curtain',
      'villa','apartment','flat','studio','office','shop','workspace',
      'move in','move out','post construction','renovation',
      'bedroom','bathroom','kitchen','hall','dining','balcony','terrace','garage',
    ],
    bookingTerms: [
      'book','cleaner','maid','schedule','slot','appointment','service',
    ],
    romanUrdu: {
      safai: 'cleaning', 'safai karwani hai': 'want cleaning',
      'ghar ki safai': 'home cleaning', 'deep safai': 'deep cleaning',
      'safaiwala': 'cleaner', 'maasi': 'maid',
      'kal sham': 'tomorrow evening', '5 baje': 'at 5',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // RETAIL
  // ═══════════════════════════════════════════════════════════════════════════
  retail: {
    typos: {
      tshirt: 't-shirt', tshirts: 't-shirt', 't shirt': 't-shirt', 't-shirt': 't-shirt',
      earbuds: 'earbuds', earbud: 'earbuds', airbuds: 'earbuds', airbud: 'earbuds',
      bluetooth: 'bluetooth', bluetooh: 'bluetooth',
      smartwatch: 'smart watch', smartwch: 'smart watch',
      sunglases: 'sunglasses', sunglass: 'sunglasses',
      backpack: 'backpack', backpak: 'backpack', 'back pack': 'backpack',
      'power bank': 'power bank', powerbank: 'power bank',
      'water bottle': 'water bottle', waterbottle: 'water bottle',
    },
    abbreviations: {
      'xs': 'extra small', 's': 'small', 'm': 'medium', 'l': 'large', 'xl': 'extra large', 'xxl': 'double extra large',
      'pcs': 'pieces', 'pc': 'piece', 'qty': 'quantity',
      'pk': 'pack', 'box': 'box',
    },
    synonyms: {
      't-shirt': ['tshirt','tshirts','t shirt','tee','tees'],
      'earbuds': ['earbud','airbuds','airbud','ear phones','earphones','wireless earbuds'],
      'smart watch': ['smartwatch','smartwch','smartwatches'],
      'sunglasses': ['sunglass','sunglases','shades','sunnies'],
      'backpack': ['backpak','back pack','rucksack','school bag'],
      'power bank': ['powerbank','power banks','portable charger','battery pack'],
      'water bottle': ['waterbottle','bottle','flask'],
    },
    quantityUnits: {
      box: 1, boxes: 1, pack: 1, packs: 1, pair: 1, pairs: 1,
      set: 1, sets: 1, bundle: 1, bundles: 1, dozen: 12, dozens: 12,
      piece: 1, pieces: 1, pc: 1, pcs: 1, unit: 1, units: 1,
    },
    orderTypeVerbs: [
      'delivery','home delivery','pickup','in store','curbside pickup','ship to',
    ],
    specialInstructions: [
      'gift wrap','gift receipt','no receipt','separate packaging',
      'expedited shipping','express delivery','signature required','leave at door',
    ],
    domainTerms: [
      'product','item','stock','inventory','available','sale','discount','price','cost',
      'color','size','variant','sku','brand','model','collection','new arrival',
    ],
    bookingTerms: [],
    romanUrdu: {
      chahiye: 'want', lena: 'buy', leni: 'buy',
      'kya price': 'what is the price',
      'kitne ka': 'how much',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // HEALTHCARE
  // ═══════════════════════════════════════════════════════════════════════════
  healthcare: {
    typos: {
      'general consultation': 'general consultation', 'gen consult': 'general consultation',
      'dermatology': 'dermatology', 'dermatologist': 'dermatology',
      'physiotherapy': 'physiotherapy', 'physio': 'physiotherapy',
      'pediatrician': 'pediatrician', 'pediatric': 'pediatrician',
      'cardiologist': 'cardiologist', 'cardio': 'cardiologist',
      'appointment': 'appointment', 'apointment': 'appointment', 'appt': 'appointment',
    },
    abbreviations: {
      'appt': 'appointment', 'dr': 'doctor', 'doc': 'doctor',
      'gp': 'general practitioner', 'md': 'doctor',
      'er': 'emergency room', 'icu': 'intensive care',
    },
    synonyms: {
      'general consultation': ['general consult','gp visit','general checkup','general doctor'],
      'dermatology': ['dermatologist','skin doctor','skin specialist','skin consultation'],
      'physiotherapy': ['physio','physical therapy','physio session','physiotherapy session'],
      'pediatrician': ['pediatric','child doctor','kids doctor','child specialist'],
    },
    quantityUnits: {
      session: 1, sessions: 1, consultation: 1, consultations: 1, visit: 1, visits: 1,
    },
    orderTypeVerbs: [],
    specialInstructions: [
      'female doctor','male doctor','english speaking','urdu speaking',
      'first visit','follow up','telemedicine','video consultation','home visit',
    ],
    domainTerms: [
      'doctor','clinic','consultation','appointment','specialist','physician',
      'treatment','diagnosis','checkup','medical','health','patient',
      'cardiologist','dermatologist','pediatrician','gynecologist','orthopedic',
    ],
    bookingTerms: [
      'book','appointment','schedule','consultation','visit','doctor',
    ],
    romanUrdu: {
      'doctor ke paas': 'doctor consultation',
      'ilmaj': 'treatment',
      'muloqat': 'appointment',
      'kal sham': 'tomorrow evening',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // EDUCATION
  // ═══════════════════════════════════════════════════════════════════════════
  education: {
    typos: {
      admision: 'admission', addmission: 'admission',
      enrollment: 'enrollment', enrolment: 'enrollment',
      kindergarden: 'kindergarten', kinder: 'kindergarten',
      elementry: 'elementary', secndary: 'secondary',
    },
    abbreviations: {
      'kg': 'kindergarten', 'pre-k': 'pre kindergarten',
      'g1': 'grade 1', 'g2': 'grade 2', 'g3': 'grade 3', 'g4': 'grade 4', 'g5': 'grade 5',
      'tuition': 'tutoring', 'tutor': 'tutoring',
    },
    synonyms: {
      'admission': ['admissions','enrollment','enrolment','register','registration'],
      'kindergarten': ['kg','pre k','pre kindergarten','nursery'],
      'primary program': ['primary school','elementary','grades 1-5'],
      'secondary program': ['secondary school','high school','grades 6-10'],
      'tutoring': ['tuition','tutor','private tutor','home tutor','coaching'],
    },
    quantityUnits: {
      session: 1, sessions: 1, class: 1, classes: 1, lesson: 1, lessons: 1, semester: 1,
    },
    orderTypeVerbs: [],
    specialInstructions: [
      'morning batch','afternoon batch','evening batch','weekend batch',
      'online classes','in person','hybrid','home schooling',
    ],
    domainTerms: [
      'school','college','university','academy','institute','class','course','program',
      'grade','admission','enrollment','tuition','tutoring','coaching','curriculum','syllabus',
      'teacher','instructor','professor','student','kindergarten','primary','secondary',
    ],
    bookingTerms: [
      'enroll','admission','admit','register','join','inquire',
    ],
    romanUrdu: {
      'dakhla': 'admission',
      'admission chahiye': 'want admission',
      'classes karna hai': 'want to take classes',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DRIVING SCHOOL
  // ═══════════════════════════════════════════════════════════════════════════
  driving_school: {
    typos: {
      'driving lesson': 'driving lesson', 'driving lessons': 'driving lesson',
      'driving license': 'driving license', 'driving licence': 'driving license',
      'learners permit': 'learners permit', 'learners permit': 'learners permit',
    },
    abbreviations: {
      'dl': 'driving license', 'lp': 'learners permit',
      'pkg': 'package', 'pkgs': 'packages',
    },
    synonyms: {
      'beginner package': ['starter package','basic package','learn to drive'],
      'advanced package': ['advanced course','defensive driving','refresher course'],
      'driving lesson': ['driving lessons','lesson','practice session','driving session'],
      'driving license': ['driving licence','license','licence','dl'],
    },
    quantityUnits: {
      lesson: 1, lessons: 1, session: 1, sessions: 1, package: 1, packages: 1,
    },
    orderTypeVerbs: [],
    specialInstructions: [
      'female instructor','male instructor','english speaking',
      'manual transmission','automatic transmission','highway practice','parking practice',
    ],
    domainTerms: [
      'driving','school','lesson','instructor','package','license','licence','permit',
      'test','exam','road test','behind the wheel','theory','practical',
      'beginner','advanced','defensive','refresher','crash course',
    ],
    bookingTerms: [
      'book','enroll','schedule','lesson','package','instructor','session',
    ],
    romanUrdu: {
      'sawari': 'driving',
      'driving seekhni hai': 'want to learn driving',
      'license banana hai': 'want to make license',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // UNIVERSAL (fallback for unknown domains)
  // ═══════════════════════════════════════════════════════════════════════════
  universal: {
    typos: {
      pls: 'please', plz: 'please', wnt: 'want', wht: 'what',
      thru: 'through', tho: 'though', becuz: 'because', bcoz: 'because',
      u: 'you', ur: 'your', r: 'are', n: 'and',
    },
    abbreviations: {
      'ok': 'okay', 'thx': 'thanks', 'ty': 'thank you',
      'idk': "i don't know", 'btw': 'by the way',
    },
    synonyms: {},
    quantityUnits: {
      piece: 1, pieces: 1, unit: 1, units: 1, item: 1, items: 1,
    },
    orderTypeVerbs: [],
    specialInstructions: [],
    domainTerms: [],
    bookingTerms: ['book','schedule','reserve','appointment'],
    romanUrdu: {
      chahiye: 'want', lena: 'want', karna: 'do',
      aur: 'and', bhi: 'also',
      ek: 'one', do: 'two', teen: 'three',
      haan: 'yes', nahi: 'no', theek: 'okay',
    },
  },
};

/**
 * Get vocabulary for a domain, falling back to universal.
 */
function getDomainVocabulary(domain) {
  return module.exports[domain] || module.exports.universal;
}

/**
 * Apply typo + abbreviation + Roman Urdu corrections to a text string.
 * Used by the tenant adapter's enrichText() method.
 */
function enrichText(text, domain) {
  if (!text) return text;
  const vocab = getDomainVocabulary(domain);
  let result = String(text);
  // Apply typos (case-insensitive word boundary)
  for (const [typo, correct] of Object.entries(vocab.typos || {})) {
    if (typo === correct) continue; // skip self-maps
    const escaped = typo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), correct);
  }
  // Apply abbreviations
  for (const [abbr, expanded] of Object.entries(vocab.abbreviations || {})) {
    if (abbr === expanded) continue;
    const escaped = abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), expanded);
  }
  // v44.0: Apply Roman Urdu → English mappings for multi-word phrases first
  // (longest match), then single words. This lets "safai karwani hai" →
  // "i want cleaning" before "safai" → "cleaning".
  const romanEntries = Object.entries(vocab.romanUrdu || {})
    .sort((a, b) => b[0].length - a[0].length); // longest first
  for (const [roman, english] of romanEntries) {
    if (roman === english) continue;
    const escaped = roman.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), english);
  }
  return result;
}

/**
 * Check if a text contains any order-type verbs for the domain.
 */
function hasOrderTypeVerb(text, domain) {
  const vocab = getDomainVocabulary(domain);
  const lower = String(text || '').toLowerCase();
  return (vocab.orderTypeVerbs || []).some(verb => lower.includes(verb));
}

/**
 * Check if a text contains any special-instruction phrase for the domain.
 */
function hasSpecialInstruction(text, domain) {
  const vocab = getDomainVocabulary(domain);
  const lower = String(text || '').toLowerCase();
  return (vocab.specialInstructions || []).some(phrase => lower.includes(phrase));
}

module.exports.getDomainVocabulary = getDomainVocabulary;
module.exports.enrichText = enrichText;
module.exports.hasOrderTypeVerb = hasOrderTypeVerb;
module.exports.hasSpecialInstruction = hasSpecialInstruction;
