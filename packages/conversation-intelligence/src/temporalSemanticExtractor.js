const { normalizeText, numberFromText, normalizeWeekdayTypos, normalizeUrduDigits } = require('./text');
const { TIME_WINDOWS } = require('./multilingualLexicon');

const MONTHS='january february march april may june july august september october november december'.split(' ');
const URDU_MONTHS=Object.freeze({جنوری:'January',فروری:'February',مارچ:'March',اپریل:'April',مئی:'May',جون:'June',جولائی:'July',اگست:'August',ستمبر:'September',اکتوبر:'October',نومبر:'November',دسمبر:'December'});
const DAYS='monday tuesday wednesday thursday friday saturday sunday'.split(' ');

/** Extracts universal date/time structure without making availability claims. */
class TemporalSemanticExtractor {
  extract(value) {
    const raw=String(value||'');
    const digitRaw=normalizeUrduDigits(raw);
    const n=normalizeWeekdayTypos(raw);
    const out={version:'1.0'};
    const range=extractTimeRange(digitRaw);
    if(range){
      out.startTime=range.startTime;
      out.endTime=range.endTime;
      out.durationHours=range.durationHours;
    } else {
      const start=extractStartTime(digitRaw);
      if(start)out.startTime=start;
    }
    // Detect clock-like tokens that look like a time but parse to an invalid
    // value (e.g. "25:90", "13:99", "30 am"). Surfacing this flag lets the
    // active workflow reject the value instead of silently skipping it and
    // continuing as if the user never supplied a time.
    const invalidClock=detectInvalidClock(digitRaw);
    if(invalidClock){
      out.invalidClockText=invalidClock.text;
      out.invalidClockReason=invalidClock.reason;
    }
    const duration=extractDuration(n);
    if(duration&&!out.durationHours)out.durationHours=duration;
    if(/\bday after tomorrow\b|\bparson\b|\bparso\b|پرسوں/.test(n))out.dateReference='day_after_tomorrow';
    else if(/\btomorrow\b|\bkal\b|کل|\bagl[aeiy]+ din\b|اگلے دن/.test(n))out.dateReference='tomorrow';
    else if(/\btoday\b|\baaj\b|آج/.test(n))out.dateReference='today';
    const weekday=DAYS.find((day)=>new RegExp(`\\b${day}\\b`).test(n));
    if(weekday)out.weekday=weekday;
    const numeric=digitRaw.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})\b/);
    if(numeric)out.dateText=`${numeric[1].padStart(2,'0')}/${numeric[2].padStart(2,'0')}/${numeric[3]}`;
    const natural=extractNaturalDate(digitRaw);
    if(natural)out.dateText=natural;
    for(const [window,aliases] of Object.entries(TIME_WINDOWS)){
      if(aliases.some(alias=>n.split(' ').includes(alias))){out.timeWindow=window;break;}
    }
    return out;
  }
}

function detectInvalidClock(raw){
  const value=String(raw||'');
  // "HH:MM" with out-of-range hours/minutes, with or without am/pm suffix.
  const matches=[...value.matchAll(/\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?/gi)];
  for(const match of matches){
    const hour=Number(match[1]);
    const minute=Number(match[2]);
    const marker=String(match[3]||'').toLowerCase().replace(/\./g,'');
    // If the match would have been accepted by parseClock, skip it; the
    // caller already gets a valid startTime. We surface only the impossible
    // tokens that parseClock silently dropped (e.g. 25:90, 13:99, 99 am).
    const parsed=parseClock(match[1],match[2],match[3]);
    if(parsed)continue;
    // Reject obviously impossible hours/minutes regardless of marker.
    if(hour<0||hour>23||minute<0||minute>59){
      return {text:match[0].trim(),reason:minute>59?'invalid_minute':'invalid_hour'};
    }
    if(marker&&(hour<1||hour>12)){
      return {text:match[0].trim(),reason:'invalid_12hour_with_marker'};
    }
  }
  return null;
}

