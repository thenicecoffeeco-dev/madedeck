(()=>{'use strict';
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state={profile:null,products:[],orders:[],loading:false};
  document.body.dataset.liveWorkspace='1';
  const style=document.createElement('style');style.textContent=`
    body[data-live-workspace="1"] #view-member [data-member-panel]{display:block!important}
    body[data-live-workspace="1"] #view-member .side{position:sticky;top:0;align-self:start}
    body[data-live-workspace="1"] .live-step{display:grid;grid-template-columns:48px 1fr;gap:14px;padding:18px;border:1px solid #bbb;background:#fff;margin:12px 0}
    body[data-live-workspace="1"] .live-step>b{display:grid;place-items:center;width:42px;height:42px;border:2px solid #111;border-radius:50%}
    body[data-live-workspace="1"] .live-step.done>b{background:#caff00}
    body[data-live-workspace="1"] .live-step h3{margin:0 0 5px}
    body[data-live-workspace="1"] .live-logo{max-width:96px;max-height:96px;object-fit:contain;border:1px solid #bbb;background:#fff}
    body[data-live-workspace="1"] .live-status{padding:11px;border-left:5px solid #caff00;background:#f5f5ef;margin:12px 0}
    body[data-live-workspace="1"] .live-error{border-left-color:#ff5648;background:#fff0ed}
  `;document.head.appendChild(style);

  async function json(url,options={}){const r=await fetch(url,{credentials:'same-origin',headers:{Accept:'application/json',...(options.headers||{})},...options});const type=r.headers.get('content-type')||'',body=type.includes('application/json')?await r.json():{ok:false,error:`http_${r.status}`};if(!r.ok||!body.ok)throw Error(body.error||`http_${r.status}`);return body}
  function storeUrl(){return `${location.origin}/store/${encodeURIComponent(state.profile?.slug||'')}`}
  function qrUrl(){return `https://quickchart.io/qr?size=180&margin=1&text=${encodeURIComponent(storeUrl())}`}
  function message(target,text,error=false){const el=$(target);if(!el)return;el.className='live-status'+(error?' live-error':'');el.textContent=text}
  function fileData(file){return new Promise((resolve,reject)=>{if(!file||!file.size)return resolve('');if(file.size>650000)return reject(Error('Logo must be under 650 KB.'));const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(Error('Could not read logo.'));reader.readAsDataURL(file)})}

  function renderPage(){const p=state.profile,target=$('#member-page');if(!target||!p)return;const links=[0,1,2].map(i=>p.links?.[i]||{});target.innerHTML=`
    <div class="head"><div><h1>${p.onboarding_complete?'Page setup.':'Build your free store.'}</h1><p class="sub">Your account is saved. Finish this server-backed profile before publishing products.</p></div></div>
    <div class="live-step ${p.onboarding_complete?'done':''}"><b>01</b><div><h3>Account and storefront</h3><p>Free plan · ${p.product_count}/${p.product_limit} products · payout ${esc(p.payout_status.replaceAll('_',' '))}</p></div></div>
    <form id="livePageForm" class="card formGrid">
      <div class="field"><label>Your name</label><input name="display_name" value="${esc(p.display_name)}" required></div>
      <div class="field"><label>Store name</label><input name="store_name" value="${esc(p.store_name)}" required></div>
      <div class="field"><label>Store URL slug</label><input name="slug" value="${esc(p.slug)}" required pattern="[a-z0-9-]+"></div>
      <div class="field"><label>Logo</label><input name="logo" type="file" accept="image/png,image/jpeg,image/webp"></div>
      ${p.logo_data?`<div class="field"><label>Current logo</label><img class="live-logo" src="${esc(p.logo_data)}" alt="Current store logo"></div>`:''}
      <div class="field full"><label>Bio</label><textarea name="bio">${esc(p.bio)}</textarea></div>
      <div class="field full"><label>Daily message</label><textarea name="daily_message">${esc(p.daily_message)}</textarea></div>
      ${links.map((link,i)=>`<div class="field"><label>Link ${i+1} label</label><input name="link${i}label" value="${esc(link.label||'')}"></div><div class="field"><label>Link ${i+1} URL</label><input name="link${i}url" value="${esc(link.url||'')}"></div>`).join('')}
      <div class="full"><button class="action lime">Save account and continue</button></div><div id="livePageMsg" class="full" aria-live="polite"></div>
    </form>
    <div class="live-step ${p.product_count>0?'done':''}"><b>02</b><div><h3>Create up to ${p.product_limit} products</h3><p>The same canonical Maker saves products and designs only to this account.</p><button class="action white" type="button" id="openLiveStudio">Open product studio</button></div></div>
    <div class="live-step ${p.storefront_published?'done':''}"><b>03</b><div><h3>Publish your page</h3><p>${p.storefront_published?`Public at ${esc(storeUrl())}`:'Your page remains private until you have saved at least one product.'}</p><button class="action" type="button" id="publishLiveStore" ${!p.onboarding_complete||!p.product_count?'disabled':''}>${p.storefront_published?'Store published':'Publish free store'}</button></div></div>`;
    $('#openLiveStudio').onclick=()=>document.querySelector('[data-member-panel="studio"]')?.click();
    $('#livePageForm').onsubmit=saveProfile;$('#publishLiveStore').onclick=publishStore;
  }
  async function saveProfile(e){e.preventDefault();const d=new FormData(e.currentTarget),button=$('button[type="submit"]',e.currentTarget);button.disabled=true;try{const logo=await fileData(d.get('logo'));const body={display_name:d.get('display_name'),store_name:d.get('store_name'),slug:d.get('slug'),bio:d.get('bio'),daily_message:d.get('daily_message'),logo_data:logo,links:[0,1,2].map(i=>({label:d.get(`link${i}label`),url:d.get(`link${i}url`)}))};await json('/api/workspace/profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});await load();message('#livePageMsg','Saved to your MadeDeck account. Next: create products, then publish.')}catch(error){message('#livePageMsg',error.message,true)}finally{button.disabled=false}}
  async function publishStore(){try{const p=state.profile;await json('/api/workspace/profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({display_name:p.display_name,store_name:p.store_name,slug:p.slug,bio:p.bio,daily_message:p.daily_message,logo_data:p.logo_data,links:p.links,storefront_published:true})});await load()}catch(error){alert('Could not publish store: '+error.message)}}
  function renderOverview(){const p=state.profile,target=$('#member-overview');if(!target||!p)return;target.innerHTML=`<div class="head"><div><h1>${esc(p.store_name)}</h1><p class="sub">Private, account-scoped workspace.</p></div><button class="pill lime" id="editLivePage">Edit page</button></div><div class="metrics"><div class="metric lime"><small>Plan</small><b>${esc(p.plan_key)}</b></div><div class="metric"><small>Products</small><b>${p.product_count}/${p.product_limit}</b></div><div class="metric"><small>Store</small><b>${p.storefront_published?'Published':'Draft'}</b></div><div class="metric"><small>Payouts</small><b>${esc(p.payout_status.replaceAll('_',' '))}</b></div></div><div class="notice">${p.onboarding_complete?`Public URL: ${esc(storeUrl())}`:'Complete Page setup before publishing.'}</div>${p.storefront_published?`<div class="card"><h2>Your store QR</h2><img src="${qrUrl()}" alt="QR code for ${esc(p.store_name)}" width="180" height="180"></div>`:''}`;$('#editLivePage').onclick=()=>document.querySelector('[data-member-panel="page"]')?.click()}
  function renderProducts(){const p=state.profile,target=$('#member-products');if(!target||!p)return;target.innerHTML=`<div class="head"><div><h1>Products and pricing.</h1><p class="sub">Free accounts can publish up to ${p.product_limit} products. Base prices are controlled by MadeDeck; your retail amount is stored with each product.</p></div><button class="pill lime" id="makeLiveProduct">Make a product</button></div><div class="card">${state.products.length?state.products.map(x=>`<div class="pricingRow"><b>${esc(x.name)}</b><span>${esc(x.product?.base_product||x.product_key)}</span><span>$${Number(x.retail_price||0).toFixed(2)}</span><span>${esc(x.status)}</span></div>`).join(''):'No saved products yet.'}</div>`;$('#makeLiveProduct').onclick=()=>document.querySelector('[data-member-panel="studio"]')?.click()}
  function renderReceipts(){const target=$('#member-receipts');if(!target)return;target.innerHTML=`<div class="head"><div><h1>Your receipts.</h1><p class="sub">Only orders belonging to this authenticated account appear here.</p></div></div><div class="card">${state.orders.length?state.orders.map(o=>`<div class="pricingRow"><b>Order #${o.id}</b><span>${esc(o.customer_name||o.customer_email||'Customer')}</span><span>${esc(o.status)}</span><b>$${Number(o.total||0).toFixed(2)}</b></div>`).join(''):'No receipts yet.'}</div>`}
  function renderAll(){renderOverview();renderPage();renderProducts();renderReceipts()}
  async function load(){if(state.loading)return;state.loading=true;try{const [profile,products,orders]=await Promise.all([json('/api/workspace/profile'),json('/api/workspace/products').catch(()=>({products:[]})),json('/api/operations/orders').catch(()=>({orders:[]}))]);state.profile=profile.profile;state.products=products.products||[];state.orders=orders.orders||[];renderAll();const onboarding=new URLSearchParams(location.search).get('onboarding')==='1'||!state.profile.onboarding_complete;if(onboarding)setTimeout(()=>document.querySelector('[data-member-panel="page"]')?.click(),0)}catch(error){console.error('live workspace unavailable',error)}finally{state.loading=false}}
  document.addEventListener('click',e=>{if(e.target.closest('[data-member-panel]'))setTimeout(renderAll,0)});
  load();
})();
