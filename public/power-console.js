const state={bots:[]};
const byId=id=>document.getElementById(id);

async function api(path,options={}){
  const response=await fetch(`/api/swarm-power${path}`,{
    credentials:'same-origin',
    headers:{'Content-Type':'application/json',...(options.headers||{})},
    ...options
  });
  const payload=await response.json().catch(()=>({ok:false,error:'invalid_response'}));
  if(!response.ok)throw new Error(payload.error||`request_failed_${response.status}`);
  return payload;
}

function statusClass(bot){
  if(bot.lifecycle_status==='blocked'||!bot.operator_enabled)return 'blocked';
  if(['partial','foundation'].includes(bot.lifecycle_status))return 'partial';
  return 'enabled';
}

function renderBots(){
  const grid=byId('botGrid');
  grid.innerHTML='';
  state.bots.forEach(bot=>{
    const card=document.createElement('article');
    card.className=`bot-card ${statusClass(bot)}`;
    const text=document.createElement('div');
    const title=document.createElement('h2');
    title.textContent=bot.name;
    const purpose=document.createElement('p');
    purpose.textContent=bot.primary_capability;
    const status=document.createElement('div');
    status.className='bot-state';
    status.textContent=`${bot.lifecycle_status} · ${bot.autonomy}`;
    text.append(title,purpose,status);
    const toggle=document.createElement('button');
    const locked=Boolean(bot.system_required)||bot.lifecycle_status==='blocked';
    toggle.className=`toggle ${bot.operator_enabled?'on':''}`;
    toggle.textContent=bot.system_required?'LOCKED ON':bot.operator_enabled?'ON':'OFF';
    toggle.disabled=locked;
    toggle.title=bot.system_required?'Required safety/control function':bot.lifecycle_status==='blocked'?'Dependencies are not connected':'Enable or disable this operator bot';
    if(!locked)toggle.addEventListener('click',()=>toggleBot(bot));
    card.append(text,toggle);
    grid.append(card);
  });
}

async function toggleBot(bot){
  try{
    const result=await api(`/bots/${encodeURIComponent(bot.bot_key)}/toggle`,{method:'POST',body:JSON.stringify({enabled:!bot.operator_enabled})});
    bot.operator_enabled=result.operator_enabled;
    renderBots();
    byId('commandStatus').textContent=`${bot.name} ${bot.operator_enabled?'enabled':'disabled'}. Change recorded in the audit log.`;
  }catch(error){byId('commandStatus').textContent=`Unable to change ${bot.name}: ${error.message}`;}
}

async function loadConsole(){
  try{
    const [context,bots]=await Promise.all([api('/context'),api('/bots')]);
    byId('botCount').textContent=context.counts.bots;
    byId('missionCount').textContent=context.counts.missions;
    byId('approvalCount').textContent=context.counts.pendingApprovals;
    state.bots=bots.bots;
    renderBots();
  }catch(error){
    byId('commandStatus').textContent=`Power Console unavailable: ${error.message}`;
    byId('botGrid').innerHTML='<article class="bot-card blocked"><div><h2>Access blocked</h2><p>Sign in with the configured Vinny owner account and verify the Swarm migration is installed.</p></div></article>';
  }
}

byId('commandForm').addEventListener('submit',event=>{
  event.preventDefault();
  const command=byId('commandInput').value.trim();
  byId('commandStatus').textContent=command?`Command captured: “${command}”. Mission interpretation wiring is next.`:'Type a command, database search, or question first.';
});

document.querySelectorAll('[data-command]').forEach(button=>button.addEventListener('click',()=>{
  byId('commandInput').value=button.textContent;
  byId('commandInput').focus();
  byId('commandStatus').textContent=`Ready to configure: ${button.textContent}.`;
}));

const actionLabels={enrich:'Enrich selected leads',qualify:'Qualify and rank selected leads',outreach:'Generate governed outreach drafts',campaign:'Build a MadeDeck marketing campaign','war-room':'Build War Room packets',calling:'Prepare call scripts and objections',content:'Create a content package',proposal:'Generate proposal options','full-prospect':'Create a full prospect package',custom:'Build a custom mission'};
function chooseAction(value){
  document.querySelectorAll('.action-pill').forEach(pill=>pill.classList.toggle('active',pill.dataset.action===value));
  const label=actionLabels[value]||'Choose a Swarm action';
  byId('commandInput').value=label;
  byId('commandStatus').textContent=`${label} selected. Taskmaster will preview required data, crew, estimated cost, outputs, and authority before launch.`;
}
document.querySelectorAll('.action-pill').forEach(pill=>pill.addEventListener('click',()=>chooseAction(pill.dataset.action)));
byId('actionSelect').addEventListener('change',event=>{if(event.target.value)chooseAction(event.target.value);});
byId('dialerLaunch').addEventListener('click',()=>{window.location.href='/api/dialer/ui';});

loadConsole();
