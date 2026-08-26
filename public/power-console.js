const state={bots:[],controlActions:[],controlUsers:[],offers:[],dialerPlans:[],selectedAction:'custom'};
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

const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value||0)/100);
const integer=value=>new Intl.NumberFormat('en-US').format(Number(value||0));
function table(rootId,headers,rows){const root=byId(rootId);root.innerHTML='';const t=document.createElement('table'),thead=document.createElement('thead'),tr=document.createElement('tr');headers.forEach(h=>{const th=document.createElement('th');th.textContent=h;tr.append(th);});thead.append(tr);const body=document.createElement('tbody');rows.forEach(row=>{const line=document.createElement('tr');row.forEach(value=>{const td=document.createElement('td');if(value instanceof Node)td.append(value);else td.textContent=value??'—';line.append(td);});body.append(line);});t.append(thead,body);root.append(t);}
async function loadOverview(){const result=await api('/admin/saas-overview');byId('activeSubscribers').textContent=integer(result.subscriptions.active);byId('planMix').textContent=result.plan_mix.map(p=>`${p.name}: ${p.subscribers}`).join(' · ')||'No paid plans yet';byId('monthRevenue').textContent=money(result.revenue.month_cents);byId('lifetimeRevenue').textContent=`Lifetime ${money(result.revenue.lifetime_cents)}`;byId('activeUsers').textContent=integer(result.users.active);byId('newUsers').textContent=`${integer(result.users.new_30d)} new in 30 days`;byId('openInquiries').textContent=integer(Number(result.inquiries.new_count)+Number(result.inquiries.pipeline));byId('pipelineInquiries').textContent=`${integer(result.inquiries.pipeline)} qualified / proposal`;byId('creditsOutstanding').textContent=integer(result.credits.outstanding);byId('creditsUsed').textContent=`${integer(result.credits.used)} used`;byId('dialerSubscribers').textContent=integer(result.dialer.active);byId('dialerCalls').textContent=`${integer(result.dialer.calls_used)} calls used`;byId('pastDue').textContent=integer(result.subscriptions.past_due);byId('canceling').textContent=`${integer(result.subscriptions.canceling)} canceling`;byId('usageEvents').textContent=integer(result.usage.events);byId('usageCredits').textContent=`${integer(result.usage.credits)} credits`;table('topActions',['Function','Runs','Quantity','Credits'],result.top_actions.map(a=>[a.name,integer(a.runs),integer(a.quantity),integer(a.credits)]));}
async function loadCustomers(search=''){const result=await api(`/admin/customers?search=${encodeURIComponent(search)}`);table('customerTable',['Customer','Plan','Subscription','Credits','Dialer','Calls','Lifetime value','Joined'],result.customers.map(c=>[c.email,c.plan_name||'Free',c.subscription_status||'—',integer(c.credit_balance),c.dialer_plan||'None',integer(c.calls_used),money(c.lifetime_value_cents),new Date(c.created_at).toLocaleDateString()]));}
async function loadInquiries(){const result=await api('/admin/inquiries');table('inquiryTable',['Contact','Company','Interest','Source','Status','Value','Received'],result.inquiries.map(i=>[i.name?`${i.name} · ${i.email}`:i.email,i.company||'—',i.interest_code||'General',i.source||'Unknown',i.status,money(i.estimated_value_cents),new Date(i.created_at).toLocaleString()]));}
function commerceRow(entityType,item){const row=document.createElement('article');row.className='feature-row commerce-row';const info=document.createElement('div');info.innerHTML=`<h3>${escapeText(item.name)}</h3><p>${escapeText(item.entity_key)} · ${escapeText(item.category)}</p>`;const toggleLabel=document.createElement('label');toggleLabel.className='switch';const toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=Boolean(item.active);const slider=document.createElement('span');toggleLabel.append(toggle,slider);const price=document.createElement('input');price.type='number';price.min='0';price.step='0.01';price.value=(Number(item.effective_price_cents||0)/100).toFixed(2);price.title=`Original price: ${money(item.original_price_cents)}. Clear/reset by matching the original.`;const allowance=document.createElement('input');allowance.type='number';allowance.min='0';allowance.step='1';const originalAllowance=entityType==='offer'?item.original_credit_grant:item.original_allowance;allowance.value=entityType==='offer'?item.effective_credit_grant:item.effective_allowance;allowance.title=`Original ${entityType==='offer'?'credit grant':'included calls'}: ${integer(originalAllowance)}.`;const save=document.createElement('button');save.className='save-price';save.textContent='Save';save.onclick=()=>saveCommerce(entityType,item,toggle.checked,price.value,allowance.value);row.append(info,toggleLabel,price,allowance,save);return row;}
function renderCommerce(result){state.offers=result.offers;state.dialerPlans=result.dialer_plans;const offerRoot=byId('offerControls'),dialerRoot=byId('dialerControls');offerRoot.innerHTML='';dialerRoot.innerHTML='';result.offers.forEach(item=>offerRoot.append(commerceRow('offer',item)));result.dialer_plans.forEach(item=>dialerRoot.append(commerceRow('dialer_plan',item)));table('allowanceTable',['Plan','Function','Included','Period','Overage multiplier'],result.allowances.map(a=>[a.tier_code,a.name,integer(a.included_quantity),a.allowance_period,`${a.overage_credit_multiplier}×`]));}
async function loadCommerce(){const target=controlTarget(),q=target.scope_type==='user'&&target.scope_user_id?`?user_id=${target.scope_user_id}`:'';renderCommerce(await api(`/admin/commerce-controls${q}`));}
async function saveCommerce(entityType,item,active,dollars,allowance){const target=controlTarget();const body={...target,active,override_price_cents:Math.round(Number(dollars)*100)};if(entityType==='offer')body.override_credit_grant=Number(allowance);else body.override_allowance=Number(allowance);try{await api(`/admin/commerce-controls/${entityType}/${encodeURIComponent(item.entity_key)}`,{method:'PUT',body:JSON.stringify(body)});byId('commandStatus').textContent=`${item.name} updated. Its original price remains ${money(item.original_price_cents)}.`;await loadCommerce();}catch(error){byId('commandStatus').textContent=`Commerce update failed: ${error.message}`;}}
async function loadAssets(){const result=await api('/admin/assets-status');byId('assetSummary').innerHTML=`<article><span>Apparel mockups</span><strong>${integer(result.mockups.count)}</strong><small>Versioned previews</small></article><article><span>Production masters</span><strong>${integer(result.masters.count)}</strong><small>Full-resolution sources</small></article><article><span>Premade graphics</span><strong>${integer(result.premades.count)}</strong><small>${integer(result.premades.restricted)} restricted</small></article>`;table('assetProducts',['Product','Files','Colors','Views'],Object.entries(result.mockups.products).map(([name,p])=>[name,integer(p.count),p.colors.join(', '),p.views.join(', ')]));}

