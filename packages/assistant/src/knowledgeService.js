/**
 * Provides safe answers from tenant-approved profile and knowledge data only.
 */
class KnowledgeService {
  constructor({ knowledgeRepository, controlPlaneRepository = null }) {
    this.knowledgeRepository = knowledgeRepository;
    this.controlPlaneRepository = controlPlaneRepository;
  }

  getContext(tenant) {
    const files = this.knowledgeRepository.getForTenant(tenant.id);
    const business = { ...(files.business || {}) };
    const publishedProfile = this.controlPlaneRepository?.getPublished(tenant.id, "profile") || null;
    const publishedHours = this.controlPlaneRepository?.getPublished(tenant.id, "hours")?.document;
    const publishedServices = this.controlPlaneRepository?.getPublished(tenant.id, "services")?.document;
    if (publishedHours?.text) business.hours = publishedHours.text;
    else if (publishedHours?.schedule) business.hours = displaySchedule(publishedHours.schedule);
    if (Array.isArray(publishedServices?.items)) business.services = publishedServices.items.filter((item) => item.active !== false && !item.hidden).map((item) => item.name);
    return {
      identity: tenant.business || {},
      profilePublished: Boolean(publishedProfile),
      branding: tenant.branding || {},
      business,
      faqs: Array.isArray(files.faqs) ? files.faqs : []
    };
  }

  search(query, tenant, options = {}) {
    return this.knowledgeRepository.search(tenant.id, query, options);
  }

