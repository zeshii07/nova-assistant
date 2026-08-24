const $=id=>document.getElementById(id);const chat=$('chat');let last=null;$('devtoken').value=localStorage.getItem('novaDevToken')||'';$('devtoken').addEventListener('change',()=>localStorage.setItem('novaDevToken',$('devtoken').value));$('cpActor').value=localStorage.getItem('novaControlPlaneActor')||'local-developer';$('cpRole').value=localStorage.getItem('novaControlPlaneRole')||'owner';$('cpActor').addEventListener('change',()=>localStorage.setItem('novaControlPlaneActor',$('cpActor').value));$('cpRole').addEventListener('change',()=>localStorage.setItem('novaControlPlaneRole',$('cpRole').value));const headers=()=>({'content-type':'application/json','x-nova-tenant-id':$('tenant').value,'x-nova-actor-id':$('cpActor').value.trim()||'local-developer','x-nova-role':$('cpRole').value,...( $('devtoken').value?{'x-nova-dev-token':$('devtoken').value}:{} )});
function add(role,text,meta=''){const b=document.createElement('div');b.className=`bubble ${role}`;b.textContent=text;chat.appendChild(b);if(meta){const m=document.createElement('div');m.className='meta';m.textContent=meta;b.appendChild(m)}chat.scrollTop=chat.scrollHeight}
function show(result){last=result;const i=result.intelligence||{};$('selected').textContent=json(i.selected);$('entities').textContent=json(i.entities);$('messageframe').textContent=json(i.messageFrame);$('nlu').textContent=json({...i.nlu,requiresClarification:i.requiresClarification,clarificationReason:i.clarificationReason});$('workflow').textContent=json(i.workflow);$('goal').textContent=json(i.goal||result.state?.context?.goal);$('social').textContent=json(i.social);$('semantic').textContent=json(i.semantic);$('domain').textContent=json(i.domain);$('timing').textContent=json({intelligenceMs:i.timingMs,totalReplayId:result.replayId});$('vocabulary').textContent=json(i.vocabularyMatches);$('candidates').textContent=json(i.candidates);$('statejson').textContent=json(result.state)}
async function send(text){add('user',text);const body={tenantId:$('tenant').value,customerId:$('customer').value,text,channel:'playground'};const r=await fetch('/api/dev/chat',{method:'POST',headers:headers(),body:JSON.stringify(body)});const data=await r.json();if(!data.ok&&data.error){add('bot',`ERROR: ${data.error}`);return}add('bot',data.reply,`${data.capabilityId||'none'} · replay ${data.replayId||'—'}`);show(data)}
$('composer').addEventListener('submit',e=>{e.preventDefault();const t=$('message').value.trim();if(t){$('message').value='';send(t)}});document.querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>send(b.dataset.q));
$('reset').onclick=async()=>{await fetch('/api/dev/reset',{method:'POST',headers:headers(),body:JSON.stringify({tenantId:$('tenant').value,customerId:$('customer').value,channel:'playground'})});chat.innerHTML='';['selected','entities','messageframe','nlu','workflow','goal','social','semantic','domain','timing','vocabulary','candidates','statejson'].forEach(x=>$(x).textContent='—')};
$('freshTest').onclick=async()=>{if(!confirm('Start a fresh test? This clears the active cart for this tenant/customer but preserves CRM, orders, bookings, and service history.'))return;await fetch('/api/dev/reset',{method:'POST',headers:headers(),body:JSON.stringify({tenantId:$('tenant').value,customerId:$('customer').value,channel:'playground',clearCart:true})});chat.innerHTML='';add('bot','Fresh test started. Conversation state and the active cart were cleared; history remains intact.');['selected','entities','messageframe','nlu','workflow','goal','social','semantic','domain','timing','vocabulary','candidates','statejson'].forEach(x=>$(x).textContent='—')};
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab,.tabbody').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(b.dataset.tab).classList.add('active')});
$('refreshReplays').onclick=loadReplays;async function loadReplays(){const r=await fetch('/api/dev/replays?limit=30',{headers:headers()});const d=await r.json();const box=$('replays');box.innerHTML='';(d.replays||[]).forEach(x=>{const el=document.createElement('div');el.className='replay-item';el.textContent=`${x.createdAt} · ${x.tenantId} · ${x.customerId} · ${x.capabilityId||'none'} · ${x.message?.text||''}`;el.onclick=async()=>{const rr=await fetch(`/api/dev/replays/${encodeURIComponent(x.id)}`,{headers:headers()});$('replayjson').textContent=json(await rr.json())};box.appendChild(el)})}
$('runDataset').onclick=async()=>{const r=await fetch('/api/dev/datasets/run',{method:'POST',headers:headers(),body:JSON.stringify({dataset:$('datasetName').value})});$('datasetResult').textContent=json(await r.json())};
function json(v){return v==null?'—':JSON.stringify(v,null,2)}loadReplays();