byId('commandForm').addEventListener('submit',event=>{
  event.preventDefault();
  const command=byId('commandInput').value.trim();
  if(!command){byId('commandStatus').textContent='Type a mission request first.';return;}
  byId('commandStatus').textContent='Creating a governed draft mission…';
  api('/missions',{method:'POST',body:JSON.stringify({title:command.slice(0,120),request_text:command,authority_class:'A1',evidence_mode:'hybrid',mission_contract:{template:state.selectedAction,execution:'draft_only',requires_preflight:true}})}).then(result=>{
    byId('commandStatus').textContent='Draft mission created. Nothing external has run.';
    showResult(`<b>Mission ${escapeText(result.mission_key)}</b><br>State: draft · Next: select bots, estimate cost, inspect evidence requirements, then approve execution.`);
  }).catch(error=>byId('commandStatus').textContent=`Mission creation failed: ${error.message}`);
});

document.querySelectorAll('[data-command]').forEach(button=>button.addEventListener('click',()=>{
  const type=button.dataset.command;
  if(type==='help'){showResult('<b>How this console works</b><br>Choose a template or describe a goal, then Run creates a draft mission. Draft means no scraping, sending, spending, calling, or publishing has happened. Revenue Dialer opens the CRM calling workspace. Decisions shows pending A3–A5 approvals.');return;}
  if(type==='decision-inbox'){loadApprovals();return;}
  const prompts={
    'new-mission':'Describe the outcome, target, inputs, deadline, and acceptable output.',
    'gather-leads':'Gather leads for [industry] in [location] using approved sources; deduplicate, score, and return evidence.',
    'digest-leads':'Digest the uploaded lead list; normalize, deduplicate, flag incomplete records, segment, rank, and prepare CRM import.'
  };
  state.selectedAction=type;
  byId('commandInput').value=prompts[type]||button.textContent;
  byId('commandInput').focus();
  byId('commandStatus').textContent=`Edit the request, then Run to create a draft. No worker launches from this shortcut.`;
}));

