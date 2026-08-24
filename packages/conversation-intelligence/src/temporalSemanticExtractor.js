const { normalizeText, numberFromText, normalizeWeekdayTypos } = require('./text');

const MONTHS='january february march april may june july august september october november december'.split(' ');
const DAYS='monday tuesday wednesday thursday friday saturday sunday'.split(' ');

/** Extracts universal date/time structure without making availability claims. */
class TemporalSemanticExtractor {
  extract(value) {
    const raw=String(value||'');
    const n=normalizeWeekdayTypos(raw);
    const out={version:'1.0'};
    const range=extractTimeRange(raw);
    if(range){
      out.startTime=range.startTime;
      out.endTime=range.endTime;
      out.durationHours=range.durationHours;
    } else {
      const start=extractStartTime(raw);
      if(start)out.startTime=start;
    }
    const duration=extractDuration(n);
    if(duration&&!out.durationHours)out.durationHours=duration;
    if(/\btomorrow\b|\bkal\b|کل/.test(n))out.dateReference='tomorrow';
    else if(/\btoday\b|\baaj\b|آج/.test(n))out.dateReference='today';
    const weekday=DAYS.find((day)=>new RegExp(`\\b${day}\\b`).test(n));
    if(weekday)out.weekday=weekday;
    const natural=extractNaturalDate(raw);
    if(natural)out.dateText=natural;
    if(/\bmorning\b|subah|صبح/.test(n))out.timeWindow='morning';
    else if(/\bafternoon\b|dopahar|دوپہر/.test(n))out.timeWindow='afternoon';
    else if(/\bevening\b|shaam|شام/.test(n))out.timeWindow='evening';
    return out;
  }
}

function extractDuration(n){
  const m=n.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|ek|aik|do|teen|char|chaar|paanch)\s*(?:hours?|hrs?|hurs?|ghant(?:a|e|ay|y)?|گھنٹ[ےہ]?)\b/);
  return m?numberFromText(m[1]):null;
}
function extractTimeRange(raw){
  const value=String(raw||'');
  const match=value.match(/\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s+(?:to|until|till|-)\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i)
    || value.match(/\bbetween\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s+and\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i);
  if(!match)return null;
  const start=parseClock(match[1],match[2],match[3]||match[6]);
  const end=parseClock(match[4],match[5],match[6]||match[3]);
  if(!start||!end)return null;
  const delta=end.minutes-start.minutes;
  return {startTime:start.value,endTime:end.value,durationHours:delta>0?delta/60:null};
}
function extractStartTime(raw){
  const roman=String(raw||'').match(/\b(?:subah|subha|sabah|savere|sawere|morning|shaam|sham|evening|dopahar|afternoon)\s+(\d{1,2})(?::(\d{2}))?\s*(?:bjy|baje|bajay)?\b/i);
  if(roman){
    const marker=/^(?:shaam|sham|evening|dopahar|afternoon)$/i.test((roman[0].match(/^\w+/)||[])[0]||'')?'pm':'am';
    return parseClock(roman[1],roman[2],marker)?.value||null;
  }
  const match=String(raw||'').match(/\b(?:start(?:ing)?|at|from|time(?:\s+is)?|for|around|about|approximately|approx\.?)\s*(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i)
    || String(raw||'').match(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow)(?:\s+(?:on|at))?\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i)
    || String(raw||'').match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i)
    || String(raw||'').match(/\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?/i);
  if(!match)return null;
  return parseClock(match[1],match[2],match[3])?.value||null;
}
function parseClock(hourValue,minuteValue,meridiem){
  let hour=Number(hourValue),minute=Number(minuteValue||0);
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
  return null;
}
function title(value){const s=String(value||'').toLowerCase();return s.charAt(0).toUpperCase()+s.slice(1);}

module.exports={TemporalSemanticExtractor,extractTimeRange,extractStartTime,parseClock};
