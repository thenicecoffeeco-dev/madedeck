-- MadeDeck 011: account isolation + connection backbone
-- Additive MySQL 8 migration. Apply after 010_saas_owner_command_center.sql.

CREATE TABLE IF NOT EXISTS accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_key VARCHAR(80) NOT NULL UNIQUE,
  account_type ENUM('platform','merchant','subscriber','creator','demo','qa','guest') NOT NULL,
  name VARCHAR(160) NOT NULL,
  status ENUM('active','invited','paused','suspended','archived') NOT NULL DEFAULT 'active',
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS account_memberships (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NULL,
  profile_key VARCHAR(100) NULL,
  role_key ENUM('super','operator','partner','merchant','customer','subscriber','creator','staff','guest') NOT NULL,
  permissions_json JSON NULL,
  subscription_json JSON NULL,
  status ENUM('active','invited','disabled') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_account_user_role(account_id,user_id,role_key),
  INDEX idx_membership_user_status(user_id,status),
  INDEX idx_membership_store_role(store_id,role_key),
  CONSTRAINT fk_membership_account FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_membership_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_membership_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS session_key CHAR(36) NULL;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS account_id BIGINT UNSIGNED NULL;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS membership_id BIGINT UNSIGNED NULL;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS store_id BIGINT UNSIGNED NULL;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS profile_key VARCHAR(100) NULL;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS acting_role VARCHAR(40) NULL;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS permissions_json JSON NULL;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS subscription_json JSON NULL;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS last_seen_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS provider_connections (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  connection_ref VARCHAR(40) NOT NULL UNIQUE,
  account_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NULL,
  provider VARCHAR(80) NOT NULL,
  external_account_ref VARCHAR(190) NULL,
  status ENUM('authorization_required','healthy','degraded','disconnected','revoked') NOT NULL DEFAULT 'authorization_required',
  encrypted_credentials MEDIUMBLOB NULL,
  scopes_json JSON NULL,
  health_json JSON NULL,
  token_expires_at DATETIME NULL,
  last_success_at DATETIME NULL,
  last_failure_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_provider_owner(account_id,store_id,provider,external_account_ref),
  INDEX idx_provider_health(account_id,status),
  CONSTRAINT fk_provider_account FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_provider_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS idempotency_records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id BIGINT UNSIGNED NOT NULL,
  idempotency_key VARCHAR(190) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  status ENUM('working','completed','failed') NOT NULL DEFAULT 'working',
  response_code SMALLINT UNSIGNED NULL,
  response_json JSON NULL,
  locked_until DATETIME NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_idempotency_account(account_id,idempotency_key),
  CONSTRAINT fk_idempotency_account FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS event_outbox (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_ref VARCHAR(40) NOT NULL UNIQUE,
  account_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NULL,
  profile_key VARCHAR(100) NULL,
  event_type VARCHAR(120) NOT NULL,
  aggregate_type VARCHAR(80) NOT NULL,
  aggregate_ref VARCHAR(80) NOT NULL,
  payload_json JSON NOT NULL,
  status ENUM('queued','working','completed','dead_letter') NOT NULL DEFAULT 'queued',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts INT UNSIGNED NOT NULL DEFAULT 8,
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at DATETIME NULL,
  locked_by VARCHAR(120) NULL,
  last_error TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  INDEX idx_outbox_worker(status,next_attempt_at),
  INDEX idx_outbox_scope(account_id,store_id,event_type),
  CONSTRAINT fk_outbox_account FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_outbox_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS product_mockups (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT UNSIGNED NOT NULL,
  color_key VARCHAR(80) NOT NULL,
  view_key VARCHAR(80) NOT NULL,
  asset_url VARCHAR(600) NOT NULL,
  status ENUM('active','missing','invalid','retired') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_product_mockup(product_id,color_key,view_key),
  CONSTRAINT fk_mockup_product FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE system_messages ADD COLUMN IF NOT EXISTS account_id BIGINT UNSIGNED NULL AFTER created_by_user_id;
ALTER TABLE system_messages ADD COLUMN IF NOT EXISTS store_id BIGINT UNSIGNED NULL AFTER account_id;
ALTER TABLE system_messages ADD COLUMN IF NOT EXISTS profile_key VARCHAR(100) NULL AFTER store_id;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS account_id BIGINT UNSIGNED NULL AFTER user_id;

INSERT INTO accounts(account_key,account_type,name,status,metadata_json) VALUES
('madedeck','platform','MadeDeck Platform','active',JSON_OBJECT('fixture','stable')),
('nyx-arcade','demo','Nyx Arcade','active',JSON_OBJECT('fixture','demo')),
('luna-threadworks','creator','Luna Threadworks','active',JSON_OBJECT('fixture','demo')),
('bayou-local-co','demo','Bayou Local Co.','active',JSON_OBJECT('fixture','demo'))
ON DUPLICATE KEY UPDATE name=VALUES(name),account_type=VALUES(account_type),status='active';

-- Canonical shirt base: S-XL $18, then +$2 per extended size through 5XL.
UPDATE products SET base_cost=18.00 WHERE sku IN ('TEE-UNI-STD','TEE-STD','TEE-ESSENTIAL') OR LOWER(name) IN ('unisex standard tee','essential tee');

INSERT INTO product_mockups(product_id,color_key,view_key,asset_url,status)
SELECT id,'black','front','/mockups/tee/front-black.png','active' FROM products WHERE sku IN ('TEE-UNI-STD','TEE-STD','TEE-ESSENTIAL') OR LOWER(name) IN ('unisex standard tee','essential tee')
ON DUPLICATE KEY UPDATE asset_url=VALUES(asset_url),status='active';
INSERT INTO product_mockups(product_id,color_key,view_key,asset_url,status)
SELECT id,'gray','front','/mockups/hoodie/front-gray.png','active' FROM products WHERE sku='HOOD-STD' OR LOWER(name) LIKE '%hoodie%'
ON DUPLICATE KEY UPDATE asset_url=VALUES(asset_url),status='active';
INSERT INTO product_mockups(product_id,color_key,view_key,asset_url,status)
SELECT id,'white','front','/mockups/polo/front-white.png','active' FROM products WHERE sku='POLO-TRICOT' OR LOWER(name) LIKE '%polo%'
ON DUPLICATE KEY UPDATE asset_url=VALUES(asset_url),status='active';
