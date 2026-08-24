const {normalizeWeekdayTypos}=require('./text');
const DAYS=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const CONSTRAINT_VOCAB=['weekend','week','weekly','booking','bookings','same','day','sunday','saturday','monday','tuesday','wednesday','thursday','friday','monthly','daily','recurring','twice','once'];
function extractServiceConstraints(value){
  const text=normalizeConstraintText(value);
  const day=DAYS.find(d=>new RegExp(`\\b${d}\\b`).test(text))||null;
  const weekend=/\bweekends?\b|\bweek end\b/.test(text);
  const sameDay=/\bsame day\b|\btoday\b|\baaj\b/.test(text);
  const recurrence=parseRecurrence(text);
  const conditions={
    pet:/\b(pet|dog|cat|animal)\b/.test(text),
    parking:/\bparking\b/.test(text),
    materials:/\b(materials?|supplies|cleaning products?|equipment)\b/.test(text),
    customerPresence:/\b(present|stay home|at home during|be at home|remain at home)\b/.test(text),
    furniture:/\b(wardrobe|heavy furniture|move furniture)\b/.test(text),
    balcony:/\bbalcony|terrace\b/.test(text),
    window:/\bwindows?|window cleaning\b/.test(text)
  };
  return {text,day,weekend,sameDay,recurrence,conditions};
}
function normalizeConstraintText(value){
  let text=normalizeWeekdayTypos(String(value||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim());
  const direct={dy:'day',wk:'week',wks:'weeks',weak:'week',weeekend:'weekend',weeknd:'weekend',bookigs:'bookings',bookng:'booking',recurng:'recurring'};
  const words=text.split(' ').map(word=>{
    if(direct[word])return direct[word];
    if(word.length<4)return word;
    let best=word,bestD=2;
    for(const target of CONSTRAINT_VOCAB){
      if(Math.abs(target.length-word.length)>1)continue;
      const d=editDistance(word,target);
      if(d<bestD){best=target;bestD=d;}
    }
    return bestD<=1?best:word;
  });
  return words.join(' ');
}
function parseRecurrence(input){
  const text=normalizeConstraintText(input);
  let frequency=null,occurrencesPerWeek=null,intervalWeeks=null;
  let m=text.match(/\b(once|twice|three|four|1|2|3|4)\s+(?:times?\s+)?(?:a|per)\s+week\b/);
  if(m){frequency='weekly';occurrencesPerWeek=wordNumber(m[1]);intervalWeeks=1;}
  if(!frequency&&/\b(daily|every day)\b/.test(text))frequency='daily';
  if(!frequency&&/\b(weekly|every week|each week)\b/.test(text)){frequency='weekly';occurrencesPerWeek=occurrencesPerWeek||1;intervalWeeks=1;}
  if(!frequency&&/\b(bi weekly|fortnightly|every two weeks|every 2 weeks)\b/.test(text)){frequency='biweekly';intervalWeeks=2;}
  if(!frequency&&/\b(monthly|every month|each month|recurring.*for month)\b/.test(text))frequency='monthly';
  if(!frequency&&/\brecurr(?:ing|ence)|regular(?:ly)?|repeat(?:ed|ing)?\b/.test(text))frequency='recurring';
  return frequency?{frequency,occurrencesPerWeek,intervalWeeks}:null;
}
function editDistance(a,b){const m=a.length,n=b.length,dp=Array(n+1).fill(0).map((_,i)=>i);for(let i=1;i<=m;i++){let prev=dp[0];dp[0]=i;for(let j=1;j<=n;j++){const tmp=dp[j];dp[j]=a[i-1]===b[j-1]?prev:1+Math.min(prev,dp[j],dp[j-1]);prev=tmp;}}return dp[n];}
function wordNumber(v){return ({once:1,twice:2,three:3,four:4})[v]||Number(v)||1;}
function describeRecurrence(r){if(!r)return null;if(r.frequency==='weekly'&&r.occurrencesPerWeek>1)return `${r.occurrencesPerWeek} times per week`;if(r.frequency==='weekly')return 'weekly';if(r.frequency==='biweekly')return 'every two weeks';if(r.frequency==='monthly')return 'monthly';if(r.frequency==='daily')return 'daily';return 'recurring';}
module.exports={extractServiceConstraints,normalizeConstraintText,parseRecurrence,describeRecurrence,DAYS};
