const {normalizeText}=require('./text');
function isConfirmation(value){
 const t=normalizeConfirmationTypos(normalizeText(value)).replace(/\b(?:please|pls|plz|bhai|bhaijan|bhai jan|jan|jaan|sir|g|ji|jee|yar|yaar|ok|okay)\b/g,' ').replace(/\s+/g,' ').trim();
 if(/^(yes|yeah|yep|done|final|confirm|confirmed|place order|confirm order|confirm my order|order confirm|pakka|haan|han)$/i.test(t))return true;
 if(/\bconfirm\b/.test(t)&&/\b(kro|karo|kar do|kar dein|kr do|kr dein|order)?\b/.test(t))return true;
 if(/\border\b.*\b(confirm|pakka|kro|karo)\b/.test(t))return true;
 if(/\b(confirm|pakka)\b.*\border\b/.test(t))return true;
 return false;
}

// Keep typo handling deliberately bounded. These are common adjacent-letter
// mistakes for the workflow keyword, not a general fuzzy matcher that could
// turn an unrelated customer message into a destructive confirmation.
function normalizeConfirmationTypos(value){
 return String(value||'').replace(/\b(?:confim|confrim|cnfirm|conirm|cofirm|confirmm)\b/g,'confirm');
}

function isWorkflowAcceptance(value){
 const raw=normalizeText(value);
 if(isConfirmation(raw))return true;
 const t=raw.replace(/\b(?:please|pls|plz|bhai|bhaijan|bhai jan|jan|jaan|sir|g|ji|jee|yar|yaar)\b/g,' ').replace(/\s+/g,' ').trim();
 return /^(?:ok|okay|theek|thik|theek hai|thik hai|ok theek hai|ok thik hai|add kro|add karo|add kar do|add kr do|ok add kro|ok add karo|ok add kar do|ok add kr do|theek hai add kro|thik hai add kro|kar do|kr do|haan theek hai|han theek hai|haan kar do|han kar do|(?:ok\s+)?(?:theek|thik)(?:\s+hai)?\s+(?:bhej|bhyj|bhj|send|mangwa)\s+do|(?:order\s+)?(?:bhej|bhyj|bhj|send|mangwa)\s+do|place it|send it)$/i.test(t);
}
module.exports={isConfirmation,isWorkflowAcceptance,normalizeConfirmationTypos};
