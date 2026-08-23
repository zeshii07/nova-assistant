const { BaseCapability } = require("../../../packages/capability-sdk/src/baseCapability");
const { createCapabilityResult } = require("../../../packages/capability-sdk/src/capabilityResult");

/** Conversational interface for the official tenant CRM record. */
class CrmCapability extends BaseCapability {
  async canHandle(context) {
    const text = normalize(context.message.text);
    const patterns = [
      /^(my name is|call me|mera naam|mera name|میرا نام)\b/,
      /\bmain\s+[a-z][a-z .'-]{1,50}\s+(?:hn|hoon|hun)\b/i,
      /^(my email is|mera email|میرا ای میل)\b/,
      /^(my phone is|mera phone|میرا فون)\b/,
      /\b(what is my name|what\'s my name|tell me my name|mera naam kya|mera name kya)\b/,
      /\b(show|tell).*(my profile|my details|about me|what you know about me)\b/,
      /\b(my details|meri details)\b/,
      /\b(mera profile|mere bare mein|میرے بارے|میرا پروفائل)\b/,
      /^(add note|remember note|note)\b/,
      /^(add tag|tag me as|tag)\b/
    ];
    return patterns.some((pattern) => pattern.test(text)) ? { confidence: 0.98, reason: "explicit_crm_request" } : { confidence: 0 };
  }

  async execute(context) {
    const crm = context.services.crm;
    if (!crm) throw new Error("CRM service is unavailable.");
    const original = context.message.text.trim(); const text = normalize(original);
    let reply; let action = "profile_viewed";

    const selectedIntent=context.intelligence?.selected?.intent;
    const declared=context.services.engagement?.parseDeclaredName?.(original);
    const name = context.intelligence?.entities?.name || (declared?.valid?declared.value:null);
    const emailRaw = capture(original, /(?:my email is|mera email|میرا ای میل)\s+([^\s]+@[^\s]+)/i);
    const phoneRaw = capture(original, /(?:my phone is|mera phone|میرا فون)\s+([+\d][\d\s-]{7,})/i);
    const emailParsed=emailRaw?context.services.engagement?.parseField?.('email',emailRaw):null;
    const phoneParsed=phoneRaw?context.services.engagement?.parseField?.('phone',phoneRaw,{minDigits:10,maxDigits:15}):null;
    const note = capture(original, /(?:add note|remember note|note)\s*[:\-]?\s*(.+)$/i);
    const tag = capture(original, /(?:add tag|tag me as|tag)\s*[:\-]?\s*(.+)$/i);

    if (selectedIntent==='crm.ask_name') {
      const current=await crm.getCustomer();
      reply=current?.name ? `Your name is ${current.name}.` : "You haven't told me your name yet.";
      action="name_viewed";
    }
    else if (name) { await crm.updateCustomer({ name: cleanName(name) }); const greeting=/\b(hello|hi|hey|salam|assalam)\b/i.test(original); const welcome=context.tenant?.branding?.welcomeMessage||'Hello!'; reply = greeting ? `${welcome}\n\nNice to meet you, ${cleanName(name)} 😊 I’ll remember your name.` : `Got it — I’ll call you ${cleanName(name)}.`; action = "name_updated"; }
    else if (emailParsed?.valid) { await crm.updateCustomer({ email: emailParsed.value }); reply = "Your email has been saved to your customer profile."; action = "email_updated"; }
    else if (phoneParsed?.valid) { await crm.updateCustomer({ phone: phoneParsed.value }); reply = "Your phone number has been saved to your customer profile."; action = "phone_updated"; }
    else if(emailRaw||phoneRaw){reply=(emailParsed||phoneParsed)?.message||'That contact detail is not valid. Please enter it again.';action='contact_rejected';}
    else if (note && !/^note$/i.test(note)) { await crm.addNote(note.trim()); reply = "The note has been added to your customer profile."; action = "note_added"; }
    else if (tag && !/^tag$/i.test(tag)) { await crm.addTag(tag.trim()); reply = `The tag “${tag.trim().toLowerCase()}” has been added.`; action = "tag_added"; }
    else { reply = formatProfile(await crm.getCustomer()); }

    await crm.recordActivity(`crm.${action}`, { text: original });
    const customer = await crm.getCustomer();
    return createCapabilityResult({
      reply, confidence: 0.98,
      responseModel: { intent: `CRM_${action.toUpperCase()}`, payload: { name: customer?.name, customer } },
      statePatch: { lastIntent: `crm_${action}`, activePlugin: "crm" }, metadata: { action },
      events: [{ name: "crm.conversation.handled.v1", payload: { action } }]
    });
  }
}
function normalize(value) { return String(value || "").toLowerCase().replace(/[?.!,]/g, " ").replace(/\s+/g, " ").trim(); }
function capture(value, pattern) { const match = String(value).match(pattern); return match ? match[1].trim() : null; }
function cleanName(value) { return value.replace(/\s+(hai|ہے)$/i, "").trim().replace(/\b\w/g, (c) => c.toUpperCase()); }
function formatProfile(customer) {
  if (!customer) return "I don’t have a customer profile for you yet.";
  const lines = ["👤 Your customer profile"];
  if (customer.name) lines.push(`Name: ${customer.name}`);
  if (customer.phone) lines.push(`Phone: ${customer.phone}`);
  if (customer.email) lines.push(`Email: ${customer.email}`);
  if (customer.preferredLanguage) lines.push(`Language: ${customer.preferredLanguage}`);
  const delivery=customer.customFields?.lastDelivery||{};
  if (delivery.city) lines.push(`City: ${delivery.city}`);
  if (delivery.address) lines.push(`Last delivery address: ${delivery.address}`);
  if (delivery.paymentMethod) lines.push(`Last payment method: ${delivery.paymentMethod}`);
  lines.push(`Status: ${customer.status}`);
  if (customer.tags.length) lines.push(`Tags: ${customer.tags.join(", ")}`);
  if (customer.notes.length) lines.push(`Notes: ${customer.notes.length}`);
  return lines.join("\n");
}
module.exports = { Capability: CrmCapability, CrmCapability };
