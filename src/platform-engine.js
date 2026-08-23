const ROLE_PERMISSIONS={
  customer:['shop','checkout','save_design','view_own_orders','join_preorder','direct_pay'],
  merchant:['store_read','product_read','campaign_read','order_read'],
  merchant_staff:['store_read','product_manage','campaign_manage','order_manage','customer_read'],
  merchant_admin:['store_manage','product_manage','campaign_manage','order_manage','customer_manage','billing_read','team_manage'],
  production_vendor:['vendor_jobs_read','vendor_jobs_update','production_files_read'],
  platform_staff:['merchant_read','order_manage','support_manage','vendor_jobs_manage','risk_flag'],
  finance_admin:['ledger_read','refund_manage','vendor_payable_approve','vendor_payable_mark_paid','payout_hold_manage','financial_change_approve'],
  admin:['platform_read','merchant_manage','order_manage','support_manage'],
  platform_admin:['platform_manage','merchant_manage','order_manage','support_manage','feature_flags_manage'],
  super_admin:['*']
};

const PAYMENT_PROVIDERS={
  stripe:{label:'Card / Stripe',wallets:['apple_pay','google_pay','cash_app_pay'],mode:'gateway'},
  paypal:{label:'PayPal',wallets:['venmo'],mode:'gateway'},
  square:{label:'Square',wallets:['cash_app_pay','apple_pay','google_pay'],mode:'gateway'},
  authorize_net:{label:'Authorize.Net',wallets:[],mode:'gateway'},
  amazon_pay:{label:'Amazon Pay',wallets:[],mode:'wallet'},
  shop_pay:{label:'Shop Pay',wallets:[],mode:'wallet'},
  klarna:{label:'Klarna',wallets:[],mode:'bnpl'},
  afterpay:{label:'Afterpay / Clearpay',wallets:[],mode:'bnpl'},
  affirm:{label:'Affirm',wallets:[],mode:'bnpl'},
  merchant_portal:{label:'Merchant payment portal',wallets:[],mode:'redirect'}
};

const MONETIZATION_CATALOG={
  account_activation:{label:'Account activation / payment verification',defaultAmount:1,unit:'once'},
  preorder_basic:{label:'Basic one-item preorder',defaultAmount:6,unit:'campaign'},
  preorder_managed:{label:'Managed preorder setup + execution',defaultAmount:null,unit:'campaign'},
  transaction_fee:{label:'Platform transaction fee',defaultAmount:null,unit:'order'},
  fulfillment_margin:{label:'Fulfillment margin',defaultAmount:null,unit:'item'},
  decoration_location:{label:'Additional decoration location',defaultAmount:null,unit:'location'},
  artwork_reprocess:{label:'Artwork reconstruction / reprocessing',defaultAmount:15.99,unit:'job'},
  artwork_upscale:{label:'Artwork upscaling',defaultAmount:null,unit:'job'},
  artwork_vectorize:{label:'Vector / logo cleanup',defaultAmount:null,unit:'job'},
  artwork_background_removal:{label:'Background removal',defaultAmount:null,unit:'job'},
  rush_artwork:{label:'Rush artwork',defaultAmount:null,unit:'job'},
  premium_campaign_media:{label:'Premium campaign page media',defaultAmount:null,unit:'campaign'},
  storefront_upgrade:{label:'Storefront upgrade',defaultAmount:null,unit:'month'},
  custom_domain:{label:'Custom domain support',defaultAmount:null,unit:'month'},
  remove_branding:{label:'Remove MadeDeck branding',defaultAmount:null,unit:'month'},
  additional_seat:{label:'Additional merchant seat',defaultAmount:null,unit:'month'},
  storage_overage:{label:'Storage / asset overage',defaultAmount:null,unit:'usage'},
  email_overage:{label:'Email usage overage',defaultAmount:null,unit:'usage'},
  sms_overage:{label:'SMS usage overage',defaultAmount:null,unit:'usage'},
  ai_credit:{label:'AI generation credits',defaultAmount:null,unit:'usage'},
  featured_listing:{label:'Promoted / featured placement',defaultAmount:null,unit:'campaign'},
  rush_production:{label:'Rush production',defaultAmount:null,unit:'order'},
  shipping_margin:{label:'Shipping service margin',defaultAmount:null,unit:'shipment'},
  packaging_upgrade:{label:'Packaging / inserts upgrade',defaultAmount:null,unit:'order'},
  sample_order:{label:'Sample order service',defaultAmount:null,unit:'order'},
  bulk_service:{label:'Bulk order setup / project management',defaultAmount:null,unit:'project'},
  vendor_service:{label:'Vendor software / lead service',defaultAmount:null,unit:'month'},
  accelerated_payout:{label:'Accelerated merchant payout',defaultAmount:null,unit:'payout'},
  white_label:{label:'White-label platform',defaultAmount:null,unit:'month'},
  api_access:{label:'API / integration access',defaultAmount:null,unit:'month'},
  enterprise:{label:'Enterprise platform service',defaultAmount:null,unit:'contract'},
  direct_pay_campaign:{label:'Direct-pay / fundraising campaign',defaultAmount:null,unit:'campaign'}
};

const ORDER_TRANSITIONS={
  pending:['paid','cancelled'],
  paid:['production','refunded','cancelled'],
  production:['shipped','ready_office','refunded'],
  ready_office:['completed','refunded'],
  shipped:['completed','refunded'],
  completed:['refunded'],
  cancelled:[],
  refunded:[]
};

function hasPermission(role,permission){const set=ROLE_PERMISSIONS[role]||[];return set.includes('*')||set.includes(permission)}
function requirePermission(permission){return (req,res,next)=>{if(!req.user||!hasPermission(req.user.role,permission))return res.status(403).json({ok:false,error:'forbidden',permission});next();}}
function paymentCapabilities(env=process.env){return Object.entries(PAYMENT_PROVIDERS).map(([key,p])=>({key,...p,configured:key==='merchant_portal'?true:!!env[`PAYMENT_${key.toUpperCase()}_ENABLED`]}));}
function vendorSettlementPolicy(){return {autoPayVendor:false,mode:'manual_payable',notifyVendorOnJob:true,notifyOwnerOnOrder:true,approvalRequired:true,allowedApproverRoles:['finance_admin','super_admin']}}

module.exports={ROLE_PERMISSIONS,PAYMENT_PROVIDERS,MONETIZATION_CATALOG,ORDER_TRANSITIONS,hasPermission,requirePermission,paymentCapabilities,vendorSettlementPolicy};
