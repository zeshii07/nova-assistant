const {normalizeText}=require('./text');
const {isConfirmation}=require('./confirmation');

class WorkflowOwnershipEngine {
  resolve({state,message,selected,interruption=null}){
    const text=normalizeText(message?.text);
    const commerce=state?.capabilityState?.commerce||{};
    const booking=state?.capabilityState?.booking||{};
    const cleaning=state?.capabilityState?.cleaning||{};

    // Confirmation words belong to the active transaction, not a product draft.
    if(commerce.mode==='paused_add_item' && isConfirmation(text))
      return {capabilityId:'commerce',intent:'commerce.confirm',confidence:.99995,reason:'workflow_owner_paused_add_item_confirm',entities:{}};
    if(commerce.mode==='review' && isConfirmation(text))
      return {capabilityId:'commerce',intent:'commerce.review.confirm',confidence:.99995,reason:'workflow_owner_checkout_review_confirm',entities:{}};
    if(commerce.mode==='checkout' && commerce.pendingField && isConfirmation(text))
      return {capabilityId:'commerce',intent:'commerce.checkout_continue',confidence:.99995,reason:'workflow_owner_checkout_continue',entities:{pendingField:commerce.pendingField}};

    // Generic active booking/cleaning confirmation ownership.
    if(booking.status==='ready' && isConfirmation(text))
      return {capabilityId:'booking',intent:'booking.confirm',confidence:.99995,reason:'workflow_owner_booking_confirm',entities:{}};
    if(cleaning.step==='confirm' && isConfirmation(text))
      return {capabilityId:'cleaning',intent:'cleaning.workflow_input',confidence:.99995,reason:'workflow_owner_cleaning_confirm',entities:{}};

    // Identity/profile lookup is always a side question, never a value for an
    // active checkout/booking field. Preserve the workflow and let CRM answer.
    if(/\b(what is my name|what's my name|tell me my name|mera naam (?:kya|kia)|mera name (?:kya|kia))\b/.test(text))
      return {capabilityId:'crm',intent:'crm.ask_name',confidence:1,reason:'profile_question_interrupts_active_workflow',entities:{}};

    // A side question is allowed to route elsewhere; the execution engine
    // appends a resume prompt without destroying the owner state.
    if(interruption && selected) return selected;
    return selected;
  }
}
const isConfirm=isConfirmation;
module.exports={WorkflowOwnershipEngine,isConfirm};
