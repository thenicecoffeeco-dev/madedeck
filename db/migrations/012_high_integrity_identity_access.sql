-- MadeDeck 012: high-integrity identity, access, and tenant contracts
-- Additive MySQL 8 migration. Apply after 011_account_connection_backbone.sql.
-- This migration does not rename or delete legacy columns/tables.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS tenant_uuid CHAR(36) NULL AFTER id;
UPDATE accounts SET tenant_uuid=UUID() WHERE tenant_uuid IS NULL;
ALTER TABLE accounts MODIFY tenant_uuid CHAR(36) NOT NULL;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS owner_user_id BIGINT UNSIGNED NULL AFTER account_type;

CREATE TABLE IF NOT EXISTS identity_emails (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  email VARCHAR(190) NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at DATETIME NULL,
  revoked_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_identity_email(email),
  INDEX idx_identity_user(user_id,is_primary),
  CONSTRAINT fk_identity_email_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO identity_emails(user_id,email,is_primary,verified_at)
SELECT id,LOWER(email),TRUE,CASE WHEN status='active' THEN NOW() ELSE NULL END FROM users
ON DUPLICATE KEY UPDATE user_id=VALUES(user_id);

CREATE TABLE IF NOT EXISTS roles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role_key VARCHAR(60) NOT NULL UNIQUE,
  label VARCHAR(100) NOT NULL,
  scope ENUM('platform','tenant') NOT NULL DEFAULT 'tenant',
  system_role BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS permissions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  permission_key VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(role_id,permission_id),
  CONSTRAINT fk_role_permission_role FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_role_permission_permission FOREIGN KEY(permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tenant_entitlements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id BIGINT UNSIGNED NOT NULL,
  entitlement_key VARCHAR(100) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  limit_value BIGINT NULL,
  source_type ENUM('plan','purchase','grant','trial','system') NOT NULL DEFAULT 'plan',
  source_ref VARCHAR(190) NULL,
  starts_at DATETIME NULL,
  expires_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_entitlement(account_id,entitlement_key,source_type,source_ref),
  INDEX idx_entitlement_active(account_id,entitlement_key,enabled,expires_at),
  CONSTRAINT fk_entitlement_account FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ownership_transfers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  transfer_ref CHAR(36) NOT NULL UNIQUE,
  account_id BIGINT UNSIGNED NOT NULL,
  from_user_id BIGINT UNSIGNED NULL,
  to_user_id BIGINT UNSIGNED NOT NULL,
  requested_by_user_id BIGINT UNSIGNED NOT NULL,
  status ENUM('pending','accepted','cancelled','expired','completed') NOT NULL DEFAULT 'pending',
  reason VARCHAR(500) NULL,
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  old_owner_ack_at DATETIME NULL,
  new_owner_ack_at DATETIME NULL,
  completed_at DATETIME NULL,
  expires_at DATETIME NOT NULL,
  INDEX idx_transfer_account(account_id,status),
  CONSTRAINT fk_transfer_account FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_transfer_from FOREIGN KEY(from_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_transfer_to FOREIGN KEY(to_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_transfer_requester FOREIGN KEY(requested_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS refresh_family_ref CHAR(36) NULL;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS last_activity_at DATETIME NULL;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS mfa_verified_at DATETIME NULL;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS revoked_reason VARCHAR(255) NULL;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS replaced_by_session_key CHAR(36) NULL;

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS account_id BIGINT UNSIGNED NULL AFTER actor_user_id;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS event_ref CHAR(36) NULL AFTER id;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_session_key CHAR(36) NULL AFTER actor_user_id;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS outcome ENUM('allowed','denied','failed') NOT NULL DEFAULT 'allowed';
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS request_id CHAR(36) NULL;

INSERT INTO roles(role_key,label,scope) VALUES
('super','Owner / Superuser','platform'),('operator','Platform Operator','platform'),
('repair','IT Repair','platform'),('support','Support','platform'),
('partner','Partner','tenant'),('merchant','Merchant','tenant'),
('customer','Customer','tenant'),('subscriber','Subscriber','tenant'),
('creator','Creator','tenant'),('staff','Staff','tenant'),('guest','Guest','tenant')
ON DUPLICATE KEY UPDATE label=VALUES(label),scope=VALUES(scope);

INSERT INTO permissions(permission_key,description) VALUES
('maker.use','Use the product creator'),('products.create','Create products'),
('products.publish','Publish products'),('products.delete','Delete products'),
('storefront.manage','Manage storefront'),('embeds.create','Create embeds'),
('embeds.manage','Manage embeds'),('orders.view','View tenant orders'),
('orders.fulfill','Fulfill tenant orders'),('marketing.use','Use marketing tools'),
('integrations.manage','Manage integrations'),('communications.manage','Manage communications'),
('reports.view','View reports'),('payouts.view','View payouts'),
('payouts.manage','Manage payouts'),('pricing.manage','Manage pricing'),
('tenant.users.manage','Manage tenant users'),('tenant.settings.manage','Manage tenant settings'),
('system.logs.view','View system logs'),('system.repair','Run repair tools'),
('system.impersonate','Impersonate with audit'),('system.restore','Restore tenant state'),
('feature_flags.manage','Manage feature flags'),('api_keys.manage','Manage API keys')
ON DUPLICATE KEY UPDATE description=VALUES(description);

-- Deny-by-default: role grants are deliberately populated by an audited seed/application step.
-- Existing permissions_json remains readable during migration but is not authoritative after cutover.
