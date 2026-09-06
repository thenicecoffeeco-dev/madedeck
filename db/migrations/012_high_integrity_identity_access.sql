-- MadeDeck 012 portable: high-integrity identity, access, and tenant contracts
-- Additive only. No existing table or column is altered, renamed, or deleted.
-- Foreign references are enforced by application services for restored-schema portability.

CREATE TABLE IF NOT EXISTS tenant_identities (
  account_id BIGINT UNSIGNED NOT NULL,
  tenant_uuid CHAR(36) NOT NULL,
  owner_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id),
  UNIQUE KEY uq_tenant_identity_uuid (tenant_uuid),
  KEY idx_tenant_identity_owner (owner_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO tenant_identities (account_id,tenant_uuid,owner_user_id)
SELECT a.id,UUID(),NULL FROM accounts a;

CREATE TABLE IF NOT EXISTS identity_emails (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  email VARCHAR(190) NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  verified_at DATETIME NULL,
  revoked_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_identity_email (email),
  KEY idx_identity_user (user_id,is_primary)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO identity_emails (user_id,email,is_primary,verified_at)
SELECT id,LOWER(email),1,CASE WHEN status='active' THEN NOW() ELSE NULL END FROM users;

CREATE TABLE IF NOT EXISTS roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  role_key VARCHAR(60) NOT NULL,
  label VARCHAR(100) NOT NULL,
  role_scope VARCHAR(20) NOT NULL DEFAULT 'tenant',
  system_role TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_role_key (role_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS permissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  permission_key VARCHAR(100) NOT NULL,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_permission_key (permission_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  allowed TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id,permission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tenant_entitlements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id BIGINT UNSIGNED NOT NULL,
  entitlement_key VARCHAR(100) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  limit_value BIGINT NULL,
  source_type VARCHAR(20) NOT NULL DEFAULT 'plan',
  source_ref VARCHAR(190) NOT NULL DEFAULT '',
  starts_at DATETIME NULL,
  expires_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant_entitlement (account_id,entitlement_key,source_type,source_ref),
  KEY idx_entitlement_active (account_id,entitlement_key,enabled,expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ownership_transfers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  transfer_ref CHAR(36) NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  from_user_id BIGINT UNSIGNED NULL,
  to_user_id BIGINT UNSIGNED NOT NULL,
  requested_by_user_id BIGINT UNSIGNED NOT NULL,
  transfer_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  reason VARCHAR(500) NULL,
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  old_owner_ack_at DATETIME NULL,
  new_owner_ack_at DATETIME NULL,
  completed_at DATETIME NULL,
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ownership_transfer_ref (transfer_ref),
  KEY idx_transfer_account (account_id,transfer_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS session_security (
  session_key CHAR(36) NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  refresh_family_ref CHAR(36) NULL,
  last_activity_at DATETIME NULL,
  mfa_verified_at DATETIME NULL,
  revoked_at DATETIME NULL,
  revoked_reason VARCHAR(255) NULL,
  replaced_by_session_key CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_key),
  KEY idx_session_security_user (user_id,revoked_at),
  KEY idx_session_security_account (account_id,revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS security_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_ref CHAR(36) NOT NULL,
  request_id CHAR(36) NULL,
  account_id BIGINT UNSIGNED NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  actor_session_key CHAR(36) NULL,
  action VARCHAR(120) NOT NULL,
  outcome VARCHAR(20) NOT NULL DEFAULT 'allowed',
  resource_type VARCHAR(80) NULL,
  resource_id VARCHAR(100) NULL,
  detail_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_security_audit_event_ref (event_ref),
  KEY idx_security_audit_account (account_id,created_at),
  KEY idx_security_audit_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO roles (role_key,label,role_scope) VALUES
('super','Owner / Superuser','platform'),
('operator','Platform Operator','platform'),
('repair','IT Repair','platform'),
('support','Support','platform'),
('partner','Partner','tenant'),
('merchant','Merchant','tenant'),
('customer','Customer','tenant'),
('subscriber','Subscriber','tenant'),
('creator','Creator','tenant'),
('staff','Staff','tenant'),
('guest','Guest','tenant');

INSERT IGNORE INTO permissions (permission_key,description) VALUES
('maker.use','Use the product creator'),
('products.create','Create products'),
('products.publish','Publish products'),
('products.delete','Delete products'),
('storefront.manage','Manage storefront'),
('embeds.create','Create embeds'),
('embeds.manage','Manage embeds'),
('orders.view','View tenant orders'),
('orders.fulfill','Fulfill tenant orders'),
('marketing.use','Use marketing tools'),
('integrations.manage','Manage integrations'),
('communications.manage','Manage communications'),
('reports.view','View reports'),
('payouts.view','View payouts'),
('payouts.manage','Manage payouts'),
('pricing.manage','Manage pricing'),
('tenant.users.manage','Manage tenant users'),
('tenant.settings.manage','Manage tenant settings'),
('system.logs.view','View system logs'),
('system.repair','Run repair tools'),
('system.impersonate','Impersonate with audit'),
('system.restore','Restore tenant state'),
('feature_flags.manage','Manage feature flags'),
('api_keys.manage','Manage API keys');
