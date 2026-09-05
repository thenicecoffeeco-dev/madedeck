-- Complete the MadeDeck pricing map and isolate communication email routing.
-- Apply after 011_account_connection_backbone.sql.
-- Additive and safe to rerun. Stripe IDs remain unset until test-mode verification.

ALTER TABLE billing_offers MODIFY tier_code VARCHAR(40) NULL;
ALTER TABLE user_subscriptions MODIFY tier_code VARCHAR(40) NOT NULL;

ALTER TABLE billing_offers ADD COLUMN IF NOT EXISTS price_cents INT UNSIGNED NULL AFTER credit_grant;
ALTER TABLE billing_offers ADD COLUMN IF NOT EXISTS billing_interval ENUM('none','month','year','custom') NOT NULL DEFAULT 'none' AFTER price_cents;
ALTER TABLE billing_offers ADD COLUMN IF NOT EXISTS price_version VARCHAR(40) NOT NULL DEFAULT '2026-09-04' AFTER billing_interval;

INSERT INTO billing_offers
(offer_code,name,purchase_mode,tier_code,entitlement_key,credit_grant,price_cents,billing_interval,price_version,active,config_json) VALUES
('launch','Launch','free','LAUNCH',NULL,0,0,'none','2026-09-04',1,JSON_OBJECT('storageItems',3)),
('creator_monthly','Creator Monthly','subscription','CREATOR','made_deck_creator',25,1900,'month','2026-09-04',0,JSON_OBJECT('rolloverMonths',3)),
('creator_yearly','Creator Yearly','subscription','CREATOR','made_deck_creator',300,19000,'year','2026-09-04',0,JSON_OBJECT('rolloverMonths',3)),
('pro_monthly_v2','Pro Monthly','subscription','PRO','made_deck_pro',75,3900,'month','2026-09-04',0,JSON_OBJECT('rolloverMonths',3)),
('pro_yearly','Pro Yearly','subscription','PRO','made_deck_pro',900,39000,'year','2026-09-04',0,JSON_OBJECT('rolloverMonths',3)),
('studio_monthly','Studio Monthly','subscription','STUDIO','made_deck_studio',200,7900,'month','2026-09-04',0,JSON_OBJECT('rolloverMonths',3)),
('studio_yearly','Studio Yearly','subscription','STUDIO','made_deck_studio',2400,79000,'year','2026-09-04',0,JSON_OBJECT('rolloverMonths',3)),
('enterprise','Enterprise','payment','ENTERPRISE','made_deck_enterprise',0,NULL,'custom','2026-09-04',0,JSON_OBJECT('quoteRequired',true)),
('credits_9','Credit Pack $9','payment',NULL,NULL,0,900,'none','2026-09-04',0,JSON_OBJECT('purchasedCreditsNeverExpire',true)),
('credits_19','Credit Pack $19','payment',NULL,NULL,0,1900,'none','2026-09-04',0,JSON_OBJECT('purchasedCreditsNeverExpire',true)),
('credits_29','Credit Pack $29','payment',NULL,NULL,0,2900,'none','2026-09-04',0,JSON_OBJECT('purchasedCreditsNeverExpire',true)),
('promo_launch_99','Promotional Launch Set','payment',NULL,'promo_launch_set',0,9900,'none','2026-09-04',0,JSON_OBJECT('subscriptionMonthOffer','requires_autopay','contents','configured_by_admin')),
('business_cards_250','250 Two-sided Business Cards','payment',NULL,NULL,50,4500,'none','2026-09-04',0,JSON_OBJECT('cashOrCredits',true,'creditCost',50)),
('social_posts_20','20-post Marketing Package','payment',NULL,NULL,0,NULL,'custom','2026-09-04',0,JSON_OBJECT('quoteOrCredits',true))
ON DUPLICATE KEY UPDATE name=VALUES(name),purchase_mode=VALUES(purchase_mode),tier_code=VALUES(tier_code),
entitlement_key=VALUES(entitlement_key),credit_grant=VALUES(credit_grant),price_cents=VALUES(price_cents),
billing_interval=VALUES(billing_interval),price_version=VALUES(price_version),config_json=VALUES(config_json);