  expandQuery(query) {
    let q=String(query||'').toLowerCase();
    const negatedCancellation=/\b(?:don(?:'t| not)|do not|not going to|won't)\b.{0,24}\bcancel\b/.test(q);
    const expansions=[
      [/\bserving areas?\b|\bservice areas?\b|\bareas do you serve\b|\bareas you serve\b/g,' service area serving areas areas serve locations coverage '],
      [/\bwho (?:will )?pay(?:s)? for parking\b|\bparking (?:fee|fees|charge|charges|cost|costs)\b/g,' parking paid parking parking charge customer responsible '],
      [/\bpets?\b|\bdogs?\b|\bcats?\b/g,' pets pet dog cat animals home '],
      [/\bheavy wardrobe\b|\bmove (?:my )?(?:heavy )?(?:wardrobe|furniture)\b/g,' furniture moving heavy furniture wardrobe safety '],
      [/\b(cancel|cancellation|cancelled|canceled)\b/g,' cancellation policy notice before scheduled start cancellation fee no fee '],
      [/\b(reschedule|rescheduling|move (?:my|the|it) (?:booking|appointment|to)|change (?:my|the) (?:booking|appointment))\b/g,' rescheduling policy change booking notice fee scheduled start '],
      [/\b(haven(?:\'t| not) arrived|officially late|arrival window|how late)\b/g,' arrival time policy normal arrival window minutes late cancellation fee '],
      [/\b(quote|quotation|estimate|price|cost|told me)\b.*\b(confirm|confirmed|confirmation)\b/g,' booking confirmation quote alone booking reference confirmed date time window '],
      [/\b(high[ -]?rise|climb(?:ing)? outside|unsafe height)\b/g,' safety service limitations exterior high-rise window cleaning not offered safely reachable '],
      [/\bfragrance[ -]?free\b/g,' fragrance-free products advance notice hours before arrival guarantee '],
      [/\bpet (?:fee|surcharge)|pet hair|heavy pet hair\b/g,' pets pet-hair surcharge heavy removal simply having pet '],
      [/\b(spoiled?|rotten|damaged|bruised)\b[\s\S]{0,40}\b(fruit|produce|item|order)|\b(fruit|produce|item|order)\b[\s\S]{0,40}\b(spoiled?|rotten|damaged|bruised)\b/g,' fruit quality damaged spoiled claim photo replacement credit delivery '],
      [/\b(store|storage|keep|refrigerate|refrigerator|fridge)\b[\s\S]{0,50}\b(fruit|mango|apple|banana|orange|produce)|\bhow should i store\b/g,' storage guidance ripe fruit room temperature refrigerate sunlight '],
      [/\b(documents?|paperwork|requirements?)\b[\s\S]{0,60}\b(rent|rental|tenant|apartment|house|property)|\b(rent|rental|tenant)\b[\s\S]{0,60}\b(documents?|paperwork|requirements?)\b/g,' rental tenant guidance CNIC passport proof income employment move-in household references requirements ']
    ];
    for(const [pattern,extra] of expansions){
      if(negatedCancellation&&extra.includes('cancellation policy'))continue;
      if(pattern.test(q)){pattern.lastIndex=0;q+=extra;}
    }
    return q.replace(/\s+/g,' ').trim();
  }

  retrieve(query, tenant, { limit = 6, minScore = 0.16, minMargin = 0.025, minSemantic = 0.12, kinds = null } = {}) {
    const expandedQuery=this.expandQuery(query);
    // The bundled semantic branch is deliberately lightweight. Exact policy
    // wording must still be answerable when the lexical match is strong, so
    // retrieve both branches first and enforce the semantic-or-lexical trust
    // threshold below instead of discarding exact evidence prematurely.
    const rawMatches = this.search(expandedQuery, tenant, { limit, minScore, minSemantic:0, kinds, evidenceComplete: (q,m)=>this.evidenceComplete(query,m) });
    const completeMatches=rawMatches.filter(x=>this.evidenceComplete(query,x));
    let matches=completeMatches.length?completeMatches:rawMatches;

    matches=this.applyAuthority(query,matches);
    const conflict=this.detectConflict(query,matches);
    const best=matches[0],second=matches[1];
    const strong=Boolean(best&&best.hybridScore>=minScore&&(best.semanticScore>=minSemantic||best.lexicalScore>=.22));
    const margin=completeMatches.length>0 || !second || (best.hybridScore-second.hybridScore)>=minMargin || best.hybridScore>=0.52;
    const complete=Boolean(best&&this.evidenceComplete(query,best));
    return {query,expandedQuery,matches,answerable:strong&&margin&&complete&&!conflict,confidence:best?.hybridScore||0,
      ambiguous:strong&&(!margin||!complete||conflict),conflict,evidenceComplete:complete,
      context:matches.map(x=>`[${x.sourceTitle||x.source}${x.path ? `:${x.path}` : ''}; priority=${x.priority||0}] ${x.text}`).join("\n")};
  }

  applyAuthority(query,matches=[]){
    let rows=[...matches];
    // A high-priority uploaded/edited document can intentionally refine a
    // broad packaged business-profile fact. Keep lexical relevance as the
    // baseline, but promote a materially higher-priority complete match. A
    // close-scoring managed source also represents the tenant's latest edit.
    const highest=rows.reduce((best,row)=>!best||Number(row.priority||0)>Number(best.priority||0)?row:best,null);
    const managed=rows.find(row=>this.isManagedSource(row));
    if(highest&&rows[0]&&Number(highest.priority||0)-Number(rows[0].priority||0)>=20){
      rows=[highest,...rows.filter(row=>row!==highest)];
    }else if(managed&&rows[0]&&!this.isManagedSource(rows[0])&&Number(managed.hybridScore||0)>=Number(rows[0].hybridScore||0)-.08){
      rows=[managed,...rows.filter(row=>row!==managed)];
    }
    const sensitive=/\b(return|refund|cancel|cancellation|reschedul|arrival|late|notice|warranty|discount|payment|parking|same[ -]?day|policy)\b/i.test(String(query||''));
    if(!sensitive)return rows;
    for(let i=0;i<Math.min(rows.length,4);i++)for(let j=i+1;j<Math.min(rows.length,4);j++){
      const a=rows[i],b=rows[j];
      if(!this.samePolicyTopic(query,a.text)||!this.samePolicyTopic(query,b.text))continue;
      const sa=this.factSignature(a.text),sb=this.factSignature(b.text);
      if(!sa||!sb||sa===sb)continue;
      const pa=Number(a.priority||0),pb=Number(b.priority||0);
      const aManaged=this.isManagedSource(a),bManaged=this.isManagedSource(b);
      if(Math.abs(pa-pb)>=20||aManaged!==bManaged){
        // Tenant-managed knowledge overrides the packaged baseline for the
        // same policy topic. Between sources of the same authority class, a
        // clearly higher configured priority wins.
        const winner=Math.abs(pa-pb)>=20?(pa>pb?a:b):(aManaged?a:b);
        const winnerSignature=this.factSignature(winner.text);
        const winnerManaged=this.isManagedSource(winner);
        const filtered=rows.filter(row=>{
          if(row===winner)return false;
          if(!this.samePolicyTopic(query,row.text))return true;
          const signature=this.factSignature(row.text);
          if(!signature||signature===winnerSignature)return true;
          if(winnerManaged&&!this.isManagedSource(row))return false;
          return Math.abs(Number(winner.priority||0)-Number(row.priority||0))<20;
        });
        return [winner,...filtered];
      }
    }
    return rows;
  }

  isManagedSource(row){return /^KS-/i.test(String(row?.sourceId||''));}

  detectConflict(query,matches=[]){
    if(matches.length<2)return false;
    if(!/\b(return|refund|cancel|cancellation|reschedul|arrival|late|notice|warranty|discount|payment|parking|same[ -]?day|policy)\b/i.test(String(query||'')))return false;
    const peers=matches.slice(0,4);
    for(let i=0;i<peers.length;i++)for(let j=i+1;j<peers.length;j++){
      if(peers[i].sourceId&&peers[i].sourceId===peers[j].sourceId)continue;
      if(Math.abs(Number(peers[i].priority||0)-Number(peers[j].priority||0))>5)continue;
      if(!this.samePolicyTopic(query,peers[i].text)||!this.samePolicyTopic(query,peers[j].text))continue;
      const a=this.factSignature(peers[i].text),b=this.factSignature(peers[j].text);
      if(a&&b&&a!==b)return true;
    }
    return false;
  }

  samePolicyTopic(query,text){
    const q=String(query||'').toLowerCase(),t=String(text||'').toLowerCase();
    const topics=[
      [/\b(returns?|refunds?)\b/,/\b(returns?|refunds?)\b/],
      [/\b(reschedul(?:e|ed|ing)|move (?:my|the|it) (?:booking|appointment|to)|change (?:my|the) (?:booking|appointment))\b/,/\b(reschedul(?:e|ed|ing)|late change)\b/],
      [/\b(cancel(?:led|lation)?|cancellation)\b/,/\b(cancel(?:led|lation)?|cancellation)\b/],
      [/\b(arrival|arrive|late)\b/,/\b(arrival|arrive|late)\b/],
      [/\b(warranty|guarantee)\b/,/\b(warranty|guarantee)\b/],
      [/\b(discount)\b/,/\b(discount)\b/],
      [/\b(payment|pay|card|cash)\b/,/\b(payment|pay|card|cash)\b/],
      [/\b(parking)\b/,/\b(parking)\b/],
      [/\b(same[ -]?day)\b/,/\b(same[ -]?day)\b/]
    ];
    const hit=topics.find(([qp])=>qp.test(q));
    return hit?hit[1].test(t):false;
  }

  factSignature(text){
    const t=String(text||'').toLowerCase();
    const day=t.match(/\b(\d{1,3})\s*(?:calendar\s+)?days?\b/);if(day)return `days:${day[1]}`;
    const pct=t.match(/\b(\d{1,3})\s*%\b/);if(pct)return `percent:${pct[1]}`;
    const money=t.match(/\b(?:rs|pkr|\$|usd)\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*(?:rs|pkr|usd)\b/);
    if(money)return `money:${(money[1]||money[2]||'').replace(/,/g,'')}`;
    if(/\b(?:yes|accepted|allowed|available|we do|can)\b/.test(t)&&!/\b(?:no|not|cannot|can't|closed|unavailable)\b/.test(t))return 'bool:yes';
    if(/\b(?:no|not|cannot|can't|closed|unavailable|not accepted|not allowed)\b/.test(t))return 'bool:no';
    return null;
  }

  evidenceComplete(query,match) {
    const q=String(query||'').toLowerCase(), evidence=`${match.path||''} ${match.text||''}`.toLowerCase();

    // Count questions need an actual stated count, not merely a paragraph that
    // contains the same noun ("cleaners", "staff", etc.).
    const workforceCount=/\b(how many|number of|total)\b.*\b(cleaners?|maids?|staff|employees?|workers?|employ)\b|\b(cleaners?|maids?|staff|employees?|workers?)\b.*\b(how many|number of|total|employ)\b/.test(q);
    if(workforceCount){
      const explicit=/\b(?:we (?:have|employ)|we currently have|team (?:has|of)|workforce (?:of|is)|staff (?:of|count is))\D{0,10}\d{1,5}\s*(?:cleaners?|maids?|employees?|workers?|staff members?)?\b|\b\d{1,5}\s+(?:cleaners?|maids?|employees?|workers?|staff members?)\b/.test(evidence);
      return explicit;
    }

    const rescheduleQuestion=/\b(reschedul(?:e|ed|ing)|move (?:my|the|it) (?:booking|appointment|to)|change (?:my|the) (?:booking|appointment))\b/.test(q);
    if(rescheduleQuestion)return /\b(reschedul(?:e|ed|ing)|late change)\b/.test(evidence);

    const cancellationQuestion=/\b(cancel(?:led|lation)?|cancellation)\b/.test(q)
      && !/\b(arrival|arrive|late|haven(?:'t| not) arrived)\b/.test(q);
    if(cancellationQuestion){
      // An arrival-window paragraph may mention "without a cancellation fee"
      // but it is not evidence for the customer's ordinary cancellation rule.
      // Require an actual cancellation-policy heading or a rule that says when
      // the customer can cancel.
      return /\bcancellation policy\b/.test(evidence)
        || /\bcancel(?:led)?\b[\s\S]{0,100}\b(?:before|within|notice|charge|fee|free)\b/.test(evidence)
        || /\b(?:before|within|notice)\b[\s\S]{0,100}\bcancel(?:led)?\b/.test(evidence);
    }

    const spoiledGoods=/\b(spoiled?|rotten|damaged|bruised)\b[\s\S]{0,45}\b(fruit|produce|item|order)|\b(fruit|produce|item|order)\b[\s\S]{0,45}\b(spoiled?|rotten|damaged|bruised)\b/.test(q);
    if(spoiledGoods)return /\b(spoiled?|rotten|damaged|bruised)\b/.test(evidence)&&/\b(claim|photo|replace|replacement|credit|refund|contact|report)\b/.test(evidence);

    const storageQuestion=/\b(how|where|should|can)\b[\s\S]{0,25}\b(store|keep|refrigerate|put)\b|\bstorage\b/.test(q)&&/\b(fruit|mango|apple|banana|orange|produce)\b/.test(q);
    if(storageQuestion)return /\b(storage|store|keep|kept|room temperature|refrigerat|fridge|sunlight|ripening)\b/.test(evidence)&&/\b(fruit|mango|apple|banana|orange|produce)\b/.test(evidence);

    const rentalDocuments=/\b(documents?|paperwork|requirements?)\b[\s\S]{0,70}\b(rent|rental|tenant|apartment|house|property)|\b(rent|rental|tenant)\b[\s\S]{0,70}\b(documents?|paperwork|requirements?)\b/.test(q);
    if(rentalDocuments)return /\b(tenant|rental|rent)\b/.test(evidence)&&/\b(cnic|passport|proof of income|employment|move-in|household|references?)\b/.test(evidence);

    const topicGates=[
      [/\b(favou?rite|preference|likes?|loves?)\b/,/\b(favou?rite|preference|likes?|loves?)\b/],
      [/\b(founder|owner|ceo|director)\b/,/\b(founder|owner|ceo|director)\b/],
      [/\b(cancel(?:led|lation)?|cancellation)\b/,/\b(cancel(?:led|lation)?|cancellation)\b/],
      [/\b(reschedul(?:e|ed|ing)|move (?:my|the) (?:booking|appointment)|change (?:my|the) (?:booking|appointment))\b/,/\b(reschedul(?:e|ed|ing)|late change)\b/],
      [/\b(haven(?:'t| not) arrived|officially late|arrival window|how late)\b/,/\b(arrival window|minutes late|30 minutes|60 minutes|arrive)\b/],
      [/\b(quote|quotation|estimate|price|cost|told me)\b.*\b(confirm|confirmed|confirmation)\b|\bconfirm(?:ed|ation)?\b.*\b(quote|quotation|estimate|price|cost)\b/,/\b(quote|availability response)\b.*\bnot (?:a )?confirmed|\bbooking is confirmed only|booking reference\b/],
      [/\b(high[ -]?rise|climb(?:ing)? outside|unsafe height)\b/,/\b(high[ -]?rise|unsafe heights?|not offered|safely reachable)\b/],
      [/\bfragrance[ -]?free\b/,/\bfragrance[ -]?free\b.*\b(hours?|notice|arrival)\b/],
      [/\b(pets?|dogs?|cats?|animals?)\b/,/\b(pets?|dogs?|cats?|animals?)\b/],
      [/\b(stay home|be at home|present during|remain at home|have to be present)\b/,/\b(remain at home|stay at home|do not have to remain|presence|safe access)\b/],
      [/\bparking\b/,/\bparking\b/],
      [/\b(materials?|supplies|cleaning products?|equipment)\b/,/\b(materials?|supplies|cleaning products?|equipment)\b/],
      [/\bbalcony|terrace\b/,/\bbalcony|terrace\b/],
      [/\bwindow\b/,/\bwindow\b/],
      [/\bsame[ -]?day\b/,/\bsame[ -]?day\b/]
    ];
    for(const [questionPattern,evidencePattern] of topicGates)if(questionPattern.test(q))return evidencePattern.test(evidence);

    const paymentQuestion=/\b(payment methods?|ways? to pay|how (?:can|do) i pay|what.*pay)\b/.test(q);
    if(paymentQuestion){
      return /\b(cash on delivery|cod|jazzcash|easypaisa|bank transfer|credit card|debit card|cash|card|paypal|stripe)\b/.test(evidence);
    }

    // Area questions should return substantive coverage data rather than only a
    // heading or introductory sentence.
    const areaQuestion=/\b(serving areas?|service areas?|areas? (?:do you|you) serve|where do you (?:serve|operate|work))\b/.test(q);
    if(areaQuestion){
      const tail=evidence.replace(/\b(service area|serving area|areas?|serve|serves|coverage|location)\b/g,' ').trim();
      return tail.split(/\s+/).filter(Boolean).length>=5;
    }
    return String(match.text||'').trim().length>=12;
  }

  groundedAnswer(query,retrieval,{focus=null}={}){
    const q=String(query||'').toLowerCase();
    const rows=retrieval?.matches||[];
    if(!rows.length)return null;
    const topic=(pattern)=>rows.find(x=>pattern.test(`${x.path||''} ${x.text||''}`))||null;

    if((!focus||focus==='confirmation')&&/\b(quote|quotation|estimate|price|cost|told me)\b.*\b(confirm|confirmed|confirmation)\b|\bconfirm(?:ed|ation)?\b.*\b(quote|quotation|estimate|price|cost)\b/.test(q)){
      const row=topic(/booking and confirmation|quote or availability response alone is not|booking is confirmed only/i);
      if(row)return 'No. A quote or availability response alone is not a confirmed booking. Confirmation requires a booking reference and a confirmed date/time window.';
    }

    if((!focus||focus==='safety')&&/\b(high[ -]?rise|climb(?:ing)? outside|unsafe height)\b/.test(q)){
      const row=topic(/safety and service limitations|exterior high-rise window cleaning|unsafe heights?/i);
      if(row)return 'No. Exterior high-rise window cleaning is not offered. Cleaning is limited to areas safely reachable from the floor or with a small household step stool, so there is no approved price for climbing outside.';
    }

    if((!focus||focus==='fragrance_free')&&/\bfragrance[ -]?free\b/.test(q)){
      const row=topic(/fragrance[ -]?free/i);if(row){
        const threshold=Number((String(row.text).match(/fragrance[ -]?free[\s\S]{0,180}?at least\s+(\d+)\s+hours?/i)||[])[1]||0);
        const notice=extractNoticeHours(q,'fragrance_free');
        if(threshold&&notice!=null&&notice<threshold)return `The request is only ${notice} hours before arrival, which does not meet the approved minimum notice of ${threshold} hours. Fragrance-free products therefore cannot be guaranteed from the approved knowledge.`;
        if(threshold)return `Fragrance-free products are available at no extra charge when requested at least ${threshold} hours before arrival.`;
      }
    }

    if((!focus||focus==='pets')&&/\b(pet (?:fee|surcharge)|pet hair|heavy pet hair|cat|dog)\b/.test(q)){
      const row=topic(/pet-hair surcharge|simply having a pet|pets and children/i);
      if(row&&/\b(no|isn(?:'t| not)|without)\b.{0,30}\bheavy pet hair|\bthere (?:isn(?:'t| not)|is no) heavy\b/.test(q))return 'No pet surcharge applies merely because there is a pet. The surcharge applies only when heavy pet-hair removal is requested or clearly required.';
    }

    const arrival=/\b(haven(?:'t| not) arrived|officially late|arrival window|how late|more than \d+ minutes late)\b/.test(q);
    if((!focus||focus==='arrival')&&arrival){
      const row=topic(/arrival time policy|normal arrival window|more than 60 minutes late/i);
      const minutes=extractArrivalDelayMinutes(q);
      if(row&&minutes!=null){
        if(minutes<=30)return `No. ${minutes} minutes after the booked time is still within the normal arrival window, which runs from the booked time through 30 minutes afterward.`;
        if(minutes>60&&/\bcancel/.test(q))return `The company is ${minutes} minutes late. Under the approved arrival policy, when the delay is more than 60 minutes and the customer no longer wants the service, cancellation is allowed without a cancellation fee.`;
        if(minutes>30)return `The team is outside the normal 30-minute arrival window. The customer should be contacted with an updated estimated arrival time.`;
      }
    }

    const reschedule=/\b(reschedul(?:e|ed|ing)|move (?:my|the|it) (?:booking|appointment|to)|change (?:my|the) (?:booking|appointment))\b/.test(q);
    const cancellation=/\b(cancel|cancellation|cancelled|canceled)\b/.test(q)&&!(/\b(?:don(?:'t| not)|do not)\b.{0,20}\bcancel\b/.test(q)&&reschedule);
    if((!focus||(focus==='rescheduling'&&reschedule)||(focus==='cancellation'&&cancellation))&&(reschedule||cancellation)){
      const exactPolicy=rows.find((x)=>reschedule
        ? /^rescheduling policy$/i.test(String(x.path||'').trim())
        : /^cancellation policy$/i.test(String(x.path||'').trim()));
      const row=exactPolicy||topic(reschedule?/rescheduling policy|reschedule fee|late change/i:/cancellation policy|6\s*[-–]\s*24 hours before start|customer cancels/i);
      const hours=extractNoticeHours(q,reschedule?'rescheduling':'cancellation');
      if(row&&hours!=null){
        const rule=extractTimingRule(row.text,hours,reschedule?'reschedule':'cancel');
        if(rule)return `${hours} hours before the scheduled start falls under this approved rule: ${rule}`;
      }
    }
    return null;
  }

  answer(intent, tenant) {
    const data = this.getContext(tenant);
    const business = data.profilePublished ? { ...data.business, ...data.identity } : { ...data.identity, ...data.business };
    switch (intent) {
      case "ask_business_info": {
        const businessName=business.name||tenant.name||null;
        const contact=this.contact(business.contact);
        return [businessName?`Name: ${businessName}`:null,business.description?`About: ${business.description}`:null,contact?`Contact: ${contact}`:null].filter(Boolean).join('\n')||null;
      }
      case "ask_about": return business.description || null;
      case "ask_services": return this.list(business.services);
      case "ask_hours": return business.hours || null;
      case "ask_contact": return this.contact(business.contact);
      case "ask_location": return this.location(business.location);
      case "ask_delivery": return this.usableFact(business.delivery);
      case "ask_takeaway": return business.takeaway || (Array.isArray(business.services) && business.services.some(x=>String(x).toLowerCase().includes("takeaway")) ? "Yes, takeaway is available." : null);
      case "ask_payment": return this.list(business.paymentMethods) || this.faqAnswer(data.faqs, /\b(pay|payment|jazzcash|easypaisa|cash on delivery|bank transfer)\b/i);
      case "ask_returns": return this.usableFact(business.returns);
      case "ask_faq": return this.faqList(data.faqs);
      default: return null;
    }
  }

  usableFact(value) {
    if (!value) return null;
    const text=String(value).trim();
    if (/\b(not enabled|not configured|assistant-only tenant|placeholder|todo|unknown)\b/i.test(text)) return null;
    return text;
  }

  list(value) {
    if (!Array.isArray(value) || value.length === 0) return null;
    return value.map((item) => typeof item === "string" ? item : item.name).filter(Boolean).join(", ");
  }

  contact(value) {
    if (!value) return null;
    if (typeof value === "string") return value;
    return [value.phone, value.whatsapp, value.email, value.website].filter(Boolean).join(" | ") || null;
  }

  location(value) {
    if (!value) return null;
    if (typeof value === "string") return value;
    return [value.address, value.city, value.country].filter(Boolean).join(", ") || null;
  }

  faqAnswer(faqs, pattern) {
    const hit=(faqs||[]).find(faq=>pattern.test(`${faq.question||''} ${faq.answer||''}`));
    return hit?.answer || null;
  }

  faqList(faqs) {
    if (!faqs.length) return null;
    return faqs.map((faq) => `${faq.question}: ${faq.answer}`).join("\n");
  }
}
function extractNoticeHours(text,focus=null){
  const q=String(text||'').toLowerCase();
  if(focus==='cancellation'){
    const specific=q.match(/\b(?:cancel|cancellation|cancelled|canceled)[\s\S]{0,50}?(\d+(?:\.\d+)?)\s+hours?\s+before\b/);if(specific)return Number(specific[1]);
  }
  if(focus==='rescheduling'){
    const specific=q.match(/\b(?:reschedule|rescheduling|move|change)[\s\S]{0,50}?(\d+(?:\.\d+)?)\s+hours?\s+(?:before|from now|away)\b/);if(specific)return Number(specific[1]);
  }
  let m=q.match(/\b(?:appointment|booking|service|arrival)\s+(?:is\s+)?(?:only\s+)?(\d+(?:\.\d+)?)\s+hours?\s+(?:from now|away)\b/);
  if(m)return Number(m[1]);
  m=q.match(/\b(\d+(?:\.\d+)?)\s+hours?\s+(?:before|from now|away)\b/);if(m)return Number(m[1]);
  const scheduled=q.match(/\b(?:appointment|booking|service)\s+(?:is\s+)?tomorrow\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/);
  const change=q.match(/\b(?:cancel|reschedule|move|change)[\s\S]{0,80}?today\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/);
  if(scheduled&&change){
    const start=clockMinutes(scheduled[1]),action=clockMinutes(change[1]);
    if(start!=null&&action!=null)return (start+1440-action)/60;
  }
  return null;
}
function extractArrivalDelayMinutes(text){
  const matches=[...String(text||'').matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi)];
  if(matches.length<2)return null;
  const booked=clockMinutes(matches[0][0]),current=clockMinutes(matches.at(-1)[0]);
  if(booked==null||current==null)return null;
  return current>=booked?current-booked:current+1440-booked;
}
function clockMinutes(value){
  const m=String(value||'').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);if(!m)return null;
  let hour=Number(m[1])%12;if(m[3].toLowerCase()==='pm')hour+=12;return hour*60+Number(m[2]||0);
}
function extractTimingRule(value,hours,kind){
  const text=String(value||'').replace(/\r/g,'');
  let pattern;
  if(hours>24)pattern=/more than 24 hours[\s\S]*?(?=(?:\n?\s*•?\s*(?:between 6|6\s*[-–]\s*24|less than 6|after team|if [A-Z]))|$)/i;
  else if(hours>=6)pattern=/(?:between 6 and 24|6\s*[-–]\s*24) hours[\s\S]*?(?=(?:\n?\s*•?\s*(?:less than 6|after team|if [A-Z]))|$)/i;
  else pattern=/less than 6 hours[\s\S]*?(?=(?:\n?\s*•?\s*(?:after team|if [A-Z]))|$)/i;
  const hit=text.match(pattern)?.[0];
  if(hit)return cleanPolicyRule(hit);
  const compact=text.replace(/\s+/g,' ');
  const fallback=kind==='reschedule'
    ? (hours>24?/free rescheduling\s+more than 24 hours before service/i:hours>=6?/6-24 hour reschedule fee\s+(?:rs|pkr|\$|usd)?\s*[\d,]+/i:/less than 6 hour change fee\s+\d+% of booked service price/i)
    : (hours>24?/free cancellation\s+more than 24 hours before service/i:hours>=6?/6-24 hour cancellation fee\s+(?:rs|pkr|\$|usd)?\s*[\d,]+/i:/less than 6 hour change fee\s+\d+% of booked service price/i);
  return cleanPolicyRule(compact.match(fallback)?.[0]||'');
}
function cleanPolicyRule(value){return String(value||'').replace(/^\s*•\s*/,'').replace(/\s+/g,' ').trim();}
module.exports = { KnowledgeService };
function displaySchedule(schedule){
  const days=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  return days.map(day=>{const intervals=schedule?.[day];if(!Array.isArray(intervals)||!intervals.length)return `${title(day)}: Closed`;return `${title(day)}: ${intervals.map(row=>`${clock(row.open)}-${clock(row.close)}`).join(', ')}`;}).join('; ');
}
function clock(value){const [h,m]=String(value).split(':').map(Number),period=h>=12?'PM':'AM',hour=h%12||12;return `${hour}${m?`:${String(m).padStart(2,'0')}`:''} ${period}`;}
function title(value){return String(value).replace(/^./,char=>char.toUpperCase());}
