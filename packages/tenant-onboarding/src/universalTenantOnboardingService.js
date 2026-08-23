
const fs=require('fs'); const path=require('path');
function slug(v){return String(v||'tenant').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'tenant';}
function writeJson(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n');}
function uniq(xs){return [...new Set(xs.filter(Boolean))];}
class UniversalTenantOnboardingService{
 constructor({tenantsDir,knowledgeRepository=null,tenantRepository=null}){this.tenantsDir=tenantsDir;this.knowledgeRepository=knowledgeRepository;this.tenantRepository=tenantRepository;}
 create(spec){
  if(!spec?.name)throw new Error('Tenant name is required');
  const id=spec.id||slug(spec.name); const dir=path.join(this.tenantsDir,id);
  if(fs.existsSync(dir)&&!spec.overwrite)throw new Error(`Tenant '${id}' already exists`);
  if(fs.existsSync(dir)&&spec.overwrite)fs.rmSync(dir,{recursive:true,force:true});
  const offerings=Array.isArray(spec.offerings)?spec.offerings:[];
  const products=offerings.filter(x=>(x.type||'service')==='product');
  const services=offerings.filter(x=>(x.type||'service')!=='product');
  const commerce=products.length>0, booking=services.some(x=>x.bookable!==false);
  const capabilities=uniq(['assistant','crm', commerce&&'catalog',commerce&&'commerce',services.length&&'offering',services.length&&'pricing',services.length&&'availability',booking&&'booking']);
  const permissions=['knowledge.read','memory.read:assistant','memory.write:assistant','memory.delete:assistant','crm.customer.read:assistant','crm.customer.write:assistant','crm.activity.write:assistant','crm.customer.read:crm','crm.customer.write:crm','crm.note.write:crm','crm.tag.write:crm','crm.activity.read:crm','crm.activity.write:crm'];
  if(services.length)permissions.push('offering.read:offering','offering.read:pricing','offering.read:availability');
  if(commerce)permissions.push('catalog.search:catalog','catalog.read:catalog','memory.read:catalog','memory.write:catalog','crm.activity.write:catalog','commerce.write:catalog','commerce.read:commerce','commerce.write:commerce','commerce.order.create:commerce','commerce.order.update:commerce','catalog.read:commerce','memory.read:commerce','memory.write:commerce','crm.customer.read:commerce','crm.customer.write:commerce','crm.activity.write:commerce');
  if(booking)permissions.push('booking.read:booking','booking.write:booking','offering.read:booking');
  const profile={
   status:'active',defaultLanguage:spec.defaultLanguage||'english',capabilities,features:{llmFallback:spec.llmFallback!==false},
   permissions,id,name:spec.name,domain:spec.domain||'generic',
   branding:{assistantName:spec.assistantName||`${spec.name} Assistant`,welcomeMessage:spec.welcomeMessage||`Hello! 😊 I’m the ${spec.assistantName||`${spec.name} Assistant`}. How can I help you today?`},
   business:{description:spec.description||'',contact:spec.contact||''}
  };
  writeJson(path.join(dir,'profile.json'),profile);
  writeJson(path.join(dir,'knowledge','business.json'),{
   name:spec.name,description:spec.description||'',hours:spec.hours||'',location:spec.location||'',contact:spec.contact||'',
   services:services.map(x=>x.name),paymentMethods:spec.paymentMethods||[],...(spec.businessFacts||{})
  });
  writeJson(path.join(dir,'knowledge','faqs.json'),spec.faqs||[]);
  fs.mkdirSync(path.join(dir,'knowledge','documents'),{recursive:true});
  if(services.length)writeJson(path.join(dir,'offerings','items.json'),services.map((x,i)=>({
   id:x.id||slug(x.name)||`service-${i+1}`,name:x.name,aliases:x.aliases||[],type:x.type||'service',category:x.category||'general',
   description:x.description||'',...(x.price!=null?{price:x.price}:{}),...(x.durationMinutes?{durationMinutes:x.durationMinutes}:{}),bookable:x.bookable!==false
  })));
  if(services.length)writeJson(path.join(dir,'availability','services.json'),spec.availability||{
   rules:services.map(x=>({serviceId:x.id||slug(x.name),label:x.name,supported:true,aliases:x.aliases||[]}))
  });
  if(services.length)writeJson(path.join(dir,'pricing','services.json'),spec.pricing||{
   currency:spec.currency||'USD',
   services:services.map(x=>x.pricing?{id:x.id||slug(x.name),name:x.name,aliases:x.aliases||[],currency:x.currency||spec.currency||'USD',...x.pricing}:null).filter(Boolean),
   discounts:spec.discounts||[]
  });
  if(booking)writeJson(path.join(dir,'booking','config.json'),{
   enabled:true,mode:spec.bookingMode||'appointment',defaultSubject:null,
   triggerTerms:['book','appointment','reserve','schedule','can i get','i want','need'],
   requiredFields:spec.bookingFields||['subject','date','time','name','phone'],
   confirmedLabel:spec.confirmedLabel||'Booking request received',readyLabel:spec.readyLabel||'Your booking request is ready',
   confirmPrompt:'Confirm this booking request when you are ready.',
   prompts:{subject:'What would you like to book?',date:'What date would you prefer?',time:'What time would you prefer?',name:'May I have your full name?',phone:'What is the best contact phone number to reach you on?'}
  });
  if(booking)writeJson(path.join(dir,'calendar','config.json'),spec.calendar||{
   enabled:spec.calendarEnabled!==false,provider:spec.calendarEnabled===false?'disabled':'local',timezone:spec.timezone||process.env.NOVA_DEFAULT_TIMEZONE||'Asia/Karachi',
   defaultDurationMinutes:Number(spec.defaultDurationMinutes||60),slotIntervalMinutes:Number(spec.slotIntervalMinutes||30),holdTtlSeconds:Number(spec.holdTtlSeconds||600),
   minLeadMinutes:Number(spec.minLeadMinutes||0),maxAdvanceDays:Number(spec.maxAdvanceDays||365),
   resourcePools:spec.calendarEnabled===false?[]:[{id:'default',name:'Default scheduling capacity',capacity:Number(spec.calendarCapacity||1),serviceIds:[],active:true}],
   serviceRules:services.filter(x=>x.bookable!==false).map(x=>({serviceId:x.id||slug(x.name),poolId:'default',durationMinutes:Number(x.durationMinutes||spec.defaultDurationMinutes||60),capacityRequired:1}))
  });
  if(commerce){
   const nativeProducts=products.map((x,i)=>({
    id:x.id||`P${String(i+1).padStart(3,'0')}`,sku:x.sku||slug(x.name).toUpperCase(),name:x.name,category:x.category||'general',
    price:Number(x.price||0),currency:x.currency||spec.currency||'PKR',description:x.description||'',aliases:x.aliases||[],
    sizes:x.sizes||[],colors:x.colors||[],tags:x.tags||[],inStock:x.inStock!==false,
    ...(x.inventory!==undefined&&x.inventory!==null&&x.inventory!==''?{inventory:Number(x.inventory)}:{}),
    metadata:{...(x.metadata||{}),...(x.unit?{unit:x.unit}:{}),orderable:x.orderable!==false}
   }));
   writeJson(path.join(dir,'catalog','products.json'),nativeProducts);
   const cats=[...new Set(nativeProducts.map(x=>x.category).filter(Boolean))].map((name,index)=>({id:slug(name)||`category-${index+1}`,name}));
   writeJson(path.join(dir,'catalog','categories.json'),cats);
   const synonyms={};
   for(const item of nativeProducts){
    const canonical=String(item.name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    if((item.aliases||[]).length)synonyms[canonical]=[...item.aliases];
   }
   writeJson(path.join(dir,'catalog','synonyms.json'),synonyms);
  }
  this.knowledgeRepository?.clearCache?.(id);this.tenantRepository?.clearCache?.(id);
  return {id,dir,profile,summary:{products:products.length,services:services.length,bookingEnabled:booking,commerceEnabled:commerce}};
 }
}
module.exports={UniversalTenantOnboardingService,slug};
