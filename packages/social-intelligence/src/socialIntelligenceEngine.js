const { normalizeText } = require('../../conversation-intelligence/src/text');

/**
 * Cross-cutting social understanding. This layer may change tone/transition only;
 * it never changes prices, inventory, booking facts, or workflow state.
 */
class SocialIntelligenceEngine {
  analyze(text) {
    const n = normalizeText(text);
    const greeting = /^(hi|hello|hey|salam|salaam|assalam|aoa|السلام|السلام علیکم)\b/.test(n);
    const smallTalk = /\b(how are you|how r u|how do you do|how are things|how is your day|how'?s your day|hows your day|what'?s up|whats up|kaise ho|kaisay ho|kese ho|kia+a? hal|kya haal|kya hal|آپ کیسے ہیں|کیا حال ہے)\b/.test(n);
    const gratitude = /\b(thanks|thank you|thx|shukriya|mehrbani|bohat shukriya|شکریہ|جزاک اللہ)\b/.test(n);
    const positiveReaction = /\b(great|nice|awesome|perfect|wow|wah|zabardast|kamal|kia baat|kya baat|haha|lol|theek|acha|achha)\b/.test(n);
    const priceConcern = /\b(expensive|costly|too much|mehnga|mehngi|mehang|mahang|itny mehng|itne mehng|bohat mehng|price zyada|قیمت.*زیادہ|مہنگ)/.test(n);
    const apology = /\b(sorry|maaf|my bad|galti|معاف)/.test(n);
    const goodbye = /\b(bye|goodbye|allah hafiz|khuda hafiz|اللہ حافظ)/.test(n);
    const familiarAddress = /\b(bhai|bhaijan|bhai jan|jaan|jan|yaar|yar|dost|bro|boss)\b/.test(n);
    const respectfulAddress = /\b(sir|madam|maam|jee|ji|g)\b/.test(n);
    const polite = /\b(please|plz|pls|meherbani|mehrbani|kindly)\b/.test(n);
    return { greeting, smallTalk, gratitude, positiveReaction, priceConcern, apology, goodbye, familiarAddress, respectfulAddress, polite, normalized:n };
  }

  polish(text, { social = {}, language = 'english', capabilityId = null, selectedIntent = null, messageText = '', relationship = 'visitor' } = {}) {
    let output = String(text || '').trim();
    if (!output) return output;
    const isAssistantSocial = capabilityId === 'assistant' && /^assistant\.(greet|small_talk|thanks|goodbye|social)/.test(selectedIntent || '');

    // Mixed greeting + "how are you" should sound like a person answering the
    // question, rather than only replaying a generic assistant introduction.
    if (isAssistantSocial && social.greeting && social.smallTalk) {
      if (language === 'roman_urdu') return social.familiarAddress
        ? 'Walaikum-assalam bhai 😊 Main bilkul theek hoon, shukriya. Aap sunayein? Aaj kya chahiye, main help karta hoon.'
        : 'Walaikum-assalam 😊 Main bilkul theek hoon, shukriya. Aap sunayein? Aaj main aapki kis cheez mein madad karun?';
      if (language === 'urdu') return 'وعلیکم السلام 😊 میں بالکل ٹھیک ہوں، شکریہ۔ آپ سنائیے؟ آج میں آپ کی کس چیز میں مدد کروں؟';
      return social.familiarAddress
        ? 'Hey! 😊 I’m doing well, thanks. How are you? What can I help you with today?'
        : 'Hello! 😊 I’m doing well, thank you. How are you? What can I help you with today?';
    }

    if (social.greeting && !isAssistantSocial && !startsWithGreeting(output)) {
      output = `${greetingPrefix(language, social)}\n\n${output}`;
    }

    const validationRejected = /^(sorry|maazrat|معذرت|that .*isn\'t available|that .*is unavailable|yeh .*available nahi)/i.test(output);
    if (/^catalog\.attribute_update$/.test(selectedIntent || '') && !validationRejected && !/^(perfect|great|theek|ji|got it|done)/i.test(output)) {
      output = `${acknowledgement(language, messageText, social)}\n\n${output}`;
    }

    // Friendly confirmations can acknowledge the customer's tone, but only on
    // transactional responses where the facts are already determined.
    if (social.familiarAddress && language === 'roman_urdu' && /^(commerce|booking|cleaning)$/.test(capabilityId || '') && !/^(bilkul|theek|done|added|great|📋|🎉|✅)/i.test(output)) {
      if (/\b(confirm|checkout|order|booking|request)\b/.test(selectedIntent || '')) output = `Bilkul bhai 👍\n\n${output}`;
    }

    if (social.apology && !/^(no problem|koi baat|theek hai|کوئی بات)/i.test(output) && !validationRejected) {
      const prefix = language === 'roman_urdu' ? 'Koi baat nahi 😊' : language === 'urdu' ? 'کوئی بات نہیں 😊' : 'No problem 😊';
      output = `${prefix}\n\n${output}`;
    }
    return output;
  }
}
function greetingPrefix(language, social={}) {
  if (language === 'urdu') return 'السلام علیکم! 😊';
  if (language === 'roman_urdu') return social.familiarAddress ? 'Assalam-o-alaikum bhai 😊' : 'Assalam-o-alaikum! 😊';
  return social.familiarAddress ? 'Hey! 😊' : 'Hello! 😊';
}
function acknowledgement(language, text='', social={}) {
  const seed=[...String(text)].reduce((a,c)=>a+c.charCodeAt(0),0);
  if (language === 'urdu') return ['بہترین 👍','ٹھیک ہے 👍','سمجھ گیا 👍'][seed%3];
  if (language === 'roman_urdu') {
    const options=social.familiarAddress?['Bilkul bhai 👍','Theek hai bhai 👍','Ho gaya 👍']:['Perfect 👍','Theek hai 👍','Got it 👍'];
    return options[seed%options.length];
  }
  return ['Perfect 👍','Got it 👍','Done 👍'][seed%3];
}
function startsWithGreeting(text) { return /^(hello|hi|hey|assalam|walaikum|السلام)/i.test(text.trim()); }
module.exports = { SocialIntelligenceEngine };