function escapeText(value){const node=document.createElement('div');node.textContent=String(value||'');return node.innerHTML;}
function showResult(html){const box=byId('commandResult');box.hidden=false;box.innerHTML=html;}
async function loadApprovals(){try{const result=await api('/approvals');showResult(result.approvals.length?`<b>Pending decisions</b><br>${result.approvals.map(a=>`${escapeText(a.title)} · ${escapeText(a.authority_class)} · ${escapeText(a.approval_key)}`).join('<br>')}`:'<b>Decision inbox</b><br>No pending approvals.');byId('commandStatus').textContent=`${result.approvals.length} pending decision(s).`;}catch(error){byId('commandStatus').textContent=`Decision inbox failed: ${error.message}`;}}

const actionLabels={enrich:'Enrich selected leads',qualify:'Qualify and rank selected leads',outreach:'Generate governed outreach drafts',campaign:'Build a MadeDeck marketing campaign','war-room':'Build War Room packets',calling:'Prepare call scripts and objections',content:'Create a content package',proposal:'Generate proposal options','full-prospect':'Create a full prospect package',custom:'Build a custom mission'};
function chooseAction(value){
  document.querySelectorAll('.action-pill').forEach(pill=>pill.classList.toggle('active',pill.dataset.action===value));
  const label=actionLabels[value]||'Choose a Swarm action';
  state.selectedAction=value;
  byId('commandInput').value=label;
  byId('commandStatus').textContent=`${label} selected. Run creates a draft mission; execution still requires preflight and any applicable approval.`;
}
document.querySelectorAll('.action-pill').forEach(pill=>pill.addEventListener('click',()=>chooseAction(pill.dataset.action)));
byId('actionSelect').addEventListener('change',event=>{if(event.target.value)chooseAction(event.target.value);});
document.querySelectorAll('[data-panel]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-panel]').forEach(b=>b.classList.toggle('active',b===button));document.querySelectorAll('.admin-panel').forEach(panel=>panel.classList.toggle('active',panel.id===button.dataset.panel));}));
let searchTimer;byId('customerSearch').addEventListener('input',event=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadCustomers(event.target.value).catch(e=>byId('commandStatus').textContent=e.message),250);});
byId('controlScope').addEventListener('change',()=>{byId('controlUser').hidden=byId('controlScope').value!=='user';Promise.all([loadFeatureControls(),loadCommerce()]).catch(e=>byId('commandStatus').textContent=e.message);});
byId('controlUser').addEventListener('change',()=>Promise.all([loadFeatureControls(),loadCommerce()]).catch(e=>byId('commandStatus').textContent=e.message));

Promise.all([loadConsole(),loadFeatureControls(),loadOverview(),loadCustomers(),loadInquiries(),loadCommerce(),loadAssets()]).catch(error=>{byId('commandStatus').textContent=`Some owner data could not load: ${error.message}`;});
