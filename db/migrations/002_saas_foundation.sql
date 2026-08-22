-- MadeDeck v0.2 compatibility + SaaS foundation
-- Designed to upgrade the existing v0.1 database already imported in GoDaddy.

ALTER TABLE users
  ADD COLUMN password_salt VARCHAR(64) NULL AFTER email,
  MODIFY COLUMN role ENUM('admin','merchant','customer','platform_admin','merchant_admin','merchant_staff') NOT NULL,
  MODIFY COLUMN status ENUM('active','invited','disabled','suspended') NOT NULL DEFAULT 'active';

ALTER TABLE stores
  ADD COLUMN owner_user_id BIGINT UNSIGNED NULL AFTER id,
  ADD COLUMN payment_portal_url VARCHAR(500) NULL AFTER subscription_status,
  ADD COLUMN fulfillment_mode ENUM('direct','office','both') NOT NULL DEFAULT 'both' AFTER payment_portal_url,
  ADD INDEX idx_store_owner (owner_user_id),
  ADD CONSTRAINT fk_store_owner FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS store_members (
  store_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  member_role ENUM('owner','admin','staff','viewer') NOT NULL DEFAULT 'staff',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(store_id,user_id),
  CONSTRAINT fk_member_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_member_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS offers (
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
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_offer_store_status (store_id,status),
  CONSTRAINT fk_offer_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_offer_product FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bulk_price_tiers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  offer_id BIGINT UNSIGNED NOT NULL,
  min_qty INT UNSIGNED NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  UNIQUE KEY uq_offer_qty(offer_id,min_qty),
  CONSTRAINT fk_bulk_offer FOREIGN KEY(offer_id) REFERENCES offers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS subscriptions (
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
  INDEX idx_subscription_store (store_id,status),
  CONSTRAINT fk_subscription_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payment_connections (
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

CREATE TABLE IF NOT EXISTS customer_entitlements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  customer_key VARCHAR(190) NOT NULL,
  entitlement VARCHAR(100) NOT NULL DEFAULT 'paid_customer',
  expires_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_entitlement(store_id,customer_key,entitlement),
  CONSTRAINT fk_entitlement_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS feature_flags (
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

CREATE TABLE IF NOT EXISTS invitations (
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

CREATE TABLE IF NOT EXISTS api_keys (
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

CREATE TABLE IF NOT EXISTS webhook_events (
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

CREATE TABLE IF NOT EXISTS notifications (
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

CREATE TABLE IF NOT EXISTS audit_log (
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

INSERT INTO stores (id,name,slug,status,allow_direct_ship,allow_office_delivery,subscription_status,fulfillment_mode)
SELECT 1,'MadeDeck Demo Store','demo','draft',1,1,'trial','both'
WHERE NOT EXISTS (SELECT 1 FROM stores WHERE id=1);