$('tenant').addEventListener('change',async()=>{
  await fetch('/api/dev/reset',{method:'POST',headers:headers(),body:JSON.stringify({tenantId:$('tenant').value,customerId:$('customer').value,channel:'playground',clearCart:true})});
  chat.innerHTML='';
  add('bot',`Switched to ${$('tenant').selectedOptions[0].text}. Conversation and active cart reset; saved CRM and order history were preserved.`);
  ['selected','entities','messageframe','nlu','workflow','goal','social','semantic','domain','timing','vocabulary','candidates','statejson'].forEach(x=>$(x).textContent='—');
});


let createdTenantId=null;
async function loadTenants(selectId=null){
  const r=await fetch('/api/dev/tenants',{headers:headers()});const d=await r.json();if(!d.ok)return;
  const current=selectId||$('tenant').value;$('tenant').innerHTML='';
  (d.tenants||[]).forEach(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=`${t.name} · ${t.id}${t.domain?` · ${t.domain}`:''}`;$('tenant').appendChild(o)});
  if([...$('tenant').options].some(o=>o.value===current))$('tenant').value=current;
}
function offeringRow(seed={}){
  const row=document.createElement('div');row.className='offering-row';row.innerHTML=`<div class="offering-main"><input data-f="name" placeholder="Offering name" value="${esc(seed.name||'')}"><select data-f="type"><option value="service">Service / bookable offering</option><option value="product">Product / sellable item</option></select><input data-f="category" placeholder="Category" value="${esc(seed.category||'')}"><input data-f="price" type="number" min="0" placeholder="Price" value="${seed.price??''}"></div><textarea data-f="description" rows="2" placeholder="Description">${esc(seed.description||'')}</textarea><input data-f="aliases" placeholder="Aliases / synonyms, comma separated" value="${esc((seed.aliases||[]).join(', '))}"><div class="offering-extra"><input data-f="durationMinutes" type="number" min="1" placeholder="Duration minutes"><input data-f="inventory" type="number" min="0" placeholder="Inventory (products)"><input data-f="sizes" placeholder="Sizes, comma separated"><input data-f="colors" placeholder="Colors, comma separated"><label class="check"><input data-f="bookable" type="checkbox" checked> Bookable</label><button type="button" data-remove>Remove</button></div>`;
  row.__novaSeed={...seed};
  row.querySelector('[data-f="type"]').value=seed.type||'service';
  if(seed.durationMinutes!=null)row.querySelector('[data-f="durationMinutes"]').value=seed.durationMinutes;
  if(seed.inventory!=null)row.querySelector('[data-f="inventory"]').value=seed.inventory;
  if(seed.sizes)row.querySelector('[data-f="sizes"]').value=(seed.sizes||[]).join(', ');
  if(seed.colors)row.querySelector('[data-f="colors"]').value=(seed.colors||[]).join(', ');
  row.querySelector('[data-f="bookable"]').checked=seed.type==='product'?false:seed.bookable!==false;
  row.querySelector('[data-remove]').onclick=()=>row.remove();$('obOfferings').appendChild(row);return row;
}
function collectOfferings(){return [...document.querySelectorAll('.offering-row')].map(row=>{const val=f=>row.querySelector(`[data-f="${f}"]`)?.value||'';const seed=row.__novaSeed||{};return {...seed,name:val('name').trim(),type:val('type'),category:val('category'),price:val('price'),description:val('description'),aliases:val('aliases').split(',').map(x=>x.trim()).filter(Boolean),durationMinutes:val('durationMinutes'),inventory:val('inventory')===''?(seed.inventory??''):val('inventory'),sizes:val('sizes'),colors:val('colors'),bookable:row.querySelector('[data-f="bookable"]').checked,orderable:seed.orderable!==false,inStock:seed.inStock!==false,unit:seed.unit||'',currency:seed.currency||'',tags:seed.tags||[]}}).filter(x=>x.name)}
$('addOffering').onclick=()=>offeringRow();offeringRow();
$('refreshTenants').onclick=()=>loadTenants();

