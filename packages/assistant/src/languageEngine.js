const { canonicalize } = require('../../universal-vocabulary/src');
/**
 * Detects the customer's preferred language without depending on an LLM.
 * Shared Roman-Urdu normalization comes from Universal Vocabulary.
 */
class LanguageEngine {
  detect(text, fallback = "english") {
    const original=String(text||'').trim().toLowerCase();
    if(!original)return fallback;
    if(/[\u0600-\u06ff]/.test(original))return 'urdu';
    const value=canonicalize(original);
    const romanUrduWords=[
      'aap','ap','kya','kia','kaise','kese','hain','hai','ho','bhai','yaar','janab',
      'mujhe','chahiye','bata','batain','batao','shukriya','salam','salaam','assalam',
      'kahan','kab','kitna','kitne','kar','karo','karein','kr','dein','mera','meri',
      'hamara','tumhare','paas','aur','naam','leni','lena','kapray','joota','jootay',
      'main','mai','mein','ny','mujhay','mujy','chaheye','karwani','karwana','krani',
      'safai','saaf','subha','savere','dopahar','sham','raat','jumma','hafta','parson','theek','haan','bilkul'
    ];
    const words=new Set(value.replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean));
    const matches=romanUrduWords.filter(word=>words.has(word)).length;
    return matches>=1?'roman_urdu':'english';
  }
}
module.exports={LanguageEngine};
