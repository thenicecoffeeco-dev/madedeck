-- Scoped feature visibility and non-destructive price controls.
-- Apply after 007_revenue_dialer_and_storefront.sql.
-- Parent references are validated in application code for portability across restored schemas.

CREATE TABLE IF NOT EXISTS feature_control_overrides (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_type ENUM('action','function','module','offer') NOT NULL,
  entity_key VARCHAR(120) NOT NULL,
  scope_type ENUM('platform','user') NOT NULL DEFAULT 'platform',
  scope_user_id BIGINT UNSIGNED NULL,
  scope_key BIGINT UNSIGNED AS (IFNULL(scope_user_id,0)) STORED,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  reason VARCHAR(500) NULL,
  effective_from DATETIME NULL,
  effective_until DATETIME NULL,
  updated_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_feature_control(entity_type,entity_key,scope_type,scope_key),
  INDEX idx_feature_control_resolution(entity_type,entity_key,scope_type,scope_user_id,enabled),
  CONSTRAINT chk_feature_scope CHECK ((scope_type='platform' AND scope_user_id IS NULL) OR (scope_type='user' AND scope_user_id IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS action_price_overrides (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  action_code VARCHAR(100) NOT NULL,
  scope_type ENUM('platform','user') NOT NULL DEFAULT 'platform',
  scope_user_id BIGINT UNSIGNED NULL,
  scope_key BIGINT UNSIGNED AS (IFNULL(scope_user_id,0)) STORED,
  override_base_credits INT NULL,
  override_minimum_credits INT NULL,
  override_maximum_credits INT NULL,
  override_pricing_json JSON NULL,
  reason VARCHAR(500) NULL,
  effective_from DATETIME NULL,
  effective_until DATETIME NULL,
  updated_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_action_price_override(action_code,scope_type,scope_key),
  CONSTRAINT chk_price_scope CHECK ((scope_type='platform' AND scope_user_id IS NULL) OR (scope_type='user' AND scope_user_id IS NOT NULL)),
  CONSTRAINT chk_override_base CHECK (override_base_credits IS NULL OR override_base_credits>=0),
  CONSTRAINT chk_override_min CHECK (override_minimum_credits IS NULL OR override_minimum_credits>=0),
  CONSTRAINT chk_override_max CHECK (override_maximum_credits IS NULL OR override_maximum_credits>=0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS feature_control_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_key VARCHAR(120) NOT NULL,
  scope_type VARCHAR(20) NOT NULL,
  scope_user_id BIGINT UNSIGNED NULL,
  event_type ENUM('visibility_changed','price_changed','override_removed') NOT NULL,
  previous_json JSON NULL,
  next_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_feature_event_entity(entity_type,entity_key,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
