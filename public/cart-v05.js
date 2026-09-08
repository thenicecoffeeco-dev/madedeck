(()=>{
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const money=n=>`$${Number(n||0).toFixed(2)}`;
  let role='customer', provider='stripe', providerStatus={};

  function injectCartStyles(){
    if($('#mdCartV05Styles'))return;
    const s=document.createElement('style');
    s.id='mdCartV05Styles';
    s.textContent=`
      .md-cart-v05-rolebar{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;padding:12px 17px;border-bottom:1px solid #eceff3;background:#fff}
      .md-cart-v05-rolebar button{padding:9px 7px;border:1px solid #e1e5ea;background:#fff;border-radius:9px;font-size:11px;font-weight:850;cursor:pointer}
      .md-cart-v05-rolebar button.on{background:#111827;color:#fff;border-color:#111827}
      .md-cart-v05-providers{padding:13px 17px;border-top:1px solid #eceff3;background:#fff}
      .md-cart-v05-label{font-size:10px;letter-spacing:.1em;text-transform:uppercase;font-weight:900;color:#667085;margin-bottom:8px}
      .md-cart-v05-paygrid{display:grid;grid-template-columns:1fr 1fr;gap:7px}
      .md-cart-v05-paygrid button{position:relative;padding:10px 8px;border:1px solid #e1e5ea;background:#fff;border-radius:9px;font-size:11px;font-weight:800;cursor:pointer}
      .md-cart-v05-paygrid button.on{background:#111827;color:#fff;border-color:#111827}
      .md-cart-v05-paygrid button.off{opacity:.52}
      .md-cart-v05-paygrid button.off:after{content:'setup';position:absolute;right:6px;top:5px;font-size:8px;text-transform:uppercase;letter-spacing:.05em;color:#98a2b3}
      .md-cart-v05-note{margin-top:9px;padding:10px;border-radius:10px;background:#f7f8fa;color:#667085;font-size:10px;line-height:1.45}
      .md-cart-v05-econ{display:none;margin-top:10px;padding-top:9px;border-top:1px solid #e7eaf0;font-size:11px}
      .md-cart-v05-econ.show{display:block}
      .md-cart-v05-econ>div{display:flex;justify-content:space-between;gap:12px;margin:5px 0}
      .md-cart-v05-checkout{width:100%;padding:12px;border:0;border-radius:10px;background:#111827;color:#fff;font-weight:900;cursor:pointer;margin-top:10px}
      .md-cart-v05-status{font-size:10px;color:#667085;margin-top:7px;line-height:1.4}
    `;
    document.head.appendChild(s);
  }

  async function getContext(){
    try{
      const r=await fetch('/api/cart/context',{credentials:'same-origin'});
      const j=await r.json();
      role=j.role||'customer';
      providerStatus=j.providers||{};
      if(!providerStatus[provider]) provider=Object.keys(providerStatus).find(k=>providerStatus[k])||'stripe';
    }catch{
      role='customer';
      providerStatus={paypal:false,stripe:false,applepay:false,googlepay:false,cashapp:false,merchant:false};
    }
  }

  function decorateCart(){
    const cart=$('#mdCart');
    if(!cart||cart.dataset.v05)return false;
    cart.dataset.v05='1';
    const head=$('.md-cart-head',cart), body=$('.md-cart-body',cart), foot=$('.md-cart-foot',cart);
    if(!head||!body||!foot)return false;
    head.querySelector('strong').textContent='MadeDeck checkout';
    head.querySelector('strong').insertAdjacentHTML('afterend','<span style="display:block;font-size:10px;color:#667085;margin-left:auto;margin-right:10px">customer · merchant · owner</span>');
    head.insertAdjacentHTML('afterend',`<div class="md-cart-v05-rolebar"><button type="button" data-cart-role="customer">Customer</button><button type="button" data-cart-role="merchant">Merchant</button><button type="button" data-cart-role="owner">Owner</button></div>`);
    foot.insertAdjacentHTML('beforebegin',`<div class="md-cart-v05-providers"><div class="md-cart-v05-label">Payment routing</div><div class="md-cart-v05-paygrid"><button type="button" data-pay="paypal">PayPal</button><button type="button" data-pay="stripe">Card / Stripe</button><button type="button" data-pay="applepay">Apple Pay</button><button type="button" data-pay="googlepay">Google Pay</button><button type="button" data-pay="cashapp">Cash App</button><button type="button" data-pay="merchant">Merchant portal</button></div><div class="md-cart-v05-note" id="mdCartRoleNote"></div></div>`);
    foot.insertAdjacentHTML('beforeend',`<div class="md-cart-v05-econ" id="mdCartEconomics"><div><span>Platform fee</span><b id="mdPlatformFee">—</b></div><div><span>Merchant payout</span><b id="mdMerchantPayout">—</b></div><div><span>Order owner</span><b id="mdOrderOwner">—</b></div></div><button class="md-cart-v05-checkout" id="mdCheckoutV05" type="button">Continue to secure checkout</button><div class="md-cart-v05-status" id="mdCheckoutStatus">Checkout route ready for provider credentials.</div>`);
    $$('.md-pay-grid',foot).forEach(x=>x.style.display='none');
    $$('[data-cart-role]',cart).forEach(b=>b.onclick=()=>{role=b.dataset.cartRole;renderRole()});
    $$('[data-pay]',cart).forEach(b=>b.onclick=()=>{provider=b.dataset.pay;renderRole()});
    $('#mdCheckoutV05',cart).onclick=previewCheckout;
    renderRole();
    return true;
  }

  function renderRole(){
    const cart=$('#mdCart'); if(!cart)return;
    $$('[data-cart-role]',cart).forEach(b=>b.classList.toggle('on',b.dataset.cartRole===role));
    $$('[data-pay]',cart).forEach(b=>{
      const enabled=!!providerStatus[b.dataset.pay];
      b.classList.toggle('on',b.dataset.pay===provider);
      b.classList.toggle('off',!enabled);
      b.title=enabled?'Connected / available':'Ready for credentials';
    });
    const notes={
      customer:'Customer view shows the payable total and merchant-enabled checkout methods. Production files stay attached to the cart item.',
      merchant:'Merchant view adds retail economics, fulfillment route and payout readiness without exposing platform-owner controls.',
      owner:'Owner view exposes MadeDeck fee economics, merchant payout, provider status and production handoff readiness.'
    };
    $('#mdCartRoleNote',cart).textContent=notes[role];
    $('#mdCartEconomics',cart).classList.toggle('show',role!=='customer');
    $('#mdCheckoutV05',cart).textContent=role==='customer'?'Continue to secure checkout':role==='merchant'?'Review merchant checkout':'Review owner routing';
    const enabled=!!providerStatus[provider];
    $('#mdCheckoutStatus',cart).textContent=`${providerLabel(provider)} selected · ${enabled?'connection available':'credentials not connected yet'}.`;
  }

  function providerLabel(p){return ({paypal:'PayPal',stripe:'Card / Stripe',applepay:'Apple Pay',googlepay:'Google Pay',cashapp:'Cash App',merchant:'Merchant portal'})[p]||p}

  async function previewCheckout(){
    const cart=$('#mdCart');
    const subtotal=Number(($('#mdCartSubtotal',cart)?.textContent||'$0').replace(/[^0-9.]/g,''))||0;
    const shipping=Number(($('#mdCartShip',cart)?.textContent||'$0').replace(/[^0-9.]/g,''))||0;
    const status=$('#mdCheckoutStatus',cart);
    status.textContent='Preparing checkout route…';
    try{
      if(provider==='stripe'&&providerStatus.stripe){
        const items=typeof window.mdCheckoutItems==='function'?window.mdCheckoutItems():[];
        if(!items.length)throw new Error('Add a configured product to the cart first.');
        const r=await fetch('/api/checkout/session',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},credentials:'same-origin',body:JSON.stringify({items})});
        const type=r.headers.get('content-type')||'',j=type.includes('application/json')?await r.json():{ok:false,error:`checkout_http_${r.status}`};
        if(r.status===401||j.error==='login_required'){status.textContent='Sign in to attach this cart to your account before payment.';if(typeof window.showPage==='function')window.showPage('login');return}
        if(!r.ok||!j.ok||!j.url)throw new Error(j.error||'stripe_checkout_failed');
        status.textContent='Opening secure Stripe Checkout…';const target=window.top&&window.top!==window?window.top:window;target.location.assign(j.url);return;
      }
      const r=await fetch('/api/checkout/preview',{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify({subtotal,shipping,provider})});
      const j=await r.json();
      if(!j.ok)throw new Error(j.error||'checkout_preview_failed');
      if(j.economics){$('#mdPlatformFee',cart).textContent=money(j.economics.platform_fee);$('#mdMerchantPayout',cart).textContent=money(j.economics.merchant_payout);$('#mdOrderOwner',cart).textContent=j.economics.order_owner||'Merchant'}
      status.textContent=j.provider_enabled?`${providerLabel(provider)} is connected; this provider adapter is next in the checkout queue.`:`${providerLabel(provider)} is not configured for this account.`;
    }catch(e){status.textContent='Checkout preview could not be prepared. '+e.message;}
  }

  async function boot(){
    injectCartStyles();
    await getContext();
    let tries=0;
    const timer=setInterval(()=>{tries++;if(decorateCart()||tries>40)clearInterval(timer)},100);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
