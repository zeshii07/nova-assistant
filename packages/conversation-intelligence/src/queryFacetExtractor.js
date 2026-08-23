function extractQueryFacets(value){
  const text=String(value||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
  const facets=[];
  if(/\b(payment|payment method|pay|card|cash|jazzcash|easypaisa|bank transfer)\b/.test(text))facets.push('payment');
  if(/\b(discount|discounts|discounted|cheaper|best price|riayat)\b/.test(text))facets.push('discount');
  const rescheduling=/\b(reschedule|rescheduling|move (?:my|the|it) (?:booking|appointment|to)|change (?:my|the) (?:booking|appointment))\b/.test(text);
  const cancelNegated=/\b(?:don t|do not|not going to|won t)\b.{0,24}\bcancel\b/.test(text);
  if(!cancelNegated&&/\b(cancel|cancellation|cancelled|canceled)\b/.test(text)&&/\b(can i|could i|may i|how|policy|fee|allowed|possible|booked|booking|service)\b/.test(text))facets.push('cancellation');
  if(rescheduling&&/\b(how much|what fee|policy|fee|charge|cost|pay|hours? (?:from now|before)|before the (?:appointment|booking|service))\b/.test(text))facets.push('rescheduling');
  if(/\b(haven t arrived|have not arrived|officially late|arrival window|how late)\b/.test(text))facets.push('arrival');
  if(/\b(quote|quotation|estimate|price|cost|told me)\b.*\b(confirm|confirmed|confirmation)\b|\bconfirm(?:ed|ation)?\b.*\b(quote|quotation|estimate|price|cost)\b/.test(text))facets.push('confirmation');
  if(/\b(high rise|climb(?:ing)? outside|unsafe height)\b/.test(text))facets.push('safety');
  if(/\bfragrance free\b/.test(text))facets.push('fragrance_free');
  if(/\b(pet surcharge|pet fee|pet hair|heavy pet hair|cat|dog)\b/.test(text))facets.push('pets');
  if(/\b(serving areas?|service areas?|areas? do you serve|where do you serve|coverage)\b/.test(text))facets.push('service_area');
  if(!/\b(cancel|cancellation|reschedule|rescheduling)\b/.test(text)&&/\b(same[ -]?day|today)\b/.test(text)&&/\b(book|booking|service|cleaning|available)\b/.test(text))facets.push('same_day');
  return [...new Set(facets)];
}
module.exports={extractQueryFacets};
