-- MadeDeck modular commerce and product-module foundation.
-- Apply after 004_billing_entitlements.sql. All paid offers remain inactive
-- until their Stripe product/price IDs are configured and verified.

ALTER TABLE billing_offers
  MODIFY tier_code ENUM('FREE','PRO','ADVANCED','COMMAND_CENTER') NULL;

ALTER TABLE user_subscriptions
  MODIFY tier_code ENUM('PRO','ADVANCED','COMMAND_CENTER') NOT NULL;

CREATE TABLE IF NOT EXISTS app_modules (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  module_key VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  module_type ENUM('core','operator','commerce','product','connector','worker') NOT NULL,
  version VARCHAR(40) NOT NULL DEFAULT '1.0.0',
  lifecycle_status ENUM('foundation','ready','disabled','blocked','retired') NOT NULL DEFAULT 'foundation',
  entrypoint VARCHAR(255) NULL,
  manifest_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS action_catalog (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  action_code VARCHAR(100) NOT NULL UNIQUE,
  module_key VARCHAR(100) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT NULL,
  category VARCHAR(80) NOT NULL,
  billing_unit ENUM('action','lead','email','row','page','site','asset','placement','minute','batch','mission') NOT NULL DEFAULT 'action',
  pricing_type ENUM('free','fixed_credits','tiered_credits','estimate','included_with_purchase') NOT NULL DEFAULT 'fixed_credits',
  base_credits INT NOT NULL DEFAULT 0,
  minimum_credits INT NOT NULL DEFAULT 0,
  maximum_credits INT NULL,
  quantity_step INT NOT NULL DEFAULT 1,
  preview_quantity INT NOT NULL DEFAULT 0,
  standalone_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  swarm_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  confirmation_policy ENUM('none','always','above_threshold','admin') NOT NULL DEFAULT 'always',
  worker_key VARCHAR(100) NULL,
  pricing_config_json JSON NULL,
  output_contract_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_action_catalog_module(module_key,active),
  CONSTRAINT fk_action_catalog_module FOREIGN KEY(module_key) REFERENCES app_modules(module_key) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plan_action_allowances (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tier_code ENUM('FREE','PRO','ADVANCED','COMMAND_CENTER') NOT NULL,
  action_code VARCHAR(100) NOT NULL,
  included_quantity INT NOT NULL DEFAULT 0,
  allowance_period ENUM('lifetime','month','order') NOT NULL DEFAULT 'month',
  overage_credit_multiplier DECIMAL(8,4) NOT NULL DEFAULT 1.0000,
  config_json JSON NULL,
  UNIQUE KEY uq_plan_action(tier_code,action_code),
  CONSTRAINT fk_plan_action_catalog FOREIGN KEY(action_code) REFERENCES action_catalog(action_code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bundle_actions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  billing_offer_id BIGINT UNSIGNED NOT NULL,
  action_code VARCHAR(100) NOT NULL,
  included_quantity INT NOT NULL DEFAULT 1,
  config_json JSON NULL,
  UNIQUE KEY uq_bundle_action(billing_offer_id,action_code),
  CONSTRAINT fk_bundle_action_offer FOREIGN KEY(billing_offer_id) REFERENCES billing_offers(id) ON DELETE CASCADE,
  CONSTRAINT fk_bundle_action_catalog FOREIGN KEY(action_code) REFERENCES action_catalog(action_code) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS credit_reservations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reservation_key CHAR(36) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  action_code VARCHAR(100) NOT NULL,
  job_key CHAR(36) NULL,
  reserved_credits INT NOT NULL,
  settled_credits INT NULL,
  state ENUM('reserved','settled','released','expired') NOT NULL DEFAULT 'reserved',
  estimate_json JSON NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at DATETIME NULL,
  INDEX idx_credit_reservation_user(user_id,state,expires_at),
  CONSTRAINT fk_credit_reservation_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_credit_reservation_action FOREIGN KEY(action_code) REFERENCES action_catalog(action_code) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS product_customizer_modules (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_type_key VARCHAR(80) NOT NULL UNIQUE,
  module_key VARCHAR(100) NOT NULL,
  name VARCHAR(160) NOT NULL,
  editor_adapter VARCHAR(80) NOT NULL DEFAULT 'fabric-object-canvas',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  supports_color_variants BOOLEAN NOT NULL DEFAULT TRUE,
  supports_multiple_views BOOLEAN NOT NULL DEFAULT TRUE,
  supports_vector_export BOOLEAN NOT NULL DEFAULT TRUE,
  supports_cutline BOOLEAN NOT NULL DEFAULT FALSE,
  configuration_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_customizer_module FOREIGN KEY(module_key) REFERENCES app_modules(module_key) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO app_modules(module_key,name,module_type,version,lifecycle_status) VALUES
('commerce.action-catalog','Action Catalog & Usage Billing','commerce','1.0.0','foundation'),
('operator.leads','Lead Operations','operator','1.0.0','foundation'),
('operator.intelligence','Research & Intelligence','operator','1.0.0','foundation'),
('operator.campaigns','Campaign Production','operator','1.0.0','foundation'),
('swarm.missions','Swarm Missions','core','1.0.0','foundation'),
('product.apparel','Apparel Customizer','product','1.0.0','foundation'),
('product.stickers','Sticker & Label Customizer','product','1.0.0','foundation'),
('product.promo','Promotional Product Customizer','product','1.0.0','foundation'),
('commerce.fulfillment','Direct Customer Fulfillment','commerce','1.0.0','foundation')
ON DUPLICATE KEY UPDATE name=VALUES(name),module_type=VALUES(module_type),version=VALUES(version);

INSERT INTO action_catalog
(action_code,module_key,name,description,category,billing_unit,pricing_type,base_credits,minimum_credits,maximum_credits,quantity_step,preview_quantity,worker_key,pricing_config_json) VALUES
('leads.digest_250','operator.leads','Digest 250 rows','Normalize, map and deduplicate an uploaded lead list.','leads','row','fixed_credits',1,1,NULL,250,25,'lead-digester',JSON_OBJECT('creditsPerStep',1)),
('leads.rank_100','operator.leads','Rank 100 leads','Score and segment existing CRM leads.','leads','lead','fixed_credits',1,1,NULL,100,10,'lead-ranker',JSON_OBJECT('creditsPerStep',1)),
('leads.enrich','operator.leads','Enrich a lead','Recover and verify missing company or contact fields.','leads','lead','tiered_credits',1,1,3,1,1,'lead-enricher',JSON_OBJECT('standard',1,'deep',3)),
('leads.email_verify','operator.leads','Verify an email','Return deliverability and confidence evidence.','leads','email','fixed_credits',1,1,NULL,1,1,'email-verifier',NULL),
('intel.reputation_scan','operator.intelligence','Reputation scan','Review and sentiment snapshot with source evidence.','intelligence','site','fixed_credits',1,1,NULL,1,1,'reputation-monitor',NULL),
('intel.company_research','operator.intelligence','Company research','Evidence-backed standard company brief.','intelligence','site','fixed_credits',2,2,NULL,1,1,'research-bot',NULL),
('intel.decision_maker','operator.intelligence','Decision-maker search','Find and rank relevant contacts.','intelligence','lead','tiered_credits',2,2,5,1,1,'research-bot',JSON_OBJECT('standard',2,'deep',5)),
('intel.war_room','operator.intelligence','Deep War Room report','Full website, reputation, competitor and opportunity analysis.','intelligence','site','fixed_credits',5,5,NULL,1,0,'war-room',NULL),
('intel.competitive_report','operator.intelligence','Competitive report','Competitor comparison and opportunity evidence pack.','intelligence','site','tiered_credits',10,10,25,1,0,'comparator-bot',JSON_OBJECT('standard',10,'deep',25)),
('campaign.personalized_contact','operator.campaigns','Personalized email and call script','One personalized email plus matching call script.','campaigns','lead','fixed_credits',1,1,NULL,1,1,'sales-bot',NULL),
('campaign.email_sequence','operator.campaigns','Complete email sequence','Multi-step outreach and follow-up sequence.','campaigns','lead','fixed_credits',5,5,NULL,1,0,'sales-bot',NULL),
('campaign.proposal','operator.campaigns','Proposal package','Branded proposal with editable source.','campaigns','action','fixed_credits',15,15,NULL,1,0,'proposal-bot',NULL),
('campaign.landing_page','operator.campaigns','Landing-page package','Landing-page structure, copy and conversion assets.','campaigns','action','fixed_credits',25,25,NULL,1,0,'content-bot',NULL),
('campaign.content_20','operator.campaigns','20-post content package','Twenty branded posts and campaign copy.','campaigns','batch','fixed_credits',40,40,NULL,1,0,'content-bot',NULL),
('print.mockup_view','product.apparel','Product mockup view','Generate one product/color/view visualization.','print','asset','tiered_credits',1,1,3,1,1,'mockup-renderer',JSON_OBJECT('standard',1,'premium',3)),
('print.background_remove','product.apparel','Background removal','Create a transparent production asset.','print','asset','fixed_credits',1,1,NULL,1,1,'asset-processor',NULL),
('print.image_enhance','product.apparel','Image enhancement','Upscale and prepare a raster asset for production.','print','asset','tiered_credits',2,2,5,1,0,'asset-processor',JSON_OBJECT('standard',2,'deep',5)),
('print.high_res_export','product.apparel','High-resolution export','Full-resolution production export for one placement.','print','placement','fixed_credits',5,5,NULL,1,0,'print-exporter',NULL),
('print.purchased_product_export','product.apparel','Purchased-product export','Production export attached to a purchased MadeDeck product.','print','placement','included_with_purchase',0,0,0,1,0,'print-exporter',NULL),
('fulfillment.send_to_customer','commerce.fulfillment','Send product to customer','Create, approve and track a direct-to-customer product shipment. Product, tax and shipping are quoted separately.','fulfillment','action','included_with_purchase',0,0,0,1,0,'fulfillment-dispatcher',JSON_OBJECT('physicalCostsSeparate',true,'addressRequired',true)),
('swarm.custom_mission','swarm.missions','Custom Swarm mission','Coordinated multi-bot mission with a preflight estimate.','swarm','mission','estimate',0,1,NULL,1,0,'taskmaster',NULL)
ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),base_credits=VALUES(base_credits),pricing_config_json=VALUES(pricing_config_json);

INSERT INTO billing_offers
(offer_code,name,purchase_mode,tier_code,entitlement_key,credit_grant,active,config_json) VALUES
('command_center_monthly','Command Center','subscription','COMMAND_CENTER','made_deck_command_center',6000,0,JSON_OBJECT('displayPriceUsd',399,'teamSeats',5,'crmRecords',250000)),
('credits_100','100 Usage Credits','payment',NULL,NULL,100,0,JSON_OBJECT('displayPriceUsd',10,'neverExpires',true)),
('credits_500','500 Usage Credits','payment',NULL,NULL,500,0,JSON_OBJECT('displayPriceUsd',39,'neverExpires',true)),
('credits_1500','1,500 Usage Credits','payment',NULL,NULL,1500,0,JSON_OBJECT('displayPriceUsd',99,'neverExpires',true)),
('credits_5000','5,000 Usage Credits','payment',NULL,NULL,5000,0,JSON_OBJECT('displayPriceUsd',249,'neverExpires',true)),
('credits_15000','15,000 Agency Credits','payment',NULL,NULL,15000,0,JSON_OBJECT('displayPriceUsd',599,'neverExpires',true)),
('pack_lead_cleanup','Lead Cleanup Pack','payment',NULL,'pack_lead_cleanup',0,0,JSON_OBJECT('displayPriceUsd',9)),
('pack_prospect_intelligence','Prospect Intelligence Pack','payment',NULL,'pack_prospect_intelligence',0,0,JSON_OBJECT('displayPriceUsd',19)),
('pack_campaign_launch','Campaign Launch Pack','payment',NULL,'pack_campaign_launch',0,0,JSON_OBJECT('displayPriceUsd',29)),
('pack_content_sprint','Content Sprint','payment',NULL,'pack_content_sprint',0,0,JSON_OBJECT('displayPriceUsd',19)),
('pack_merch_launch','MadeDeck Merch Launch','payment',NULL,'pack_merch_launch',0,0,JSON_OBJECT('displayPriceUsd',29)),
('pack_full_sales','Full Sales Pack','payment',NULL,'pack_full_sales',0,0,JSON_OBJECT('displayPriceUsd',49)),
('pack_growth_engine','Growth Engine','payment',NULL,'pack_growth_engine',0,0,JSON_OBJECT('displayPriceUsd',99)),
('pack_agency_launch','Agency Client Launch','payment',NULL,'pack_agency_launch',0,0,JSON_OBJECT('displayPriceUsd',199)),
('pack_command_deployment','Business Command Deployment','payment',NULL,'pack_command_deployment',0,0,JSON_OBJECT('displayPriceUsd',499))
ON DUPLICATE KEY UPDATE name=VALUES(name),tier_code=VALUES(tier_code),entitlement_key=VALUES(entitlement_key),credit_grant=VALUES(credit_grant),config_json=VALUES(config_json);

INSERT INTO product_customizer_modules
(product_type_key,module_key,name,supports_color_variants,supports_multiple_views,supports_vector_export,supports_cutline,configuration_json) VALUES
('tee','product.apparel','T-Shirts',1,1,1,0,JSON_OBJECT('views',JSON_ARRAY('front','back','chest','left-sleeve','right-sleeve'),'printMethods',JSON_ARRAY('dtg','dtf'))),
('hoodie','product.apparel','Hoodies',1,1,1,0,JSON_OBJECT('views',JSON_ARRAY('front','back','chest','left-sleeve','right-sleeve'),'printMethods',JSON_ARRAY('dtg','dtf'))),
('polo','product.apparel','Polos',1,1,1,0,JSON_OBJECT('views',JSON_ARRAY('left-chest','right-chest','neck','left-sleeve','right-sleeve'),'printMethods',JSON_ARRAY('embroidery'))),
('hat','product.apparel','Hats',1,1,1,0,JSON_OBJECT('views',JSON_ARRAY('front'),'printMethods',JSON_ARRAY('print','embroidery'))),
('sticker','product.stickers','Custom Stickers',0,0,1,1,JSON_OBJECT('sizes',JSON_ARRAY('2x2','3x3','5x4'),'shapes',JSON_ARRAY('square','circle','oval','die-cut'),'requiresCutline',true)),
('label','product.stickers','Custom Labels',0,0,1,1,JSON_OBJECT('shapes',JSON_ARRAY('square','circle','oval','die-cut'),'requiresCutline',true)),
('koozie','product.promo','Koozies',1,1,1,0,JSON_OBJECT('views',JSON_ARRAY('front'),'printMethods',JSON_ARRAY('print'))),
('towel','product.promo','Towels',1,1,1,0,JSON_OBJECT('views',JSON_ARRAY('front'),'printMethods',JSON_ARRAY('embroidery')))
ON DUPLICATE KEY UPDATE name=VALUES(name),module_key=VALUES(module_key),configuration_json=VALUES(configuration_json);

CREATE TABLE IF NOT EXISTS fulfillment_dispatches (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dispatch_key CHAR(36) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NULL,
  source_design_id BIGINT UNSIGNED NULL,
  source_product_id BIGINT UNSIGNED NULL,
  recipient_name VARCHAR(190) NOT NULL,
  recipient_email VARCHAR(254) NULL,
  recipient_address_ciphertext MEDIUMBLOB NOT NULL,
  recipient_postal_hint VARCHAR(24) NULL,
  customer_message TEXT NULL,
  quantity INT NOT NULL DEFAULT 1,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  product_amount BIGINT NOT NULL DEFAULT 0,
  shipping_amount BIGINT NOT NULL DEFAULT 0,
  tax_amount BIGINT NOT NULL DEFAULT 0,
  total_amount BIGINT NOT NULL DEFAULT 0,
  quote_json JSON NULL,
  production_asset_json JSON NULL,
  payment_status ENUM('quote','requires_payment','paid','failed','refunded') NOT NULL DEFAULT 'quote',
  fulfillment_status ENUM('draft','quoted','approved','production','shipped','delivered','canceled','exception') NOT NULL DEFAULT 'draft',
  provider_key VARCHAR(100) NULL,
  provider_order_id VARCHAR(190) NULL,
  carrier VARCHAR(100) NULL,
  tracking_number VARCHAR(190) NULL,
  tracking_url VARCHAR(500) NULL,
  approved_at DATETIME NULL,
  shipped_at DATETIME NULL,
  delivered_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_dispatch_user_status(user_id,fulfillment_status,created_at),
  INDEX idx_dispatch_provider(provider_key,provider_order_id),
  CONSTRAINT fk_dispatch_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
