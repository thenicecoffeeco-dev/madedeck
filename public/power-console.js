const state={bots:[],controlActions:[],controlUsers:[]};
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

function controlTarget(){return byId('controlScope').value==='user'?{scope_type:'user',scope_user_id:Number(byId('controlUser').value)}:{scope_type:'platform',scope_user_id:null};}
function renderFeatureControls(){const root=byId('featureControls');root.innerHTML='';state.controlActions.forEach(action=>{const row=document.createElement('article');row.className='feature-row';const info=document.createElement('div'),h=document.createElement('h3'),p=document.createElement('p');h.textContent=action.name;p.textContent=`${action.action_code} · ${action.category} · ${action.billing_unit}`;info.append(h,p);const label=document.createElement('label');label.className='switch';label.title=action.effective_enabled?'Visible and launchable':'Hidden and blocked';const toggle=document.createElement('input'),slider=document.createElement('span');toggle.type='checkbox';toggle.checked=Boolean(action.effective_enabled);label.append(toggle,slider);const wrap=document.createElement('div');wrap.className='price-wrap';const price=document.createElement('input');price.type='number';price.min='0';price.step='1';price.value=action.base_credits;price.title=`Original catalog price: ${action.original_pricing.base_credits} credits per ${action.quantity_step||1} ${action.billing_unit}. Clear the field to restore it.`;wrap.append(price);const save=document.createElement('button');save.className='save-price';save.textContent='Save price';toggle.onchange=()=>saveVisibility(action,toggle.checked);save.onclick=()=>savePrice(action,price.value);row.append(info,label,wrap,save);root.append(row);});}
async function loadFeatureControls(){const target=controlTarget(),q=target.scope_type==='user'&&target.scope_user_id?`?user_id=${target.scope_user_id}`:'';const result=await api(`/admin/feature-controls${q}`);state.controlActions=result.actions;state.controlUsers=result.users;const user=byId('controlUser');if(!user.options.length)result.users.forEach(u=>{const o=document.createElement('option');o.value=u.id;o.textContent=`${u.email} · ${u.role}`;user.append(o);});renderFeatureControls();}
async function saveVisibility(action,enabled){try{await api(`/admin/feature-controls/${encodeURIComponent(action.action_code)}`,{method:'PUT',body:JSON.stringify({...controlTarget(),enabled})});byId('commandStatus').textContent=`${action.name} is now ${enabled?'visible':'hidden'} for ${controlTarget().scope_type==='platform'?'the platform':'the selected user'}.`;await loadFeatureControls();}catch(e){byId('commandStatus').textContent=`Control update failed: ${e.message}`;await loadFeatureControls();}}
async function savePrice(action,value){try{await api(`/admin/price-controls/${encodeURIComponent(action.action_code)}`,{method:'PUT',body:JSON.stringify({...controlTarget(),override_base_credits:value===''?null:Number(value)})});byId('commandStatus').textContent=`${action.name} price updated. Original remains ${action.original_pricing.base_credits} credits.`;await loadFeatureControls();}catch(e){byId('commandStatus').textContent=`Price update failed: ${e.message}`;}}

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
byId('controlScope').addEventListener('change',()=>{byId('controlUser').hidden=byId('controlScope').value!=='user';loadFeatureControls().catch(e=>byId('commandStatus').textContent=e.message);});
byId('controlUser').addEventListener('change',()=>loadFeatureControls().catch(e=>byId('commandStatus').textContent=e.message));

Promise.all([loadConsole(),loadFeatureControls()]).catch(()=>{});