function setInput(id,value){if(value!==undefined&&value!==null&&String(value)!=='')$(id).value=String(value)}
function populateBusinessSpec(spec={}){
  setInput('obName',spec.name);setInput('obId',spec.id);setInput('obDomain',spec.domain);setInput('obAssistant',spec.assistantName);
  setInput('obDescription',spec.description);setInput('obHours',spec.hours);setInput('obContact',spec.contact);setInput('obLocation',spec.location);
  $('obOfferings').innerHTML='';
  (spec.offerings||[]).forEach(offeringRow);
  if(!(spec.offerings||[]).length)offeringRow();
}
$('obBusinessFile').addEventListener('change',async e=>{
  const f=e.target.files?.[0];if(!f)return;
  $('obBusinessFileStatus').textContent=`Reading ${f.name}...`;
  try{
    const text=await f.text();
    const r=await fetch('/api/dev/onboarding/import-business-file',{method:'POST',headers:headers(),body:JSON.stringify({name:f.name,text})});
    const d=await r.json();
    if(!d.ok)throw new Error(d.error||'Import failed');
    populateBusinessSpec(d.spec);
    $('obBusinessFileStatus').textContent=`Imported ${f.name}: ${d.summary.offerings} offerings and ${d.summary.faqs} FAQs recognized. Review the fields, then Generate tenant.`;
    window.__novaImportedFaqs=d.spec.faqs||[];
    window.__novaImportedPaymentMethods=d.spec.paymentMethods||[];
    window.__novaImportedBusinessFacts=d.spec.businessFacts||{};
    window.__novaImportedCurrency=d.spec.currency||'PKR';
  }catch(err){$('obBusinessFileStatus').textContent=`Business data import failed: ${err.message}`}
});
$('obKnowledgeFile').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{const text=await f.text();if(f.name.toLowerCase().endsWith('.json')){try{const parsed=JSON.parse(text);if(parsed?.offerings||parsed?.products||parsed?.services){$('obFileStatus').textContent=`${f.name} looks like structured business data. Please use “Import Business Data” above so Nova creates native products/services instead of indexing raw JSON.`;return}}catch{}}$('obKnowledge').value=text;$('obFileStatus').textContent=`Loaded ${f.name} (${Math.round(f.size/1024)} KB) as additional knowledge.`}catch(err){$('obFileStatus').textContent=`Could not read file: ${err.message}`}});
$('createTenant').onclick=async()=>{
  $('onboardingResult').textContent='Generating tenant...';const body={name:$('obName').value.trim(),id:$('obId').value.trim(),domain:$('obDomain').value.trim()||'generic',assistantName:$('obAssistant').value.trim(),description:$('obDescription').value.trim(),hours:$('obHours').value.trim(),contact:$('obContact').value.trim(),location:$('obLocation').value.trim(),currency:window.__novaImportedCurrency||'PKR',paymentMethods:window.__novaImportedPaymentMethods||[],faqs:window.__novaImportedFaqs||[],businessFacts:window.__novaImportedBusinessFacts||{},offerings:collectOfferings(),overwrite:$('obOverwrite').checked,knowledgeDocuments:$('obKnowledge').value.trim()?[{name:'onboarding-notes',text:$('obKnowledge').value.trim()}]:[]};
  const r=await fetch('/api/dev/onboarding/tenant',{method:'POST',headers:headers(),body:JSON.stringify(body)});const d=await r.json();$('onboardingResult').textContent=json(d);if(d.ok){createdTenantId=d.tenant.id;$('testCreatedTenant').disabled=false;await loadTenants(createdTenantId)}};
