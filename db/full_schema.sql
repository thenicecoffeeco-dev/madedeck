-- MadeDeck v0.2 FULL DATABASE BUILD
-- Use this with GoDaddy Hosted Database > Import SQL.
-- This file is intentionally a complete replacement dump for an empty database.

SET FOREIGN_KEY_CHECKS=0;

DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS webhook_events;
DROP TABLE IF EXISTS api_keys;
DROP TABLE IF EXISTS invitations;
DROP TABLE IF EXISTS customer_entitlements;
DROP TABLE IF EXISTS payment_connections;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS credit_ledger;
DROP TABLE IF EXISTS credit_wallets;
DROP TABLE IF EXISTS plan_modules;
DROP TABLE IF EXISTS platform_modules;
DROP TABLE IF EXISTS platform_plans;
DROP TABLE IF EXISTS inquiries;
DROP TABLE IF EXISTS bulk_price_tiers;
DROP TABLE IF EXISTS offers;
DROP TABLE IF EXISTS store_members;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS preorder_campaigns;
DROP TABLE IF EXISTS store_assets;
DROP TABLE IF EXISTS store_products;
DROP TABLE IF EXISTS product_price_rules;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS feature_flags;
DROP TABLE IF EXISTS stores;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL DEFAULT '',
  email VARCHAR(190) NOT NULL UNIQUE,
  password_salt VARCHAR(64) NULL,
  password_hash VARCHAR(128) NOT NULL DEFAULT '',
  role ENUM('admin','merchant','customer','platform_admin','merchant_admin','merchant_staff') NOT NULL DEFAULT 'customer',
  status ENUM('active','invited','disabled','suspended') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE stores (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  owner_user_id BIGINT UNSIGNED NULL,
  name VARCHAR(160) NOT NULL,
  slug VARCHAR(120) NOT NULL UNIQUE,
  status ENUM('draft','active','paused','suspended') NOT NULL DEFAULT 'draft',
  allow_direct_ship BOOLEAN NOT NULL DEFAULT TRUE,
  allow_office_delivery BOOLEAN NOT NULL DEFAULT TRUE,
  subscription_status VARCHAR(40) NOT NULL DEFAULT 'trial',
  payment_portal_url VARCHAR(500) NULL,
  fulfillment_mode ENUM('direct','office','both') NOT NULL DEFAULT 'both',
  primary_domain VARCHAR(190) NULL,
  logo_url VARCHAR(500) NULL,
  support_email VARCHAR(190) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  timezone VARCHAR(80) NOT NULL DEFAULT 'America/Chicago',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_store_owner(owner_user_id),
  CONSTRAINT fk_store_owner FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE products (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sku VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  category VARCHAR(80) NOT NULL,
  description TEXT NULL,
  base_cost DECIMAL(10,2) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  min_size VARCHAR(20) NULL,
  max_size VARCHAR(20) NULL,
  supplier VARCHAR(120) NULL,
  supplier_sku VARCHAR(120) NULL,
  production_method VARCHAR(80) NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE product_price_rules (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT UNSIGNED NOT NULL,
  rule_type VARCHAR(60) NOT NULL,
  label VARCHAR(120) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  condition_json JSON NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_price_rule_product(product_id),
  CONSTRAINT fk_price_rule_product FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE store_products (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  retail_price DECIMAL(10,2) NOT NULL,
  title_override VARCHAR(180) NULL,
  description_override TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_store_product(store_id,product_id),
  CONSTRAINT fk_store_product_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_store_product_product FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE store_assets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NULL,
  asset_type ENUM('logo','artwork','mockup','banner','other') NOT NULL DEFAULT 'other',
  file_name VARCHAR(255) NOT NULL,
  file_url VARCHAR(600) NOT NULL,
  mime_type VARCHAR(120) NULL,
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_asset_store(store_id),
  CONSTRAINT fk_asset_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_asset_product FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE preorder_campaigns (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NULL,
  title VARCHAR(180) NOT NULL,
  status ENUM('draft','live','successful','failed','closed','fulfilled','cancelled') NOT NULL DEFAULT 'draft',
  minimum_qty INT UNSIGNED NOT NULL DEFAULT 1,
  committed_qty INT UNSIGNED NOT NULL DEFAULT 0,
  retail_price DECIMAL(10,2) NOT NULL,
  closes_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_preorder_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_preorder_product FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE orders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  customer_email VARCHAR(190) NULL,
  customer_name VARCHAR(190) NULL,
  status ENUM('pending','paid','production','shipped','ready_office','completed','cancelled','refunded') NOT NULL DEFAULT 'pending',
  fulfillment_mode ENUM('direct','office') NOT NULL DEFAULT 'direct',
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  shipping DECIMAL(10,2) NOT NULL DEFAULT 0,
  tax DECIMAL(10,2) NOT NULL DEFAULT 0,
  total DECIMAL(10,2) NOT NULL DEFAULT 0,
  payment_provider VARCHAR(60) NULL,
  payment_reference VARCHAR(190) NULL,
  production_locked_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  shipped_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_orders_store_status(store_id,status),
  CONSTRAINT fk_order_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE order_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NULL,
  offer_id BIGINT UNSIGNED NULL,
  title VARCHAR(190) NOT NULL,
  variant_json JSON NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_order_items_order(order_id),
  CONSTRAINT fk_order_item_order FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_item_product FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE store_members (
  store_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  member_role ENUM('owner','admin','staff','viewer') NOT NULL DEFAULT 'staff',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(store_id,user_id),
  CONSTRAINT fk_member_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_member_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE offers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NULL,
  type ENUM('store','preorder','bulk') NOT NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT NULL,
  status ENUM('draft','scheduled','live','closed','fulfilled','cancelled') NOT NULL DEFAULT 'draft',
  access_mode ENUM('public','paid_customer','private_link') NOT NULL DEFAULT 'public',
  fulfillment_mode ENUM('direct','office','both') NOT NULL DEFAULT 'both',
  retail_price DECIMAL(10,2) NOT NULL,
  minimum_qty INT UNSIGNED NOT NULL DEFAULT 1,
  maximum_qty INT UNSIGNED NULL,
  closes_at DATETIME NULL,
  private_token VARCHAR(96) NULL,
  payment_redirect_url VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_offer_store_status(store_id,status),
  CONSTRAINT fk_offer_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_offer_product FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE order_items
  ADD CONSTRAINT fk_order_item_offer FOREIGN KEY(offer_id) REFERENCES offers(id) ON DELETE SET NULL;

CREATE TABLE bulk_price_tiers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  offer_id BIGINT UNSIGNED NOT NULL,
  min_qty INT UNSIGNED NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  UNIQUE KEY uq_offer_qty(offer_id,min_qty),
  CONSTRAINT fk_bulk_offer FOREIGN KEY(offer_id) REFERENCES offers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE subscriptions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  plan_code VARCHAR(64) NOT NULL,
  status ENUM('trialing','active','past_due','cancelled') NOT NULL DEFAULT 'trialing',
  provider VARCHAR(40) NULL,
  provider_customer_id VARCHAR(190) NULL,
  provider_subscription_id VARCHAR(190) NULL,
  renews_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_subscription_store(store_id,status),
  CONSTRAINT fk_subscription_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE payment_connections (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  provider VARCHAR(40) NOT NULL,
  status ENUM('pending','connected','disabled') NOT NULL DEFAULT 'pending',
  external_account_ref VARCHAR(190) NULL,
  config_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_store_provider(store_id,provider),
  CONSTRAINT fk_payment_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE platform_plans (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  monthly_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  included_credits INT UNSIGNED NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  stripe_price_id VARCHAR(190) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE platform_modules (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(140) NOT NULL,
  description VARCHAR(500) NULL,
  billing_type ENUM('included','monthly','one_time','credits') NOT NULL DEFAULT 'monthly',
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  credit_cost INT UNSIGNED NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  stripe_price_id VARCHAR(190) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE plan_modules (
  plan_id BIGINT UNSIGNED NOT NULL,
  module_id BIGINT UNSIGNED NOT NULL,
  included BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY(plan_id,module_id),
  CONSTRAINT fk_plan_modules_plan FOREIGN KEY(plan_id) REFERENCES platform_plans(id) ON DELETE CASCADE,
  CONSTRAINT fk_plan_modules_module FOREIGN KEY(module_id) REFERENCES platform_modules(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE credit_wallets (
  store_id BIGINT UNSIGNED PRIMARY KEY,
  balance INT NOT NULL DEFAULT 0,
  lifetime_purchased INT UNSIGNED NOT NULL DEFAULT 0,
  lifetime_used INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_credit_wallet_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE credit_ledger (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  amount INT NOT NULL,
  reason VARCHAR(140) NOT NULL,
  reference_type VARCHAR(80) NULL,
  reference_id VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_credit_ledger_store_time(store_id,created_at),
  CONSTRAINT fk_credit_ledger_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inquiries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NULL,
  name VARCHAR(160) NOT NULL DEFAULT '',
  email VARCHAR(190) NOT NULL,
  company VARCHAR(190) NULL,
  source VARCHAR(100) NOT NULL DEFAULT 'website',
  status ENUM('new','contacted','qualified','converted','closed') NOT NULL DEFAULT 'new',
  message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_inquiries_status_time(status,created_at),
  CONSTRAINT fk_inquiry_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE customer_entitlements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  customer_key VARCHAR(190) NOT NULL,
  entitlement VARCHAR(100) NOT NULL DEFAULT 'paid_customer',
  expires_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_entitlement(store_id,customer_key,entitlement),
  CONSTRAINT fk_entitlement_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE feature_flags (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NULL,
  feature_key VARCHAR(100) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  config_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_feature_store_key(store_id,feature_key),
  CONSTRAINT fk_feature_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE invitations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  email VARCHAR(190) NOT NULL,
  member_role ENUM('owner','admin','staff','viewer') NOT NULL DEFAULT 'staff',
  token_hash VARCHAR(128) NOT NULL,
  expires_at DATETIME NOT NULL,
  accepted_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_invite_store_email(store_id,email),
  CONSTRAINT fk_invite_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE api_keys (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NULL,
  label VARCHAR(120) NOT NULL,
  key_prefix VARCHAR(24) NOT NULL,
  key_hash VARCHAR(128) NOT NULL,
  last_used_at DATETIME NULL,
  revoked_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_api_key_store(store_id),
  CONSTRAINT fk_api_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_api_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE webhook_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  provider VARCHAR(50) NOT NULL,
  external_event_id VARCHAR(190) NOT NULL,
  event_type VARCHAR(120) NOT NULL,
  payload_json JSON NULL,
  status ENUM('received','processed','failed','ignored') NOT NULL DEFAULT 'received',
  error_text TEXT NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  UNIQUE KEY uq_webhook_provider_event(provider,external_event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  store_id BIGINT UNSIGNED NULL,
  type VARCHAR(80) NOT NULL,
  title VARCHAR(190) NOT NULL,
  body TEXT NULL,
  read_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notification_user_read(user_id,read_at),
  CONSTRAINT fk_notification_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notification_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE audit_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NULL,
  store_id BIGINT UNSIGNED NULL,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(80) NULL,
  entity_id VARCHAR(80) NULL,
  detail_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_store_time(store_id,created_at),
  CONSTRAINT fk_audit_user FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_audit_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO stores
(id,name,slug,status,allow_direct_ship,allow_office_delivery,subscription_status,fulfillment_mode,support_email)
VALUES
(1,'MadeDeck Demo Store','demo','active',1,1,'trial','both','support@madedeck.com');

INSERT INTO products (id,sku,name,category,description,base_cost,active,min_size,max_size,supplier,production_method) VALUES
(1,'TEE-UNI-STD','Unisex Standard Tee','tshirts','Standard unisex tee, one-sided print.',18.00,1,'S','5XL','SanMar / comparable','DTG/DTF'),
(2,'POLO-TRICOT','Standard Performance Polo','polos','Lightweight 3.8 oz polyester tricot polo.',29.00,1,'S','5XL','SanMar / comparable','DTG'),
(3,'HOOD-STD','Standard Pullover Hoodie','hoodies','Standard no-zip hoodie.',37.00,1,'S','5XL','Sport-Tek / comparable','DTG/DTF'),
(4,'KOOZ-FOAM','Foam Koozie','koozies','Basic foam beverage holder.',5.50,1,NULL,NULL,'Open inventory','Print'),
(5,'HAT-SNAP-PREM','Premium Snapback','hats','Premium snapback hat.',27.00,1,NULL,NULL,'SanMar / comparable','Print/Embroidery'),
(6,'HAT-FLEX','Flex Fit Hat','hats','Flex fit hat, supported sizes.',27.00,1,NULL,NULL,'SanMar / comparable','Print/Embroidery'),
(7,'TOWEL-GOLF','Embroidered Golf Towel','towels','Standard golf towel with embroidery.',30.00,1,NULL,NULL,'SanMar / comparable','Embroidery');

INSERT INTO product_price_rules (product_id,rule_type,label,amount,condition_json) VALUES
(1,'add_on','Back print or sleeve',6.00,NULL),
(1,'size_add_on','2XL through 5XL',2.00,JSON_OBJECT('sizes',JSON_ARRAY('2XL','3XL','4XL','5XL'))),
(4,'quantity_price','10+ koozies base cost',4.00,JSON_OBJECT('minimum_qty',10)),
(5,'embroidery_requirement','Embroidery under 10 surcharge placeholder',0.00,JSON_OBJECT('minimum_qty',10)),
(6,'embroidery_requirement','Embroidery under 10 surcharge placeholder',0.00,JSON_OBJECT('minimum_qty',10));

INSERT INTO store_products (store_id,product_id,enabled,retail_price,sort_order) VALUES
(1,1,1,28.00,10),
(1,5,1,36.00,20),
(1,3,1,54.00,30),
(1,2,1,39.00,40),
(1,4,1,7.00,50),
(1,7,1,38.00,60);

INSERT INTO feature_flags(store_id,feature_key,enabled,config_json) VALUES
(NULL,'preorders',1,NULL),
(NULL,'bulk_offers',1,NULL),
(NULL,'merchant_mockup_uploads',1,NULL),
(NULL,'seo_growth_tools',1,NULL),
(NULL,'office_fulfillment',1,NULL),
(NULL,'direct_fulfillment',1,NULL),
(NULL,'payment_gated_offers',1,NULL);

INSERT INTO platform_plans(code,name,monthly_price,included_credits,active,sort_order) VALUES
('free','Free Studio',0,25,1,10),
('pro','Pro',49,500,1,20),
('advanced','Advanced',129,2000,1,30);

INSERT INTO platform_modules(code,name,description,billing_type,price,credit_cost,active,sort_order) VALUES
('lead-cleanup','Lead Cleanup','Normalize and clean a lead list.','one_time',9,0,1,10),
('prospect-intelligence','Prospect Intelligence','Research, ranking and reputation scan bundle.','one_time',19,0,1,20),
('campaign-launch','Campaign Launch','Scripts, campaign setup and launch workflow.','one_time',29,0,1,30),
('dialer-crm','Dialer + CRM','Calling workspace, outcomes and customer history.','monthly',39,0,1,40),
('product-customizer','Product Customizer','Configurable products and production-ready exports.','monthly',49,0,1,50),
('content-engine','Content Engine','Posts, campaigns and export packages.','credits',0,40,1,60),
('swarm-power','Swarm Power','Taskmaster, bots, missions, approvals and evidence.','monthly',79,0,1,70),
('premium-template-pack','Premium Template Pack','Expanded reusable design and workflow templates.','one_time',29,0,1,80),
('print-credits-50','50 Print Credits','One-time production/export credit pack.','one_time',15,0,1,90);

INSERT INTO credit_wallets(store_id,balance) SELECT id,0 FROM stores;

SET FOREIGN_KEY_CHECKS=1;
