-- MadeDeck v0.6 Swarm Power Console foundation
-- Apply after 002_saas_foundation.sql. Additive and safe to rerun.

CREATE TABLE IF NOT EXISTS auth_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  user_agent VARCHAR(500) NULL,
  ip_hash CHAR(64) NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_auth_session_user(user_id,revoked_at,expires_at),
  CONSTRAINT fk_auth_session_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_entitlements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  entitlement_key VARCHAR(100) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config_json JSON NULL,
  expires_at DATETIME NULL,
  granted_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_entitlement(user_id,entitlement_key),
  CONSTRAINT fk_user_entitlement_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_entitlement_grantor FOREIGN KEY(granted_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS swarm_bots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bot_key VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  primary_capability VARCHAR(255) NOT NULL,
  autonomy VARCHAR(120) NOT NULL,
  lifecycle_status ENUM('active','ready','partial','foundation','blocked','retired') NOT NULL DEFAULT 'foundation',
  independently_selectable BOOLEAN NOT NULL DEFAULT TRUE,
  core_version VARCHAR(30) NOT NULL DEFAULT '14.0',
  source_registry VARCHAR(120) NOT NULL DEFAULT 'Swarm Control Plane.xlsx',
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS swarm_employees (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_key VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  employee_group VARCHAR(80) NOT NULL,
  purpose TEXT NULL,
  authority_ceiling ENUM('A0','A1','A2','A3','A4','A5') NOT NULL DEFAULT 'A2',
  lifecycle_status ENUM('active','ready','partial','foundation','blocked','retired') NOT NULL DEFAULT 'foundation',
  independently_selectable BOOLEAN NOT NULL DEFAULT FALSE,
  input_contract_json JSON NULL,
  output_contract_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS swarm_bot_employees (
  bot_id BIGINT UNSIGNED NOT NULL,
  employee_id BIGINT UNSIGNED NOT NULL,
  assignment_type ENUM('required','conditional','backup') NOT NULL DEFAULT 'conditional',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(bot_id,employee_id,assignment_type),
  CONSTRAINT fk_swarm_bot_employee_bot FOREIGN KEY(bot_id) REFERENCES swarm_bots(id) ON DELETE CASCADE,
  CONSTRAINT fk_swarm_bot_employee_employee FOREIGN KEY(employee_id) REFERENCES swarm_employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS swarm_missions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  mission_key CHAR(36) NOT NULL UNIQUE,
  requested_by_user_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NULL,
  title VARCHAR(190) NOT NULL,
  request_text TEXT NOT NULL,
  authority_class ENUM('A0','A1','A2','A3','A4','A5') NOT NULL DEFAULT 'A1',
  state ENUM('draft','queued','running','waiting','blocked','awaiting_approval','completed','failed','cancelled','rolled_back') NOT NULL DEFAULT 'draft',
  evidence_mode VARCHAR(60) NOT NULL DEFAULT 'hybrid',
  mission_contract_json JSON NULL,
  checkpoint_json JSON NULL,
  failure_text TEXT NULL,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_swarm_mission_state(state,created_at),
  CONSTRAINT fk_swarm_mission_user FOREIGN KEY(requested_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_swarm_mission_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS swarm_mission_bots (
  mission_id BIGINT UNSIGNED NOT NULL,
  bot_id BIGINT UNSIGNED NOT NULL,
  assignment_state ENUM('selected','running','waiting','blocked','completed','failed','skipped') NOT NULL DEFAULT 'selected',
  input_json JSON NULL,
  output_json JSON NULL,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  PRIMARY KEY(mission_id,bot_id),
  CONSTRAINT fk_swarm_mission_bot_mission FOREIGN KEY(mission_id) REFERENCES swarm_missions(id) ON DELETE CASCADE,
  CONSTRAINT fk_swarm_mission_bot_bot FOREIGN KEY(bot_id) REFERENCES swarm_bots(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS swarm_approvals (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  mission_id BIGINT UNSIGNED NOT NULL,
  approval_key CHAR(36) NOT NULL UNIQUE,
  authority_class ENUM('A3','A4','A5') NOT NULL,
  exact_target_json JSON NOT NULL,
  artifact_hash CHAR(64) NULL,
  status ENUM('pending','approved','rejected','expired','revoked','consumed') NOT NULL DEFAULT 'pending',
  requested_by_user_id BIGINT UNSIGNED NOT NULL,
  decided_by_user_id BIGINT UNSIGNED NULL,
  decision_reason TEXT NULL,
  expires_at DATETIME NULL,
  decided_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_swarm_approval_mission(mission_id,status),
  CONSTRAINT fk_swarm_approval_mission FOREIGN KEY(mission_id) REFERENCES swarm_missions(id) ON DELETE CASCADE,
  CONSTRAINT fk_swarm_approval_requester FOREIGN KEY(requested_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_swarm_approval_decider FOREIGN KEY(decided_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS swarm_evidence (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  mission_id BIGINT UNSIGNED NOT NULL,
  source_url VARCHAR(1200) NULL,
  source_label VARCHAR(255) NULL,
  retrieved_at DATETIME NULL,
  evidence_type ENUM('fact','inference','unknown','conflict','limitation') NOT NULL,
  confidence DECIMAL(5,4) NULL,
  content_hash CHAR(64) NULL,
  payload_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_swarm_evidence_mission(mission_id,evidence_type),
  CONSTRAINT fk_swarm_evidence_mission FOREIGN KEY(mission_id) REFERENCES swarm_missions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO feature_flags(store_id,feature_key,enabled,config_json)
SELECT NULL,'swarm_power_console',0,JSON_OBJECT('visibility','vinny_only','minimum_role','platform_admin')
WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE store_id IS NULL AND feature_key='swarm_power_console');

INSERT INTO swarm_bots(bot_key,name,primary_capability,autonomy,lifecycle_status,independently_selectable) VALUES
('vinny_bot','Vinny Bot','Executive translation','Recommend / decide','active',1),
('overlord','Overlord','System health','Execute internally','active',1),
('taskmaster','Taskmaster','Crew composition','Recommend; internal when capacity live','partial',1),
('research_bot','Research Bot','Evidence collection','Execute internally','active',1),
('war_room_bot','War Room Bot','Prospect synthesis','Execute internally','active',1),
('comparator_bot','Comparator Bot','Best-practice comparison','Execute internally','partial',1),
('sales_bot','Sales Bot','Customer-safe preparation','Draft','active',1),
('proposal_bot','Proposal Bot','Scope and packaging','Draft','active',1),
('customer_ops_bot','Customer Ops Bot','Commitment protection','Execute internally','foundation',1),
('content_bot','Content Bot','Batch creation','Draft','ready',1),
('meeting_bot','Meeting Bot','Meeting-to-mission','Observe / draft','blocked',0),
('inbox_bot','Inbox Bot','M365 intake','Observe / draft','partial',0),
('recovery_bot','Recovery Bot','Safe workaround','Execute internally','ready',1),
('qa_lead','QA Lead','Acceptance and release','Hold / pass internally','active',1),
('connector_steward','Connector Steward','Least-privilege routing','Diagnostic / internal','partial',1)
ON DUPLICATE KEY UPDATE
  name=VALUES(name),primary_capability=VALUES(primary_capability),autonomy=VALUES(autonomy),
  lifecycle_status=VALUES(lifecycle_status),independently_selectable=VALUES(independently_selectable);

