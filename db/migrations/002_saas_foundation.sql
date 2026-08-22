-- MadeDeck v0.2 additive SaaS foundation
CREATE TABLE IF NOT EXISTS users (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 email VARCHAR(190) NOT NULL UNIQUE,
 password_salt VARCHAR(64) NOT NULL,
 password_hash VARCHAR(128) NOT NULL,
 role ENUM('platform_admin','merchant_admin','merchant_staff','customer') NOT NULL,
 status ENUM('active','invited','suspended') NOT NULL DEFAULT 'active',
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS stores (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 owner_user_id BIGINT UNSIGNED NULL,
 name VARCHAR(160) NOT NULL,
 slug VARCHAR(120) NOT NULL UNIQUE,
 status ENUM('draft','active','paused','suspended') NOT NULL DEFAULT 'draft',
 payment_portal_url VARCHAR(500) NULL,
 fulfillment_mode ENUM('direct','office','both') NOT NULL DEFAULT 'both',
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS store_members (
 store_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL,
 member_role ENUM('owner','admin','staff','viewer') NOT NULL DEFAULT 'staff',
 PRIMARY KEY(store_id,user_id),
 FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS offers (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 store_id BIGINT UNSIGNED NOT NULL,
 product_id BIGINT UNSIGNED NULL,
 type ENUM('store','preorder','bulk') NOT NULL,
 title VARCHAR(180) NOT NULL,
 status ENUM('draft','scheduled','live','closed','fulfilled','cancelled') NOT NULL DEFAULT 'draft',
 access_mode ENUM('public','paid_customer','private_link') NOT NULL DEFAULT 'public',
 fulfillment_mode ENUM('direct','office','both') NOT NULL DEFAULT 'both',
 retail_price DECIMAL(10,2) NOT NULL,
 minimum_qty INT UNSIGNED NOT NULL DEFAULT 1,
 closes_at DATETIME NULL,
 private_token VARCHAR(96) NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS bulk_price_tiers (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 offer_id BIGINT UNSIGNED NOT NULL,
 min_qty INT UNSIGNED NOT NULL,
 unit_price DECIMAL(10,2) NOT NULL,
 UNIQUE KEY uq_offer_qty(offer_id,min_qty),
 FOREIGN KEY(offer_id) REFERENCES offers(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS subscriptions (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 store_id BIGINT UNSIGNED NOT NULL,
 plan_code VARCHAR(64) NOT NULL,
 status ENUM('trialing','active','past_due','cancelled') NOT NULL DEFAULT 'trialing',
 provider VARCHAR(40) NULL,
 provider_customer_id VARCHAR(190) NULL,
 renews_at DATETIME NULL,
 FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS payment_connections (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 store_id BIGINT UNSIGNED NOT NULL,
 provider VARCHAR(40) NOT NULL,
 status ENUM('pending','connected','disabled') NOT NULL DEFAULT 'pending',
 external_account_ref VARCHAR(190) NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_store_provider(store_id,provider),
 FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS customer_entitlements (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 store_id BIGINT UNSIGNED NOT NULL,
 customer_key VARCHAR(190) NOT NULL,
 entitlement VARCHAR(100) NOT NULL DEFAULT 'paid_customer',
 expires_at DATETIME NULL,
 UNIQUE KEY uq_entitlement(store_id,customer_key,entitlement),
 FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS feature_flags (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 store_id BIGINT UNSIGNED NULL,
 feature_key VARCHAR(100) NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT FALSE,
 config_json JSON NULL,
 UNIQUE KEY uq_feature(store_id,feature_key),
 FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS audit_log (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 actor_user_id BIGINT UNSIGNED NULL,
 store_id BIGINT UNSIGNED NULL,
 action VARCHAR(120) NOT NULL,
 entity_type VARCHAR(80) NULL,
 entity_id VARCHAR(80) NULL,
 detail_json JSON NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_audit_store_time(store_id,created_at)
);
