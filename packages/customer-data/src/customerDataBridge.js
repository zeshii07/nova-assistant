
/**
 * Central customer-data bridge.
 *
 * Any capability may collect customer identity/contact fields through the
 * standard capability-state contract. The Execution Engine calls this bridge
 * after successful capability execution so CRM persistence is not duplicated
 * inside every domain capability.
 */
class CustomerDataBridge {
  constructor({crmService,engagementService=null,logger=null}){Object.assign(this,{crmService,engagementService,logger});}

  async sync({tenantId,customerId,channel='unknown',language=null,result=null}){
    if(!this.crmService||!tenantId||!customerId||!result)return null;
    const patch=this.extractProfilePatch(result);
    if(language)patch.preferredLanguage=language;
    if(!Object.keys(patch).length)return null;
    try{
      const current=await this.crmService.ensureCustomer({tenantId,customerId,channel,preferredLanguage:language});
      const customFields={...(current?.customFields||{})};
      const location={...(customFields.lastKnownLocation||{})};
      for(const k of ['city','address','landmark'])if(patch[k]){location[k]=patch[k];delete patch[k];}
      if(Object.keys(location).length)customFields.lastKnownLocation=location;
      if(Object.keys(customFields).length)patch.customFields=customFields;
      return await this.crmService.updateCustomerProfile({tenantId,customerId,...patch});
    }catch(error){
      this.logger?.warn?.('customer_data_bridge.sync_failed',{tenantId,customerId,error:error.message});
      return null; // CRM synchronization must never break the customer workflow.
    }
  }

  extractProfilePatch(result){
    const out={};
    const cap=result?.statePatch?.capabilityState||{};
    for(const state of Object.values(cap)){
      if(!state||typeof state!=='object'||Array.isArray(state))continue;
      this.takeScalarFields(out,state);
      for(const bag of ['fields','slots','customer','checkout','contact','profile']){
        if(state[bag]&&typeof state[bag]==='object'&&!Array.isArray(state[bag]))this.takeScalarFields(out,state[bag]);
      }
    }
    // Generic transaction payloads may expose a validated customer/slots object
    // even after capability state is cleared on completion.
    const payload=result?.responseModel?.payload||{};
    for(const bag of ['customer','slots','fields','contact']){
      if(payload[bag]&&typeof payload[bag]==='object'&&!Array.isArray(payload[bag]))this.takeScalarFields(out,payload[bag]);
    }
    return out;
  }

  takeScalarFields(out,obj){
    const map={name:'name',fullName:'name',customerName:'name',patientName:'name',parentName:'name',
      phone:'phone',contactNumber:'phone',phoneNumber:'phone',email:'email',
      city:'city',address:'address',serviceAddress:'address',deliveryAddress:'address',landmark:'landmark'};
    for(const [from,to] of Object.entries(map)){
      const value=obj?.[from];
      if(typeof value!=='string'||!value.trim())continue;
      const options=to==='phone'?{minDigits:10,maxDigits:15}:{};
      const parsed=this.engagementService?.parseField?.(to,value,options);
      if(parsed?.valid)out[to]=parsed.value;
      else if(!this.engagementService)out[to]=value.trim();
    }
  }
}
module.exports={CustomerDataBridge};
