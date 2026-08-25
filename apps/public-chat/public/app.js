const chat=document.querySelector('#chat');
const form=document.querySelector('#composer');
const input=document.querySelector('#message');
const newChat=document.querySelector('#new-chat');
const suggestions=document.querySelector('#suggestions');
const languagePicker=document.querySelector('#language');
const COPY={
  english:{suggestions:['What can Nova do?','Which businesses can use Nova?','Who made Nova?'],welcome:'Hi, I’m Nova 👋\n\nI help businesses turn customer conversations into reliable actions—from answering questions to managing bookings, orders, customer details, and support. Ask me about my capabilities, architecture, security, integrations, or the problems I can solve.',thinking:'Thinking…',placeholder:'Ask Nova anything about customer automation…'},
  roman_urdu:{suggestions:['Nova kya kar sakti hai?','Kon se businesses Nova use kar sakte hain?','Nova ko kis ne banaya?'],welcome:'Salam, main Nova hoon 👋\n\nMain businesses ko customer conversations se reliable action lene mein help karti hoon—questions, bookings, orders, customer details aur support tak. Aap mujh se English ya Roman Urdu mein baat kar sakte hain.',thinking:'Soch rahi hoon…',placeholder:'Nova se customer automation ke bare mein poochhein…'},
  auto:{suggestions:['What can Nova do?','Nova kya kar sakti hai?','Who made Nova?'],welcome:'Hi, main Nova hoon 👋\n\nI help businesses automate customer conversations, bookings, orders, leads, and support. Aap mujh se English ya Roman Urdu—dono mein baat kar sakte hain.',thinking:'Thinking…',placeholder:'Ask in English or Roman Urdu…'}
};
let languageMode=localStorage.getItem('novaPublicLanguage')||'auto';
if(!COPY[languageMode])languageMode='auto';
languagePicker.value=languageMode;
let conversationId=createConversationId();
let previousTopic=null;

function createConversationId(){return `public-${crypto.randomUUID()}`;}

function addMessage(text,role){
  const row=document.createElement('article');row.className=`message-row ${role}`;
  const avatar=document.createElement('span');avatar.className='message-avatar';avatar.textContent=role==='user'?'You':'N';avatar.setAttribute('aria-hidden','true');
  const stack=document.createElement('div');stack.className='message-stack';
  const label=document.createElement('span');label.className='message-label';label.textContent=role==='user'?'You':'Nova';
  const bubble=document.createElement('div');bubble.className='message';bubble.textContent=String(text||'');
  stack.append(label,bubble);row.append(avatar,stack);chat.append(row);chat.scrollTop=chat.scrollHeight;return row;
}

function currentCopy(){return COPY[languageMode]||COPY.auto;}
function renderSuggestions(items=currentCopy().suggestions){
  suggestions.replaceChildren(...items.slice(0,3).map(prompt=>{
    const button=document.createElement('button');button.type='button';button.dataset.prompt=prompt;
    button.innerHTML=`<span>${escapeHtml(prompt)}</span><b aria-hidden="true">↗</b>`;
    return button;
  }));
}

function escapeHtml(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}

async function sendMessage(text){
  addMessage(text,'user');input.value='';resizeInput();input.focus();suggestions.classList.add('waiting');
  const pending=addMessage(currentCopy().thinking,'nova');pending.classList.add('pending');
  try{
    const response=await fetch('/api/assistant/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({conversationId,text,previousTopic,language:languageMode})});
    const data=await response.json();pending.remove();
    if(!response.ok)throw new Error(data.error||'Nova could not reply right now.');
    conversationId=data.conversationId||conversationId;previousTopic=data.topic||null;
    addMessage(data.reply,'nova');renderSuggestions(data.suggestions);
  }catch(error){pending.remove();addMessage(error.message,'error');renderSuggestions();}
  finally{suggestions.classList.remove('waiting');}
}

form.addEventListener('submit',event=>{event.preventDefault();const text=input.value.trim();if(text)sendMessage(text);});
suggestions.addEventListener('click',event=>{const button=event.target.closest('[data-prompt]');if(button)sendMessage(button.dataset.prompt);});
newChat.addEventListener('click',()=>{conversationId=createConversationId();previousTopic=null;chat.replaceChildren();addMessage(currentCopy().welcome,'nova');renderSuggestions();input.focus();});
languagePicker.addEventListener('change',()=>{languageMode=languagePicker.value;localStorage.setItem('novaPublicLanguage',languageMode);input.placeholder=currentCopy().placeholder;renderSuggestions();});
input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();form.requestSubmit();}});
input.addEventListener('input',resizeInput);

function resizeInput(){input.style.height='auto';input.style.height=`${Math.min(input.scrollHeight,144)}px`;}

input.placeholder=currentCopy().placeholder;addMessage(currentCopy().welcome,'nova');renderSuggestions();
