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
    // v34.0 Bugfix: "main" in "123 Main Street Dubai" was false-positive
    // matching as Roman Urdu word "main" (meaning "I"). If the text contains
    // English location words (street, road, building, etc.) and has only 1
    // Roman Urdu match, it's almost certainly an English address, not Roman Urdu.
    if(matches>=1){
      const hasEnglishLocationWords=/\b(street|road|avenue|blvd|building|block|sector|apartment|villa|floor|tower|highway|lane|drive|way)\b/i.test(original);
      const ambiguousWords=['main','naam','kar','ho','bata','aur','dein','paas'];
      const ambiguousMatches=romanUrduWords.filter(word=>words.has(word)&&ambiguousWords.includes(word)).length;
      const nonAmbiguousMatches=matches-ambiguousMatches;
      // If only ambiguous matches and English location words present, classify as English
      if(nonAmbiguousMatches===0&&hasEnglishLocationWords) return 'english';
      // If only 1 ambiguous match and no other Roman Urdu indicators, require more context
      if(matches===1&&ambiguousMatches===1&&!hasEnglishLocationWords){
        // Single ambiguous word like "main" or "naam" alone is not enough
        // to switch language — could be English "Main Street" or "name"
        return fallback||'english';
      }
    }
    return matches>=1?'roman_urdu':'english';
  }
}
module.exports={LanguageEngine};
