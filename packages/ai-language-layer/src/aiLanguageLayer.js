const {LanguageContractBuilder}=require('./languageContract');

class AiLanguageLayer{
  constructor({interpreter=null,strategy='adaptive',contractBuilder=new LanguageContractBuilder(),logger=null}={}){
    if(!['adaptive','primary'].includes(strategy))throw new Error('AI language strategy must be adaptive or primary');
    this.interpreter=interpreter;
    this.strategy=strategy;
    this.contractBuilder=contractBuilder;
    this.logger=logger;
  }

  isEnabled(tenant){return Boolean(this.interpreter?.isEnabled?.(tenant));}
  strategyFor(tenant){
    const configured=String(tenant?.features?.nluStrategy||this.strategy).toLowerCase();
    return ['adaptive','primary'].includes(configured)?configured:this.strategy;
  }
  shouldInterpretFirst(tenant){return this.strategyFor(tenant)==='primary'&&this.isEnabled(tenant);}

  async interpret({tenant,message,state,services,pending}){
    let nlu;
    try{nlu=await this.interpreter.interpret({tenant,message,state,services,pending});}
    catch(error){
      this.logger?.error?.('ai_language_layer.failed',{error:error.message});
      nlu={used:true,validated:false,interpretation:null,error:'interpreter_failed',mode:this.interpreter?.mode||'on'};
    }
    return {...nlu,contract:this.contractBuilder.build({nlu,pending})};
  }
}

module.exports={AiLanguageLayer};