function extractDuration(n){
  const m=n.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|ek|aik|do|teen|char|chaar|paanch)\s*(?:hours?|hrs?|hurs?|ghant(?:a|e|ay|y)?|گھنٹ[ےہ]?)\b/);
  return m?numberFromText(m[1]):null;
}
function extractTimeRange(raw){
  const value=String(raw||'');
  const romanRange=normalizeText(value).match(/\b(\d{1,2})(?::(\d{2}))?\s*(?:bjy|baje|bajay|bajy|بجے)?\s+(?:sy|se|say)\s+(\d{1,2})(?::(\d{2}))?\s*(?:bjy|baje|bajay|bajy|بجے)?(?:\s+tak)?\b/i);
  const match=value.match(/\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s+(?:to|until|till|-)\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i)
    || value.match(/\bbetween\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s+and\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i);
  if(!match&&!romanRange)return null;
  const window=normalizeText(value);
  const inferred=/\b(?:shaam|sham|evening|dopahar|dopehar|dupehar|afternoon|raat|rat|night|شام|دوپہر|رات)\b/.test(window)?'pm':/\b(?:subah|subha|morning|savere|sawere|صبح|سویرے)\b/.test(window)?'am':null;
  const start=romanRange?parseClock(romanRange[1],romanRange[2],inferred):parseClock(match[1],match[2],match[3]||match[6]||inferred);
  let end=romanRange?parseClock(romanRange[3],romanRange[4],inferred):parseClock(match[4],match[5],match[6]||match[3]||inferred);
  if(!start||!end)return null;
  // In conversational ranges such as "subha 10 bjy sy 1 bjy tak", the
  // second clock is naturally the next occurrence (13:00), not 01:00 before
  // the start. Preserve a maximum twelve-hour same-day interpretation.
  if(end.minutes<=start.minutes&&start.minutes-end.minutes<12*60){
    const adjusted=end.minutes+12*60;
    end={minutes:adjusted,value:`${String(Math.floor(adjusted/60)%24).padStart(2,'0')}:${String(adjusted%60).padStart(2,'0')}`};
  }
  const delta=end.minutes-start.minutes;
  return {startTime:start.value,endTime:end.value,durationHours:delta>0?delta/60:null};
}
function extractStartTime(raw){
  const normalized=normalizeText(raw);
  const window='(?:subah|subha|sabah|savere|sawere|savera|fajr|morning|shaam|sham|evening|dopahar|dopehar|dupehar|afternoon|raat|rat|night|صبح|سویرے|شام|دوپہر|رات)';
  const hourToken='(?:\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|ek|aik|do|teen|char|chaar|paanch|ایک|دو|تین|چار|پانچ|چھ|سات|آٹھ|نو|دس)';
  const roman=normalized.match(new RegExp(`(?:^|\\s)(${window})\\s+(${hourToken})(?::(\\d{2}))?\\s*(?:bjy|baje|bajay|bajy|بجے)?(?:$|\\s)`,'iu'))
    || normalized.match(new RegExp(`(?:^|\\s)(${hourToken})(?::(\\d{2}))?\\s*(?:bjy|baje|bajay|bajy|بجے)?\\s+(${window})(?:$|\\s)`,'iu'));
  if(roman){
    const windowFirst=!/^\d/.test(roman[0]);
    const windowValue=windowFirst?roman[1]:roman[3];
    const hour=windowFirst?roman[2]:roman[1];
    const minute=windowFirst?roman[3]:roman[2];
    const marker=/^(?:shaam|sham|evening|dopahar|dopehar|dupehar|afternoon|raat|rat|night|شام|دوپہر|رات)$/iu.test(windowValue)?'pm':'am';
    return parseClock(hour,minute,marker)?.value||null;
  }
  const match=String(raw||'').match(/\b(?:start(?:ing)?|at|from|time(?:\s+is)?|for|around|about|approximately|approx\.?)\s*(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i)
    || String(raw||'').match(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow)(?:\s+(?:on|at))?\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i)
    || String(raw||'').match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i)
    || String(raw||'').match(/\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?/i);
  if(!match)return null;
  return parseClock(match[1],match[2],match[3])?.value||null;
}
function parseClock(hourValue,minuteValue,meridiem){
  let hour=/^\d+$/.test(String(hourValue))?Number(hourValue):numberFromText(hourValue),minute=Number(minuteValue||0);
  if(!Number.isInteger(hour)||!Number.isInteger(minute)||minute<0||minute>59)return null;
  const marker=String(meridiem||'').toLowerCase().replace(/\./g,'');
  if(marker){
    if(hour<1||hour>12)return null;
    if(marker==='am'&&hour===12)hour=0;
    if(marker==='pm'&&hour!==12)hour+=12;
  } else if(hour>23)return null;
  return {minutes:hour*60+minute,value:`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`};
}
function extractNaturalDate(raw){
  const monthPattern=MONTHS.join('|');
  let m=String(raw||'').match(new RegExp(`\\b(\\d{1,2})\\s+(${monthPattern})(?:\\s+(\\d{4}))?\\b`,'i'));
  if(m)return `${Number(m[1])} ${title(m[2])}${m[3]?` ${m[3]}`:''}`;
  m=String(raw||'').match(new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?\\b`,'i'));
  if(m)return `${title(m[1])} ${Number(m[2])}${m[3]?` ${m[3]}`:''}`;
  const urduPattern=Object.keys(URDU_MONTHS).join('|');
  m=String(raw||'').match(new RegExp(`(\\d{1,2})\\s+(${urduPattern})(?:\\s+(\\d{4}))?`,'u'));
  if(m)return `${Number(m[1])} ${URDU_MONTHS[m[2]]}${m[3]?` ${m[3]}`:''}`;
  return null;
}
function title(value){const s=String(value||'').toLowerCase();return s.charAt(0).toUpperCase()+s.slice(1);}

module.exports={TemporalSemanticExtractor,extractTimeRange,extractStartTime,parseClock};
