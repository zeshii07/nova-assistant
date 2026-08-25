/**
 * Shared, tenant-neutral Urdu/Roman-Urdu structural vocabulary.
 *
 * Keep this list bounded to conversational grammar (dates, time windows and
 * common acquisition verbs). Business nouns belong to each tenant's catalog
 * or offering data and must never be silently rewritten here.
 */
const WEEKDAY_ALIASES = Object.freeze({
  sunday:['sunday','sun','itwar','itwaar','atwar','اتوار'],
  monday:['monday','mon','peer','pir','somwar','پیر','سوموار'],
  tuesday:['tuesday','tue','tues','mangal','منگل'],
  wednesday:['wednesday','wed','budh','budhwar','بدھ'],
  thursday:['thursday','thu','thur','jumerat','jumeraat','جمعرات'],
  friday:['friday','fri','jumma','juma','جمعہ'],
  saturday:['saturday','sat','hafta','sanichar','shanivar','ہفتہ','سنیچر']
});

const TIME_WINDOWS = Object.freeze({
  morning:['morning','subah','subha','sabah','savere','sawere','savera','fajr','صبح','سویرے'],
  afternoon:['afternoon','dopahar','dopehar','dupehar','دوپہر'],
  evening:['evening','shaam','sham','شام'],
  night:['night','raat','rat','رات']
});

const WEEKDAY_LOOKUP = new Map(Object.entries(WEEKDAY_ALIASES).flatMap(([canonical,aliases])=>aliases.map(alias=>[alias,canonical])));
const WINDOW_LOOKUP = new Map(Object.entries(TIME_WINDOWS).flatMap(([canonical,aliases])=>aliases.map(alias=>[alias,canonical])));

function normalizeUrduDigits(value){
  const map={'۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9','٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9'};
  return String(value||'').replace(/[۰-۹٠-٩]/g,(digit)=>map[digit]||digit);
}

function canonicalWeekdayToken(token){return WEEKDAY_LOOKUP.get(String(token||'').toLowerCase())||null;}
function canonicalTimeWindowToken(token){return WINDOW_LOOKUP.get(String(token||'').toLowerCase())||null;}
function weekdayAliases(){return [...WEEKDAY_LOOKUP.keys()];}
function timeWindowAliases(){return [...WINDOW_LOOKUP.keys()];}

module.exports={WEEKDAY_ALIASES,TIME_WINDOWS,normalizeUrduDigits,canonicalWeekdayToken,canonicalTimeWindowToken,weekdayAliases,timeWindowAliases};
