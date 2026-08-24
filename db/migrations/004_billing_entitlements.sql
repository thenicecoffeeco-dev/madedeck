-- MadeDeck billing, subscriptions, entitlements and credit ledger foundation.
-- Apply after 003_swarm_power_console.sql. Stripe IDs remain unset until Dashboard setup.

CREATE TABLE IF NOT EXISTS billing_offers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  offer_code VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  purchase_mode ENUM('free','subscription','payment') NOT NULL,
  tier_code ENUM('FREE','PRO','ADVANCED') NULL,
  entitlement_key VARCHAR(100) NULL,
  credit_grant INT NOT NULL DEFAULT 0,
  stripe_product_id VARCHAR(190) NULL UNIQUE,
  stripe_price_id VARCHAR(190) NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  config_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stripe_customers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  stripe_customer_id VARCHAR(190) NOT NULL UNIQUE,
  livemode BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_stripe_customer_user_mode(user_id,livemode),
  CONSTRAINT fk_stripe_customer_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  billing_offer_id BIGINT UNSIGNED NOT NULL,
  stripe_subscription_id VARCHAR(190) NOT NULL UNIQUE,
  stripe_customer_id VARCHAR(190) NOT NULL,
  stripe_price_id VARCHAR(190) NOT NULL,
  tier_code ENUM('PRO','ADVANCED') NOT NULL,
  status VARCHAR(50) NOT NULL,
  current_period_end DATETIME NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  ended_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_subscription_access(user_id,status,current_period_end),
  CONSTRAINT fk_user_subscription_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_subscription_offer FOREIGN KEY(billing_offer_id) REFERENCES billing_offers(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS purchase_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  billing_offer_id BIGINT UNSIGNED NOT NULL,
  stripe_checkout_session_id VARCHAR(190) NOT NULL UNIQUE,
  stripe_payment_intent_id VARCHAR(190) NULL UNIQUE,
  amount_total BIGINT NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  status ENUM('pending','paid','failed','refunded','disputed') NOT NULL DEFAULT 'pending',
  description VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_purchase_user_time(user_id,created_at),
  CONSTRAINT fk_purchase_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_offer FOREIGN KEY(billing_offer_id) REFERENCES billing_offers(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS credit_ledger (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  credit_type VARCHAR(80) NOT NULL DEFAULT 'print',
  amount INT NOT NULL,
  reason VARCHAR(160) NOT NULL,
  source_type VARCHAR(80) NOT NULL,
  source_id VARCHAR(190) NOT NULL,
  expires_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_credit_source(user_id,credit_type,source_type,source_id),
  INDEX idx_credit_balance(user_id,credit_type,expires_at),
  CONSTRAINT fk_credit_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO billing_offers
(offer_code,name,purchase_mode,tier_code,entitlement_key,credit_grant,active) VALUES
('free','Free','free','FREE',NULL,0,1),
('pro_monthly','Pro Subscriber','subscription','PRO','made_deck_pro',0,0),
('advanced_monthly','Advanced Subscriber','subscription','ADVANCED','made_deck_advanced',0,0),
('print_credits_50','50 Print Credits','payment',NULL,NULL,50,0),
('premium_template_pack','Premium Template Pack','payment',NULL,'premium_template_pack',0,0)
ON DUPLICATE KEY UPDATE name=VALUES(name),purchase_mode=VALUES(purchase_mode),tier_code=VALUES(tier_code),entitlement_key=VALUES(entitlement_key),credit_grant=VALUES(credit_grant);