$('testCreatedTenant').onclick=async()=>{if(!createdTenantId)return;await loadTenants(createdTenantId);$('tenant').value=createdTenantId;await fetch('/api/dev/reset',{method:'POST',headers:headers(),body:JSON.stringify({tenantId:createdTenantId,customerId:$('customer').value,channel:'playground',clearCart:true})});chat.innerHTML='';add('bot',`Testing ${$('tenant').selectedOptions[0].text}. Try a greeting, knowledge question, browse request, or booking/order request.`);document.querySelector('[data-tab="decision"]').click()};
function esc(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
loadTenants();


// Knowledge Platform v5

$('kmDocFile').addEventListener('change',async e=>{
  const f=e.target.files?.[0];if(!f)return;
  try{
    $('kmDocTitle').value=$('kmDocTitle').value||f.name.replace(/\.[^.]+$/,'');
    window.__novaKnowledgeFile=f;
    window.__novaKnowledgeFormat=(f.name.split('.').pop()||'txt').toLowerCase();
    if(window.__novaKnowledgeFormat==='pdf'){
      $('kmDocText').value='';
      $('kmDocFileStatus').textContent=`Selected ${f.name} (${Math.round(f.size/1024)} KB). PDF text will be extracted securely by Nova when you add it.`;
      return;
    }
    const text=await f.text();
    if(f.name.toLowerCase().endsWith('.json')){
      try{
        const parsed=JSON.parse(text);
        if(parsed?.offerings||parsed?.products||parsed?.services){
          $('kmDocFileStatus').textContent='This looks like structured operational business data. Import it through Onboarding Studio so products/services become actionable instead of retrieval text.';
          window.__novaKnowledgeFile=null;return;
        }
      }catch{}
    }
    $('kmDocText').value=text;
    $('kmDocFileStatus').textContent=`Loaded ${f.name} (${Math.round(f.size/1024)} KB). Review it before adding to tenant knowledge.`;
  }catch(err){$('kmDocFileStatus').textContent=`Could not read file: ${err.message}`;}
});

async function kmLoad(){
  const tenantId=$('tenant').value;if(!tenantId)return;
  $('kmOverview').textContent='Loading...';
  const r=await fetch(`/api/dev/knowledge/${encodeURIComponent(tenantId)}`,{headers:headers()});const d=await r.json();
  if(!d.ok){$('kmOverview').textContent=json(d);return}
  const k=d.knowledge;
  $('kmOverview').textContent=json({
    tenantId:k.tenantId,
    business:k.business,
    operational:k.operational,
    index:k.index,
    faqCount:(k.faqs||[]).length,
    sourceCount:(k.sources||[]).length
  });
  const box=$('kmSources');box.innerHTML='';
  (k.sources||[]).forEach(src=>{
    const row=document.createElement('div');row.className='replay-item';
    const label=document.createElement('span');label.textContent=`${src.kind} · ${src.title} · rev ${src.revision||1} · priority ${src.priority} · ${src.status}`;
    row.appendChild(label);
    if(src.kind==='document'){
      const toggle=document.createElement('button');toggle.textContent=src.status==='disabled'?'Enable':'Disable';toggle.style.marginLeft='12px';
      toggle.onclick=async()=>{await fetch(`/api/dev/knowledge/${encodeURIComponent(tenantId)}/sources/${encodeURIComponent(src.id)}`,{method:'PATCH',headers:headers(),body:JSON.stringify({status:src.status==='disabled'?'active':'disabled'})});await kmLoad();};
      row.appendChild(toggle);
    }
    if(['document','faq'].includes(src.kind)){
      const b=document.createElement('button');b.textContent='Remove';b.style.marginLeft='12px';
      b.onclick=async()=>{if(!confirm(`Remove knowledge source "${src.title}"?`))return;await fetch(`/api/dev/knowledge/${encodeURIComponent(tenantId)}/sources/${encodeURIComponent(src.id)}`,{method:'DELETE',headers:headers()});await kmLoad();};
      row.appendChild(b);
    }
    box.appendChild(row);
  });
  if(!(k.sources||[]).length)box.textContent='No registered sources.';
}
$('kmRefresh').onclick=kmLoad;
$('kmReindex').onclick=async()=>{const id=$('tenant').value;const r=await fetch(`/api/dev/knowledge/${encodeURIComponent(id)}/reindex`,{method:'POST',headers:headers(),body:'{}'});$('kmSearchResult').textContent=json(await r.json());await kmLoad();};
$('kmAddFact').onclick=async()=>{
  const id=$('tenant').value,key=$('kmFactKey').value.trim(),raw=$('kmFactValue').value.trim();if(!key||!raw)return;
  let value=raw;try{value=JSON.parse(raw)}catch{}
  const r=await fetch(`/api/dev/knowledge/${encodeURIComponent(id)}/facts`,{method:'POST',headers:headers(),body:JSON.stringify({key,value})});
  $('kmSearchResult').textContent=json(await r.json());$('kmFactKey').value='';$('kmFactValue').value='';await kmLoad();
};
$('kmAddFaq').onclick=async()=>{
  const id=$('tenant').value,question=$('kmFaqQuestion').value.trim(),answer=$('kmFaqAnswer').value.trim();if(!question||!answer)return;
  const r=await fetch(`/api/dev/knowledge/${encodeURIComponent(id)}/faqs`,{method:'POST',headers:headers(),body:JSON.stringify({question,answer})});
  $('kmSearchResult').textContent=json(await r.json());$('kmFaqQuestion').value='';$('kmFaqAnswer').value='';await kmLoad();
};
$('kmAddDocument').onclick=async()=>{
  const id=$('tenant').value,title=$('kmDocTitle').value.trim(),text=$('kmDocText').value.trim();
  const tags=$('kmDocTags').value.split(',').map(x=>x.trim()).filter(Boolean),priority=Number($('kmDocPriority').value||50);
  let r;
  if(window.__novaKnowledgeFile){
    const f=window.__novaKnowledgeFile,buf=new Uint8Array(await f.arrayBuffer());
    let binary='';for(let i=0;i<buf.length;i+=0x8000)binary+=String.fromCharCode(...buf.subarray(i,i+0x8000));
    r=await fetch(`/api/dev/knowledge/${encodeURIComponent(id)}/files`,{method:'POST',headers:headers(),body:JSON.stringify({filename:f.name,title:title||f.name.replace(/\.[^.]+$/,''),contentBase64:btoa(binary),tags,priority})});
  }else{
    if(!text)return;
    r=await fetch(`/api/dev/knowledge/${encodeURIComponent(id)}/documents`,{method:'POST',headers:headers(),body:JSON.stringify({title,text,tags,format:window.__novaKnowledgeFormat||'txt',priority})});
  }
  const uploaded=await r.json();$('kmSearchResult').textContent=json(uploaded);
  if(uploaded?.document?.alreadyRegistered||uploaded?.document?.source&&uploaded.document.alreadyRegistered){
    $('kmDocFileStatus').textContent='This knowledge file was already registered. Nova reused the existing durable source; no re-upload is required after refresh.';
  }else if(uploaded?.ok){
    $('kmDocFileStatus').textContent='Knowledge saved to the tenant. It remains registered after browser/server refresh; you do not need to select the file again.';
  }
  $('kmDocTitle').value='';$('kmDocText').value='';$('kmDocFile').value='';window.__novaKnowledgeFile=null;window.__novaKnowledgeFormat='txt';await kmLoad();
};
$('kmSearch').onclick=async()=>{
  const id=$('tenant').value,query=$('kmSearchQuery').value.trim();if(!query)return;
  const r=await fetch(`/api/dev/knowledge/${encodeURIComponent(id)}/search`,{method:'POST',headers:headers(),body:JSON.stringify({query})});
  $('kmSearchResult').textContent=json(await r.json());
};
document.querySelector('[data-tab="knowledge"]').addEventListener('click',kmLoad);
$('tenant').addEventListener('change',()=>{if(document.querySelector('[data-tab="knowledge"]').classList.contains('active'))kmLoad();});


// Nova v7 Data Inspector
async function loadDataInspector(){
  const tenantId=$('tenant').value,customerId=$('customer').value;
  const r=await fetch(`/api/dev/data/inspect?tenantId=${encodeURIComponent(tenantId)}&customerId=${encodeURIComponent(customerId)}&channel=playground`,{headers:headers()});
  const d=await r.json();
  if(!d.ok){$('dataStorage').textContent=json(d);return;}
  $('dataStorage').textContent=json({mode:d.storageMode,tenantId:d.tenantId,customerId:d.customerId,conversationId:d.conversationId});
  $('dataCrm').textContent=json(d.crm);$('dataCommerce').textContent=json({...d.commerce,inventory:d.inventory});$('dataBookings').textContent=json({bookings:d.bookings||[],serviceRequests:d.serviceRequests||[]});$('dataState').textContent=json(d.state);
}
$('dataRefresh').onclick=loadDataInspector;
document.querySelector('[data-tab="data"]').addEventListener('click',loadDataInspector);


// Nova v9 Tenant Business Control Plane
let cpDraftId=null;
function cpPath(suffix=''){return `/api/dev/control-plane/${encodeURIComponent($('tenant').value)}${suffix}`}
function cpDocument(){try{return JSON.parse($('cpEditor').value)}catch(error){throw new Error(`Invalid JSON: ${error.message}`)}}
async function cpRequest(url,options={}){const response=await fetch(url,{headers:headers(),...options});const data=await response.json();if(!data.ok)throw new Error(data.error||`HTTP ${response.status}`);return data}
async function cpLoad({keepEditor=false}={}){
  const resource=$('cpResource').value;
  try{
    const [overview,current,revisions,audit]=await Promise.all([
      cpRequest(cpPath()),cpRequest(cpPath(`/resources/${resource}`)),cpRequest(cpPath(`/resources/${resource}/revisions`)),cpRequest(cpPath('/audit?limit=30'))
    ]);
    if(!keepEditor)$('cpEditor').value=JSON.stringify(current.resource.document,null,2);
    $('cpOverview').textContent=json(overview.controlPlane);
    $('cpRevisions').textContent=json(revisions.revisions);
    $('cpAudit').textContent=json(audit.audit);
    const select=$('cpRevision');select.innerHTML='';
    revisions.revisions.forEach(revision=>{const option=document.createElement('option');option.value=revision.revision;option.textContent=`Revision ${revision.revision} · ${revision.source} · ${revision.publishedAt}`;select.appendChild(option)});
    $('cpStatus').textContent=cpDraftId?`Editing draft ${cpDraftId}. Active ${current.resource.source} revision: ${current.resource.revision}.`:`Loaded ${current.resource.source} revision ${current.resource.revision}. Create a draft to edit safely.`;
    await Promise.all([cpInventoryLoad(),cpCalendarLoad()]);
  }catch(error){$('cpStatus').textContent=error.message}
}
async function cpInventoryLoad(){try{const data=await cpRequest(cpPath('/inventory'));$('cpInventory').textContent=json(data.inventory)}catch(error){$('cpInventory').textContent=error.message}}
async function cpInventorySet(){const sku=$('cpInventorySku').value.trim(),quantity=Number($('cpInventoryQuantity').value),reason=$('cpInventoryReason').value.trim();if(!sku||!Number.isInteger(quantity)||quantity<0){$('cpInventory').textContent='Enter a catalog SKU and a non-negative whole-number quantity.';return}if(!confirm(`Set ${sku} on-hand stock to ${quantity} for ${$('tenant').value}?`))return;try{await cpRequest(cpPath(`/inventory/${encodeURIComponent(sku)}`),{method:'PATCH',body:JSON.stringify({onHand:quantity,reason})});await cpInventoryLoad()}catch(error){$('cpInventory').textContent=error.message}}
async function cpCalendarLoad(){try{const data=await cpRequest(cpPath('/calendar'));$('cpCalendar').textContent=json(data.calendar)}catch(error){$('cpCalendar').textContent=error.message}}
async function cpCalendarBlock(){const date=$('cpCalendarDate').value.trim(),time=$('cpCalendarTime').value.trim(),durationMinutes=Number($('cpCalendarDuration').value),capacityRequired=Number($('cpCalendarCapacity').value),poolId=$('cpCalendarPool').value.trim()||null,subject=$('cpCalendarSubject').value.trim()||'Blocked time';if(!date||!time||!Number.isInteger(durationMinutes)||durationMinutes<1||!Number.isInteger(capacityRequired)||capacityRequired<1){$('cpCalendar').textContent='Enter a valid date, time, duration, and capacity.';return}if(!confirm(`Block ${date} at ${time} for ${durationMinutes} minutes?`))return;try{await cpRequest(cpPath('/calendar/blocks'),{method:'POST',body:JSON.stringify({date,time,durationMinutes,capacityRequired,poolId,subject})});await cpCalendarLoad()}catch(error){$('cpCalendar').textContent=error.message}}
async function cpCreate(){
  try{const data=await cpRequest(cpPath('/drafts'),{method:'POST',body:JSON.stringify({resourceType:$('cpResource').value,document:cpDocument()})});cpDraftId=data.draft.id;$('cpStatus').textContent=`Draft ${cpDraftId} created from revision ${data.draft.baseRevision}.`;await cpLoad({keepEditor:true})}catch(error){$('cpStatus').textContent=error.message}
}
async function cpSave(quiet=false){
  if(!cpDraftId)throw new Error('Create a draft before saving changes.');
  const data=await cpRequest(cpPath(`/drafts/${encodeURIComponent(cpDraftId)}`),{method:'PATCH',body:JSON.stringify({document:cpDocument()})});
  if(!quiet)$('cpStatus').textContent=`Draft ${data.draft.id} saved. Validation is now pending.`;
  return data.draft;
}
async function cpValidate(){try{await cpSave(true);const data=await cpRequest(cpPath(`/drafts/${encodeURIComponent(cpDraftId)}/validate`),{method:'POST',body:'{}'});$('cpPreviewResult').textContent=json(data.validate);$('cpStatus').textContent=data.validate.valid?'Draft is valid. Preview it before publishing.':`Draft has ${data.validate.errors.length} validation error(s).`;}catch(error){$('cpStatus').textContent=error.message}}
async function cpPreview(){try{await cpSave(true);const data=await cpRequest(cpPath(`/drafts/${encodeURIComponent(cpDraftId)}/preview`),{method:'POST',body:'{}'});$('cpPreviewResult').textContent=json(data.preview);$('cpStatus').textContent=data.preview.validation.valid&&!data.preview.stale?'Preview ready. Review the diff before publishing.':data.preview.stale?'Draft is stale; create a fresh draft from the active revision.':'Fix validation errors before publishing.';}catch(error){$('cpStatus').textContent=error.message}}
async function cpPublish(){if(!cpDraftId){$('cpStatus').textContent='Create and validate a draft first.';return}if(!confirm(`Publish draft ${cpDraftId} to tenant ${$('tenant').value}?`))return;try{const data=await cpRequest(cpPath(`/drafts/${encodeURIComponent(cpDraftId)}/publish`),{method:'POST',body:'{}'});$('cpPreviewResult').textContent=json(data.revision);$('cpStatus').textContent=`Published revision ${data.revision.revision}. Runtime caches were invalidated.`;cpDraftId=null;await cpLoad()}catch(error){$('cpStatus').textContent=error.message}}
async function cpDiscard(){if(!cpDraftId)return;if(!confirm(`Discard draft ${cpDraftId}?`))return;try{await cpRequest(cpPath(`/drafts/${encodeURIComponent(cpDraftId)}`),{method:'DELETE'});cpDraftId=null;$('cpStatus').textContent='Draft discarded.';await cpLoad()}catch(error){$('cpStatus').textContent=error.message}}
async function cpRollback(){const revision=Number($('cpRevision').value);if(!revision){$('cpStatus').textContent='There is no published revision to restore.';return}if(!confirm(`Create a new revision by restoring revision ${revision}?`))return;try{const data=await cpRequest(cpPath(`/resources/${$('cpResource').value}/rollback`),{method:'POST',body:JSON.stringify({revision})});cpDraftId=null;$('cpPreviewResult').textContent=json(data.revision);$('cpStatus').textContent=`Rollback published as new revision ${data.revision.revision}.`;await cpLoad()}catch(error){$('cpStatus').textContent=error.message}}
$('cpRefresh').onclick=()=>cpLoad({keepEditor:Boolean(cpDraftId)});$('cpLoad').onclick=()=>{cpDraftId=null;cpLoad()};$('cpCreate').onclick=cpCreate;$('cpSave').onclick=()=>cpSave().catch(error=>$('cpStatus').textContent=error.message);$('cpValidate').onclick=cpValidate;$('cpPreview').onclick=cpPreview;$('cpPublish').onclick=cpPublish;$('cpDiscard').onclick=cpDiscard;$('cpRollback').onclick=cpRollback;$('cpInventoryRefresh').onclick=cpInventoryLoad;$('cpInventorySet').onclick=cpInventorySet;$('cpCalendarRefresh').onclick=cpCalendarLoad;$('cpCalendarBlock').onclick=cpCalendarBlock;$('cpResource').addEventListener('change',()=>{cpDraftId=null;cpLoad()});document.querySelector('[data-tab="controlplane"]').addEventListener('click',()=>cpLoad({keepEditor:Boolean(cpDraftId)}));$('tenant').addEventListener('change',()=>{cpDraftId=null;if(document.querySelector('[data-tab="controlplane"]').classList.contains('active'))cpLoad()});
