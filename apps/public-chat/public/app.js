const chat=document.querySelector('#chat');
const form=document.querySelector('#composer');
const input=document.querySelector('#message');
const newChat=document.querySelector('#new-chat');
const suggestions=document.querySelector('#suggestions');
const DEFAULT_SUGGESTIONS=['What can Nova do?','Which businesses can use Nova?','Who made Nova?'];
const WELCOME='Hi, I’m Nova 👋\n\nI help businesses turn customer conversations into reliable actions—from answering questions to managing bookings, orders, customer details, and support. Ask me about my capabilities, architecture, security, integrations, or the problems I can solve.';
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

function renderSuggestions(items=DEFAULT_SUGGESTIONS){
  suggestions.replaceChildren(...items.slice(0,3).map(prompt=>{
    const button=document.createElement('button');button.type='button';button.dataset.prompt=prompt;
    button.innerHTML=`<span>${escapeHtml(prompt)}</span><b aria-hidden="true">↗</b>`;
    return button;
  }));
}

function escapeHtml(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}

async function sendMessage(text){
  addMessage(text,'user');input.value='';resizeInput();input.focus();suggestions.classList.add('waiting');
  const pending=addMessage('Thinking…','nova');pending.classList.add('pending');
  try{
    const response=await fetch('/api/assistant/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({conversationId,text,previousTopic})});
    const data=await response.json();pending.remove();
    if(!response.ok)throw new Error(data.error||'Nova could not reply right now.');
    conversationId=data.conversationId||conversationId;previousTopic=data.topic||null;
    addMessage(data.reply,'nova');renderSuggestions(data.suggestions);
  }catch(error){pending.remove();addMessage(error.message,'error');renderSuggestions();}
  finally{suggestions.classList.remove('waiting');}
}

form.addEventListener('submit',event=>{event.preventDefault();const text=input.value.trim();if(text)sendMessage(text);});
suggestions.addEventListener('click',event=>{const button=event.target.closest('[data-prompt]');if(button)sendMessage(button.dataset.prompt);});
newChat.addEventListener('click',()=>{conversationId=createConversationId();previousTopic=null;chat.replaceChildren();addMessage(WELCOME,'nova');renderSuggestions();input.focus();});
input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();form.requestSubmit();}});
input.addEventListener('input',resizeInput);

function resizeInput(){input.style.height='auto';input.style.height=`${Math.min(input.scrollHeight,144)}px`;}

addMessage(WELCOME,'nova');renderSuggestions();
