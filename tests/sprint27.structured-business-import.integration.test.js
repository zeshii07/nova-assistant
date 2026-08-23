const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'); const path=require('path');
const {importBusinessFile}=require('../packages/tenant-onboarding/src/businessFileImporter');
const {UniversalTenantOnboardingService}=require('../packages/tenant-onboarding/src/universalTenantOnboardingService');
const {buildContainer}=require('../apps/api/src/container');

const tenantsDir=path.join(__dirname,'..','tenants');
const tenantId='structured-karyana-regression';
const tenantDir=path.join(tenantsDir,tenantId);

const businessJson={
  id:tenantId,
  name:'Shoaib Karyana Store Test',
  domain:'grocery_and_karyana',
  description:'Local daily essentials, grocery, household items, and home delivery service.',
  hours:'Monday to Sunday, 7 AM to 11 PM',
  location:'Muzaffargarh, Pakistan',
  contact:'+92 300 7654321',
  offerings:[
    {name:'Super Basmati Rice (1kg)',type:'product',category:'grains_and_staples',description:'Premium quality long-grain Super Basmati rice.',price:340,unit:'kg',inStock:true,orderable:true,aliases:['basmati chawal','rice 1kg','chawal','super basmati']},
    {name:'White Sugar / Cheeni (1kg)',type:'product',category:'cooking_essentials',description:'Clean white refined sugar.',price:150,unit:'kg',inStock:true,orderable:true,aliases:['cheeni','chini','sugar']},
    {name:"Olper's Milk Tetra Pack (1 Litre)",type:'product',category:'dairy',description:'UHT processed full cream milk.',price:290,unit:'pack',inStock:true,orderable:true,aliases:['doodh','milk box','olpers milk']},
    {name:'Home Grocery Delivery',type:'service',category:'delivery',description:'Doorstep delivery service within local city limits.',price:100,durationMinutes:45,bookable:true,orderable:false,aliases:['home delivery','ghar pe delivery']}
  ],
  faqs:[{question:'Do you offer home delivery?',answer:'Yes, we offer doorstep delivery within local limits.'}]
};

test.before(()=>{
  fs.rmSync(tenantDir,{recursive:true,force:true});
  const imported=importBusinessFile({name:'shoaib-karyana.json',text:JSON.stringify(businessJson)});
  assert.equal(imported.spec.offerings.length,4);
  assert.equal(imported.spec.faqs.length,1);
  new UniversalTenantOnboardingService({tenantsDir}).create({...imported.spec,overwrite:true});
});
test.after(()=>fs.rmSync(tenantDir,{recursive:true,force:true}));

test('structured business JSON generates native catalog, categories, synonyms, and booking config',()=>{
  const products=JSON.parse(fs.readFileSync(path.join(tenantDir,'catalog','products.json'),'utf8'));
  const categories=JSON.parse(fs.readFileSync(path.join(tenantDir,'catalog','categories.json'),'utf8'));
  const synonyms=JSON.parse(fs.readFileSync(path.join(tenantDir,'catalog','synonyms.json'),'utf8'));
  assert.equal(products.length,3);
  assert.equal(products[0].inventory,undefined);
  assert.equal(products[0].metadata.unit,'kg');
  assert.ok(categories.some(x=>x.name==='grains_and_staples'));
  assert.ok(Object.values(synonyms).some(xs=>Array.isArray(xs)&&xs.includes('chawal')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(tenantDir,'booking','config.json'),'utf8')).enabled,true);
});


test('overwrite performs a clean tenant rebuild so stale raw knowledge cannot survive',()=>{
  const stale=path.join(tenantDir,'knowledge','documents','old-raw.json');
  fs.mkdirSync(path.dirname(stale),{recursive:true});fs.writeFileSync(stale,'{"offerings":"stale"}');
  const imported=importBusinessFile({name:'shoaib-karyana.json',text:JSON.stringify(businessJson)});
  new UniversalTenantOnboardingService({tenantsDir}).create({...imported.spec,overwrite:true});
  assert.equal(fs.existsSync(stale),false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tenantDir,'catalog','products.json'),'utf8')).length,3);
});

test('new Karyana tenant answers catalog questions from native products instead of echoing uploaded JSON',async()=>{
  const c=await buildContainer();
  const a=await c.executionEngine.process({tenantId,channel:'structured-import',customerId:'buyer1',text:'what products do you have'});
  assert.equal(a.capabilityId,'catalog');
  assert.match(a.reply,/Super Basmati Rice/i);
  assert.match(a.reply,/White Sugar/i);
  assert.doesNotMatch(a.reply,/"offerings"\s*:/i);

  for(const [index,text] of ['do you have rice','can i get rice here','what products do you offer','what products do you sell'].entries()){
    const b=await c.executionEngine.process({tenantId,channel:'structured-import',customerId:`buyer-${index+2}`,text});
    assert.equal(b.capabilityId,'catalog',text);
    assert.match(b.reply,/Super Basmati Rice/i,text);
    assert.doesNotMatch(b.reply,/"id"\s*:/i,text);
  }
});
