-- Unified MadeDeck SaaS owner command center.
-- Adds non-destructive money/allowance overrides, inquiry tracking and a
-- normalized usage stream. Apply after 009_runtime_gap_closure.sql.

CREATE TABLE IF NOT EXISTS commerce_overrides (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_type ENUM('offer','dialer_plan') NOT NULL,
  entity_key VARCHAR(120) NOT NULL,
  scope_type ENUM('platform','user') NOT NULL DEFAULT 'platform',
  scope_user_id BIGINT UNSIGNED NULL,
  scope_key BIGINT UNSIGNED AS (IFNULL(scope_user_id,0)) STORED,
  override_price_cents INT UNSIGNED NULL,
  override_credit_grant INT UNSIGNED NULL,
  override_allowance INT UNSIGNED NULL,
  reason VARCHAR(500) NULL,
  effective_from DATETIME NULL,
  effective_until DATETIME NULL,
  updated_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_commerce_override(entity_type,entity_key,scope_type,scope_key),
  CONSTRAINT fk_commerce_override_user FOREIGN KEY(scope_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_commerce_override_actor FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_commerce_scope CHECK ((scope_type='platform' AND scope_user_id IS NULL) OR (scope_type='user' AND scope_user_id IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sales_inquiries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  inquiry_key CHAR(36) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NULL,
  email VARCHAR(254) NOT NULL,
  name VARCHAR(190) NULL,
  company VARCHAR(190) NULL,
  phone VARCHAR(40) NULL,
  interest_code VARCHAR(120) NULL,
  source VARCHAR(120) NULL,
  status ENUM('new','contacted','qualified','proposal','won','lost','spam') NOT NULL DEFAULT 'new',
  owner_user_id BIGINT UNSIGNED NULL,
  estimated_value_cents BIGINT UNSIGNED NULL,
  message TEXT NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sales_inquiry_pipeline(status,created_at),
  INDEX idx_sales_inquiry_email(email),
  CONSTRAINT fk_sales_inquiry_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_sales_inquiry_owner FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS action_usage_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_key CHAR(36) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  action_code VARCHAR(100) NOT NULL,
  quantity DECIMAL(14,3) NOT NULL DEFAULT 1,
  credits_charged INT NOT NULL DEFAULT 0,
  revenue_cents BIGINT NOT NULL DEFAULT 0,
  state ENUM('estimated','reserved','completed','failed','refunded') NOT NULL,
  source_type VARCHAR(80) NULL,
  source_id VARCHAR(190) NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  INDEX idx_usage_action_time(action_code,created_at),
  INDEX idx_usage_user_time(user_id,created_at),
  CONSTRAINT fk_usage_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_usage_action FOREIGN KEY(action_code) REFERENCES action_catalog(action_code) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

UPDATE billing_offers SET credit_grant=25, config_json=JSON_SET(COALESCE(config_json,JSON_OBJECT()),'$.displayPriceUsd',0) WHERE offer_code='free';
UPDATE billing_offers SET credit_grant=200, config_json=JSON_SET(COALESCE(config_json,JSON_OBJECT()),'$.displayPriceUsd',29) WHERE offer_code='pro_monthly';
UPDATE billing_offers SET credit_grant=1000, config_json=JSON_SET(COALESCE(config_json,JSON_OBJECT()),'$.displayPriceUsd',99) WHERE offer_code='advanced_monthly';
UPDATE billing_offers SET credit_grant=6000, config_json=JSON_SET(COALESCE(config_json,JSON_OBJECT()),'$.displayPriceUsd',399) WHERE offer_code='command_center_monthly';
UPDATE billing_offers SET config_json=JSON_SET(COALESCE(config_json,JSON_OBJECT()),'$.displayPriceUsd',10) WHERE offer_code='print_credits_50';
