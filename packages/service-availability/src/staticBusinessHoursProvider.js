const DAYS=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
class StaticBusinessHoursProvider{
  constructor({knowledgeRepository,controlPlaneRepository=null}){this.knowledgeRepository=knowledgeRepository;this.controlPlaneRepository=controlPlaneRepository;}
  check({tenantId,day}){
    const data=this.knowledgeRepository.getForTenant(tenantId);
    const published=this.controlPlaneRepository?.getPublished(tenantId,'hours')?.document||null;
    if(published?.schedule)return checkStructuredSchedule(published,day);
    const hours=published?.text||data?.business?.hours||'';
    const parsed=parseHours(hours);
    if(!day)return {source:'business_hours',status:'unknown',hours};
    const key=String(day).toLowerCase();
    const row=parsed[key];
    if(row?.open)return {source:'business_hours',status:'open',day:key,hours:row.label};
    if(row?.open===false)return {source:'business_hours',status:'closed',day:key,hours:null};
    return {source:'business_hours',status:'unknown',day:key,hours};
  }
}
function checkStructuredSchedule(document,day){
  const key=String(day||'').toLowerCase(),intervals=document.schedule?.[key];
  if(!day)return {source:'control_plane_hours',status:'unknown',hours:document};
  if(!Array.isArray(intervals)||!intervals.length)return {source:'control_plane_hours',status:'closed',day:key,hours:null,timezone:document.timezone||null};
  const label=intervals.map(interval=>`${formatClock(interval.open)} to ${formatClock(interval.close)}`).join(', ');
  return {source:'control_plane_hours',status:'open',day:key,hours:label,timezone:document.timezone||null};
}
function formatClock(value){const [h,m]=String(value).split(':').map(Number),period=h>=12?'PM':'AM',hour=h%12||12;return `${hour}${m?`:${String(m).padStart(2,'0')}`:''} ${period}`;}
function parseHours(text){
  const out=Object.fromEntries(DAYS.map(d=>[d,{open:false,label:null}]));
  const t=String(text||'').trim(); if(!t)return {};
  const daily=t.match(/^(?:daily|every\s+day|seven\s+days(?:\s+a\s+week)?)\s*,?\s*(.+)$/i);
  if(daily){for(const day of DAYS)out[day]={open:true,label:daily[1].trim()};return out;}
  const m=t.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+to\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*,?\s*(.+)$/i);
  if(m){
    const a=DAYS.indexOf(m[1].toLowerCase()),b=DAYS.indexOf(m[2].toLowerCase()),label=m[3].trim();
    let i=a;for(let guard=0;guard<7;guard++){out[DAYS[i]]={open:true,label};if(i===b)break;i=(i+1)%7;}
    return out;
  }
  for(const day of DAYS){
    const dm=t.match(new RegExp(`${day}\\s*[:,]?\\s*([^;|]+)`,'i'));
    if(dm)out[day]={open:!/closed/i.test(dm[1]),label:/closed/i.test(dm[1])?null:dm[1].trim()};
  }
  return out;
}
module.exports={StaticBusinessHoursProvider,parseHours,DAYS};