-- Retain legacy codes for audit/history, but keep them unavailable for new Checkout.
UPDATE billing_offers SET active=0 WHERE offer_code IN ('free','pro_monthly','advanced_monthly','command_center_monthly','print_credits_50');

-- Canonical physical-product base pricing and extended sizes.
UPDATE products SET base_cost=18.00,min_size='S',max_size='5XL' WHERE sku='TEE-UNI-STD';
UPDATE products SET base_cost=26.00,min_size='S',max_size='3XL' WHERE sku='HOOD-STD';
UPDATE products SET base_cost=29.00,min_size='S',max_size='3XL' WHERE sku='POLO-TRICOT';

DELETE FROM product_price_rules WHERE product_id IN (SELECT id FROM products WHERE sku IN ('TEE-UNI-STD','HOOD-STD','POLO-TRICOT')) AND rule_type='size_add_on';
INSERT INTO product_price_rules(product_id,rule_type,label,amount,condition_json)
SELECT id,'size_add_on','2XL',2.00,JSON_OBJECT('size','2XL') FROM products WHERE sku IN ('TEE-UNI-STD','HOOD-STD','POLO-TRICOT');
INSERT INTO product_price_rules(product_id,rule_type,label,amount,condition_json)
SELECT id,'size_add_on','3XL',4.00,JSON_OBJECT('size','3XL') FROM products WHERE sku IN ('TEE-UNI-STD','HOOD-STD','POLO-TRICOT');
INSERT INTO product_price_rules(product_id,rule_type,label,amount,condition_json)
SELECT id,'size_add_on','4XL',6.00,JSON_OBJECT('size','4XL') FROM products WHERE sku='TEE-UNI-STD';
INSERT INTO product_price_rules(product_id,rule_type,label,amount,condition_json)
SELECT id,'size_add_on','5XL',8.00,JSON_OBJECT('size','5XL') FROM products WHERE sku='TEE-UNI-STD';

CREATE TABLE IF NOT EXISTS account_email_endpoints (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  endpoint_ref CHAR(36) NOT NULL UNIQUE,
  account_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NULL,
  purpose ENUM('owner_alerts','orders','billing','support','marketing','recovery') NOT NULL,
  email VARCHAR(254) NOT NULL,
  status ENUM('pending','verified','disabled','bounced') NOT NULL DEFAULT 'pending',
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at DATETIME NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  updated_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_email_endpoint(account_id,store_id,purpose,email),
  INDEX idx_email_route(account_id,store_id,purpose,status,is_primary),
  CONSTRAINT fk_email_endpoint_account FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_email_endpoint_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_email_endpoint_creator FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_email_endpoint_updater FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  endpoint_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_email_verify_endpoint FOREIGN KEY(endpoint_id) REFERENCES account_email_endpoints(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS email_delivery_outbox (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_ref CHAR(36) NOT NULL UNIQUE,
  account_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NULL,
  purpose ENUM('owner_alerts','orders','billing','support','marketing','recovery') NOT NULL,
  template_key VARCHAR(120) NOT NULL,
  recipient_endpoint_id BIGINT UNSIGNED NOT NULL,
  payload_json JSON NOT NULL,
  status ENUM('queued','working','sent','retry','dead_letter','canceled') NOT NULL DEFAULT 'queued',
  idempotency_key VARCHAR(190) NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at DATETIME NULL,
  last_error VARCHAR(1000) NULL,
  provider_message_id VARCHAR(190) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  UNIQUE KEY uq_email_delivery_idempotency(account_id,idempotency_key),
  INDEX idx_email_worker(status,next_attempt_at),
  CONSTRAINT fk_email_outbox_account FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_email_outbox_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_email_outbox_endpoint FOREIGN KEY(recipient_endpoint_id) REFERENCES account_email_endpoints(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS email_delivery_attempts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  outbox_id BIGINT UNSIGNED NOT NULL,
  provider VARCHAR(80) NOT NULL,
  attempt_number INT UNSIGNED NOT NULL,
  response_code VARCHAR(80) NULL,
  response_json JSON NULL,
  error_text VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_email_attempt(outbox_id,attempt_number),
  CONSTRAINT fk_email_attempt_outbox FOREIGN KEY(outbox_id) REFERENCES email_delivery_outbox(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Deliberately no trigger updates users.email, users.role, store ownership, or account membership.
