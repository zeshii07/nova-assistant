const { normalizeText } = require('../../../packages/conversation-intelligence/src/text');
const { extractFieldAmendment } = require('../../../packages/conversation-intelligence/src/fieldAmendmentExtractor');
class CrmConversationAdapter {
  constructor(){this.capabilityId='crm';this.priority=70;}
  async analyze({message,state,services}){
    const text=normalizeText(message.text), raw=String(message.text||'');
    const candidates=[]; let entities={};
    if(/\b(what is my name|what's my name|tell me my name|mera naam kya|mera name kya)\b/.test(text))
      candidates.push({intent:'crm.ask_name',confidence:.999,entities:{},reason:'crm_name_lookup'});
    if(/\b(show my profile|show my details|my details|tell me my details|my profile|customer profile|meri profile|meri details)\b/.test(text))
      candidates.push({intent:'crm.show_profile',confidence:.98,entities:{},reason:'crm_profile_phrase'});
    const parsed=services.engagementService?.parseDeclaredName?.(raw);
    const active=state.capabilityState?.booking?.status==='collecting'||state.capabilityState?.commerce?.mode==='checkout'||Boolean(state.capabilityState?.cleaning?.step);
    const pendingFieldEdit=state.capabilityState?.crm?.pendingFieldEdit||null;
    const explicitFieldAmendment=extractFieldAmendment(raw,{allowedFields:['name','phone','email','address']});
    const fieldAmendment=explicitFieldAmendment||(pendingFieldEdit
      ? {field:pendingFieldEdit.field,rawValue:raw,action:'replace',explicit:true}
      : null);
    if(fieldAmendment&&!active){
      entities={fieldAmendment};
      candidates.push({intent:'crm.customer_field_edit',confidence:1,priority:180,entities,reason:pendingFieldEdit?'pending_crm_field_edit_value':'explicit_crm_field_edit'});
      return {priority:this.priority,candidates,entities,vocabularyMatches:[{type:'customer_field_edit',value:fieldAmendment.field,score:1}]};
    }
    const mixedTask=/\b(can i|get|book|reserve|schedule|order|buy|cleaner|cleaning|appointment|reservation|table|product|service|shoes?|shirt|hair ?cut|menu|takeaway)\b/i.test(raw)
      || /\b(who are you|what are you|what is your name|what's your name)\b/i.test(raw);
    if(parsed?.valid && !active && !mixedTask){
      entities={name:parsed.value};
      candidates.push({intent:'crm.update_name',confidence:.997,entities,reason:'crm_name_phrase'});
    }
    return {priority:this.priority,candidates,entities,vocabularyMatches:[]};
  }
}
module.exports={CrmConversationAdapter};
