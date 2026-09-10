'use strict';

// Canonical MadeDeck account-commerce catalog.
// This module intentionally contains no legacy /v3/market state or browser-local ownership.
// Server routes should resolve the authenticated account first, then use these immutable offers.

const CREDIT_PACKS=Object.freeze([
  {code:'credits_10',kind:'credits',audience:'member',name:'Spark',amount_cents:900,credits:10,price_env:'STRIPE_PRICE_CREDITS_10',summary:'10 purchased credits. Purchased credits do not expire.'},
  {code:'credits_30',kind:'credits',audience:'member',name:'Build',amount_cents:2400,credits:30,price_env:'STRIPE_PRICE_CREDITS_30',summary:'30 purchased credits. $0.80 per base credit.'},
  {code:'credits_75',kind:'credits',audience:'member',name:'Momentum',amount_cents:5200,credits:75,price_env:'STRIPE_PRICE_CREDITS_75',summary:'75 purchased credits. $0.69 per base credit.'},
  {code:'credits_200',kind:'credits',audience:'member',name:'Scale',amount_cents:11900,credits:200,price_env:'STRIPE_PRICE_CREDITS_200',summary:'200 purchased credits. $0.59 per base credit.'},
  {code:'credits_500',kind:'credits',audience:'member',name:'Vault',amount_cents:24900,credits:500,price_env:'STRIPE_PRICE_CREDITS_500',summary:'500 purchased credits. $0.50 per base credit.'}
]);

const PLAN_OFFERS=Object.freeze([
  {code:'launch',kind:'subscription',audience:'member',name:'Launch',amount_cents:0,interval:null,credits:0,plan_key:'free',product_limit:3,summary:'One public store, up to 3 products, Maker access, receipts and delivery inbox.'},
  {code:'creator_monthly',kind:'subscription',audience:'member',name:'Creator',amount_cents:1900,interval:'month',credits:25,plan_key:'creator',product_limit:10,price_env:'STRIPE_PRICE_CREATOR_MONTHLY',summary:'25 plan credits monthly and up to 10 published products.'},
  {code:'creator_annual',kind:'subscription',audience:'member',name:'Creator annual',amount_cents:19000,interval:'year',credits:25,plan_key:'creator',product_limit:10,price_env:'STRIPE_PRICE_CREATOR_ANNUAL',summary:'Annual Creator billing; plan credits release monthly.'},
  {code:'pro_monthly',kind:'subscription',audience:'member',name:'Pro',amount_cents:3900,interval:'month',credits:75,plan_key:'pro',product_limit:50,price_env:'STRIPE_PRICE_PRO_MONTHLY',summary:'75 plan credits monthly and up to 50 published products.'},
  {code:'pro_annual',kind:'subscription',audience:'member',name:'Pro annual',amount_cents:39000,interval:'year',credits:75,plan_key:'pro',product_limit:50,price_env:'STRIPE_PRICE_PRO_ANNUAL',summary:'Annual Pro billing; plan credits release monthly.'},
  {code:'studio_monthly',kind:'subscription',audience:'member',name:'Studio',amount_cents:7900,interval:'month',credits:200,plan_key:'studio',product_limit:250,price_env:'STRIPE_PRICE_STUDIO_MONTHLY',summary:'200 plan credits monthly and up to 250 published products.'},
  {code:'studio_annual',kind:'subscription',audience:'member',name:'Studio annual',amount_cents:79000,interval:'year',credits:200,plan_key:'studio',product_limit:250,price_env:'STRIPE_PRICE_STUDIO_ANNUAL',summary:'Annual Studio billing; plan credits release monthly.'}
]);

// Service records are intentionally account-owned purchase offers. Add pricing here only after
// the corresponding Stripe price and fulfillment rule are confirmed. The account billing UI
// consumes these offers; it must never fall back to /v3/market.
const SERVICE_OFFERS=Object.freeze([]);

const PARTNER_OFFERS=Object.freeze([
  {code:'partner_network',kind:'subscription',audience:'partner',name:'Partner Network',amount_cents:null,interval:null,credits:0,plan_key:'partner',product_limit:0,summary:'Isolated partner reporting, attributed referrals and payout visibility. Approval required.'},
  {code:'partner_embedded',kind:'subscription',audience:'partner',name:'Embedded Partner',amount_cents:null,interval:null,credits:0,plan_key:'partner_embed',product_limit:0,summary:'Branded embed, scoped API access and isolated downstream tenants. Approval required.'}
]);

const COMMERCE_OFFERS=Object.freeze([
  ...PLAN_OFFERS,
  ...PARTNER_OFFERS,
  ...CREDIT_PACKS,
  ...SERVICE_OFFERS
]);

function commerceOffer(code){
  return COMMERCE_OFFERS.find(item=>item.code===String(code||''))||null;
}

function publicOffer(item,env=process.env){
  return {
    code:item.code,
    kind:item.kind,
    audience:item.audience,
    name:item.name,
    amount_cents:item.amount_cents,
    interval:item.interval||null,
    credits:Number(item.credits||0),
    summary:item.summary||'',
    configured:item.amount_cents===0||!!(item.price_env&&env[item.price_env])
  };
}

module.exports={CREDIT_PACKS,PLAN_OFFERS,SERVICE_OFFERS,PARTNER_OFFERS,COMMERCE_OFFERS,commerceOffer,publicOffer};
