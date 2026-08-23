/**
 * Converts semantic capability output into tenant-branded natural language.
 * It never changes facts or performs business actions.
 */
class HumanizationEngine {
  constructor({ intentRenderer, templateEngine, personaEngine, languageEngine, relationshipEngine, policyEngine, channelRenderers, logger }) {
    Object.assign(this, { intentRenderer, templateEngine, personaEngine, languageEngine, relationshipEngine, policyEngine, channelRenderers, logger });
  }
  async humanize({ capabilityId, result, context }) {
    const semantic = this.intentRenderer.render({ capabilityId, result });
    const language = await this.languageEngine.resolve({ context });
    const relationship = await this.relationshipEngine.resolve({ context });
    const persona = this.personaEngine.get(context.tenant.id);
    const policy = { ...this.policyEngine.get(context.tenant.id), emojiLevel: this.policyEngine.get(context.tenant.id).emojiLevel || persona.emojiLevel };
    const key = semantic.intent;
    const configuredTemplate = this.templateEngine.get(context.tenant.id, key, language);
    const responseSequence=Number(result.statePatch?.context?.assistantResponseSequence||context.state?.context?.assistantResponseSequence||1);
    const template = selectVariant(configuredTemplate,responseSequence);
    const data = { ...semantic.payload, persona, relationship, customer: context.customer || {}, tenant: context.tenant, language };
    let text = semantic.payload?.preferLegacyText
      ? (semantic.payload.legacyText || result.reply)
      : template ? this.templateEngine.render(template, data) : socialVariant(key,language,responseSequence,semantic.payload.legacyText || result.reply,context.tenant);
    text = this.applyRelationship(text, { relationship, customer: context.customer, semantic, language });
    text = normalizeFlow(text);
    text = this.policyEngine.apply(text, policy);
    text = this.channelRenderers.render(context.channel, { text, semantic, persona, policy, language });
    this.logger?.info("experience.rendered", { capabilityId, intent: semantic.intent, language, relationship, channel: context.channel });
    return { text, semantic, language, relationship, persona };
  }
  applyRelationship(text, { relationship, customer, semantic, language }) {
    if (semantic.intent !== "GREETING" || !customer?.name || relationship === "visitor") return text;
    const prefix = language === "urdu" ? `خوش آمدید، ${customer.name}!` : language === "arabic" ? `مرحبًا بعودتك، ${customer.name}! 😊` : language === "roman_urdu" ? `Welcome back, ${customer.name}! 😊` : `Hello, ${customer.name}! Welcome back 😊`;
    return `${prefix}\n\n${text}`;
  }
}
function selectVariant(value,sequence){
  if(!Array.isArray(value))return value;
  if(!value.length)return null;
  return value[(Math.max(1,Number(sequence||1))-1)%value.length];
}
function socialVariant(intent,language,sequence,fallback,tenant={}){
  const name=tenant.business?.name||tenant.name||'the business';
  const variants={
    SMALL_TALK:{
      english:[fallback,"I’m doing well, thanks for asking 😊 What would you like help with today?","All good here 😊 Tell me what you’d like to know or arrange, and I’ll help."],
      roman_urdu:[fallback,"Main theek hoon, shukriya 😊 Aap batayein, aaj kis cheez mein madad chahiye?","Alhamdulillah sab theek 😊 Aap sunayein—main aaj aap ke liye kya kar sakta hoon?"]
    },
    THANKS:{
      english:[fallback,"Happy to help 😊 Just message whenever you need anything else.","Anytime! If another question comes up, I’m here."],
      roman_urdu:[fallback,"Khushi hui 😊 Jab bhi aur madad chahiye ho, message kar dein.","Koi baat nahi 😊 Aur kuch poochna ho to main yahin hoon."]
    },
    GREETING:{
      english:[fallback,`Hi! Welcome to ${name} 😊 What can I help you with?`,`Hello there 👋 Tell me what you’d like to know or arrange.`],
      roman_urdu:[fallback,`Assalam-o-alaikum 😊 ${name} mein khush aamdeed. Aaj kis cheez mein madad chahiye?`,`Salam 👋 Batayein, main aap ke liye kya kar sakta hoon?`]
    }
  };
  const rows=variants[intent]?.[language]||null;
  return rows?selectVariant(rows,sequence):fallback;
}
function normalizeFlow(value){
  const lines=String(value||'').replace(/[ \t]+\n/g,'\n').split('\n');
  const output=[];
  for(const line of lines){
    const normalized=line.trim().toLowerCase();
    const previous=String(output[output.length-1]||'').trim().toLowerCase();
    if(normalized&&normalized===previous)continue;
    output.push(line.trimEnd());
  }
  return output.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
module.exports = { HumanizationEngine };
