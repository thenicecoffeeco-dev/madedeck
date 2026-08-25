-- MadeDeck system communications, release notes, incidents and maintenance suite.
-- Apply after 005_modular_action_commerce.sql.

INSERT INTO app_modules(module_key,name,module_type,version,lifecycle_status,manifest_json) VALUES
('platform.communications','System Communications','core','1.0.0','foundation',JSON_OBJECT(
  'presentations',JSON_ARRAY('banner','modal','toast','inbox','fullscreen'),
  'messageTypes',JSON_ARRAY('general','release_note','maintenance','outage','upgrade','security','billing','promotion'),
  'channels',JSON_ARRAY('web','desktop','email-ready'),
  'supportsCountdown',true,'supportsTargeting',true,'supportsAcknowledgment',true
))
ON DUPLICATE KEY UPDATE name=VALUES(name),version=VALUES(version),manifest_json=VALUES(manifest_json);

CREATE TABLE IF NOT EXISTS system_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_key CHAR(36) NOT NULL UNIQUE,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  message_type ENUM('general','release_note','maintenance','outage','upgrade','security','billing','promotion') NOT NULL DEFAULT 'general',
  severity ENUM('info','success','warning','critical') NOT NULL DEFAULT 'info',
  presentation ENUM('banner','modal','toast','inbox','fullscreen') NOT NULL DEFAULT 'banner',
  status ENUM('draft','scheduled','published','paused','expired','canceled') NOT NULL DEFAULT 'draft',
  title VARCHAR(190) NOT NULL,
  body TEXT NOT NULL,
  action_label VARCHAR(100) NULL,
  action_url VARCHAR(1000) NULL,
  icon_key VARCHAR(80) NULL,
  audience_json JSON NOT NULL,
  countdown_at DATETIME NULL,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  priority SMALLINT NOT NULL DEFAULT 50,
  dismissible BOOLEAN NOT NULL DEFAULT TRUE,
  requires_acknowledgment BOOLEAN NOT NULL DEFAULT FALSE,
  sticky_until_resolved BOOLEAN NOT NULL DEFAULT FALSE,
  published_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_system_message_delivery(status,starts_at,ends_at,priority),
  CONSTRAINT fk_system_message_creator FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS system_message_receipts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  channel ENUM('web','desktop') NOT NULL,
  first_seen_at DATETIME NULL,
  read_at DATETIME NULL,
  dismissed_at DATETIME NULL,
  acknowledged_at DATETIME NULL,
  last_seen_at DATETIME NULL,
  UNIQUE KEY uq_message_receipt(message_id,user_id,channel),
  INDEX idx_message_receipt_user(user_id,read_at,dismissed_at),
  CONSTRAINT fk_message_receipt_message FOREIGN KEY(message_id) REFERENCES system_messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_message_receipt_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS system_status_components (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  component_key VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(500) NULL,
  status ENUM('operational','degraded','partial_outage','major_outage','maintenance') NOT NULL DEFAULT 'operational',
  public_visible BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order SMALLINT NOT NULL DEFAULT 100,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS system_incidents (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  incident_key CHAR(36) NOT NULL UNIQUE,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(190) NOT NULL,
  severity ENUM('minor','major','critical') NOT NULL DEFAULT 'minor',
  state ENUM('investigating','identified','monitoring','resolved','canceled') NOT NULL DEFAULT 'investigating',
  affected_components_json JSON NOT NULL,
  started_at DATETIME NOT NULL,
  resolved_at DATETIME NULL,
  public_visible BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_incident_state(state,started_at),
  CONSTRAINT fk_incident_creator FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS system_incident_updates (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  incident_id BIGINT UNSIGNED NOT NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  state ENUM('investigating','identified','monitoring','resolved') NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_incident_update_incident FOREIGN KEY(incident_id) REFERENCES system_incidents(id) ON DELETE CASCADE,
  CONSTRAINT fk_incident_update_creator FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS release_notes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  release_key CHAR(36) NOT NULL UNIQUE,
  version VARCHAR(40) NOT NULL,
  platform ENUM('all','web','desktop','server') NOT NULL DEFAULT 'all',
  title VARCHAR(190) NOT NULL,
  summary TEXT NOT NULL,
  sections_json JSON NOT NULL,
  audience_json JSON NOT NULL,
  status ENUM('draft','published','withdrawn') NOT NULL DEFAULT 'draft',
  published_at DATETIME NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_release_version_platform(version,platform),
  CONSTRAINT fk_release_creator FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO system_status_components(component_key,name,description,sort_order) VALUES
('website','MadeDeck Website','Public storefront and merchant portal',10),
('api','MadeDeck API','Shared web and desktop service API',20),
('customizer','Product Customizer','Design editor, previews and production files',30),
('payments','Payments','Checkout, subscriptions and credit purchases',40),
('fulfillment','Fulfillment','Production dispatch and shipment tracking',50),
('swarm','Swarm Power','Bots, missions and operator tools',60),
('desktop','Windows App','MadeDeck desktop application',70)
ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),sort_order=VALUES(sort_order);

