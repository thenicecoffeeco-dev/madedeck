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
  operator_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  system_required BOOLEAN NOT NULL DEFAULT FALSE,
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

CREATE TABLE IF NOT EXISTS power_functions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  function_key VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  category VARCHAR(80) NOT NULL,
  invocation_mode ENUM('standalone','swarm','both','background_only') NOT NULL DEFAULT 'both',
  readiness ENUM('planned','foundation','partial','ready','blocked','retired') NOT NULL DEFAULT 'planned',
  operator_visible BOOLEAN NOT NULL DEFAULT TRUE,
  operator_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  required_inputs_json JSON NULL,
  output_contract_json JSON NULL,
  receiver_contract_json JSON NULL,
  authority_ceiling ENUM('A0','A1','A2','A3','A4','A5') NOT NULL DEFAULT 'A2',
  worker_key VARCHAR(120) NULL,
  source_reference VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS power_jobs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_key CHAR(36) NOT NULL UNIQUE,
  function_id BIGINT UNSIGNED NOT NULL,
  mission_id BIGINT UNSIGNED NULL,
  requested_by_user_id BIGINT UNSIGNED NOT NULL,
  invocation_mode ENUM('standalone','swarm') NOT NULL,
  state ENUM('draft','queued','running','waiting','blocked','completed','failed','cancelled','rolled_back') NOT NULL DEFAULT 'draft',
  input_json JSON NULL,
  progress_json JSON NULL,
  output_json JSON NULL,
  error_text TEXT NULL,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_power_job_state(state,created_at),
  CONSTRAINT fk_power_job_function FOREIGN KEY(function_id) REFERENCES power_functions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_power_job_user FOREIGN KEY(requested_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
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

INSERT INTO power_functions
(function_key,name,category,invocation_mode,readiness,operator_visible,operator_enabled,authority_ceiling,worker_key,source_reference) VALUES
('lead_search','Lead Search','leads','both','partial',1,1,'A1','lead-search-worker','UPGRADE 1 of 2.txt'),
('lead_digester','Lead Digester','leads','both','foundation',1,1,'A2','lead-digester-worker','Lead Digester system'),
('lead_ranking','Lead Ranking','leads','both','foundation',1,1,'A2','lead-ranking-worker','1730 Probability Engine; PROS-016'),
('lead_qualification','Lead Qualification','leads','both','foundation',1,1,'A2','lead-qualification-worker','2690 Unified Prospect Intelligence'),
('lead_enrichment','Lead Enrichment','leads','both','foundation',1,1,'A2','lead-enrichment-worker','Research and scraping bots'),
('native_crm','Native CRM','crm','standalone','foundation',1,1,'A3','native-crm-service','2130 Unified Entity CRM; UPGRADE 2 of 2.txt'),
('reputation_scan','Reputation Monitor','research','both','partial',1,1,'A1','reputation-worker','OPP-00520; ENG-1760'),
('competitor_research','Competitive Intelligence','research','both','foundation',1,1,'A1','competitor-worker','CMD-012; ENG-1500'),
('content_generation','Content Generator','content','both','foundation',1,1,'A2','content-worker','ENG-2720; M-101; M-110'),
('campaign_builder','Campaign Builder','campaigns','both','foundation',1,1,'A2','campaign-worker','ENG-2660'),
('proposal_generation','Proposal Generator','sales','both','foundation',1,1,'A2','proposal-worker','600-604; 2760'),
('response_router','Response Router','communications','both','foundation',1,1,'A3','response-router-worker','ACT-017; ACT-021'),
('export_manager','Export Manager','exports','standalone','foundation',1,1,'A3','export-worker','EXP-801; ASSET-025; ASSET-026')
ON DUPLICATE KEY UPDATE name=VALUES(name),category=VALUES(category),invocation_mode=VALUES(invocation_mode),readiness=VALUES(readiness),operator_visible=VALUES(operator_visible),operator_enabled=VALUES(operator_enabled),authority_ceiling=VALUES(authority_ceiling),worker_key=VALUES(worker_key),source_reference=VALUES(source_reference);

INSERT INTO swarm_bots(bot_key,name,primary_capability,autonomy,lifecycle_status,independently_selectable,operator_enabled,system_required) VALUES
('vinny_bot','Vinny Bot','Executive translation','Recommend / decide','active',1,1,1),
('overlord','Overlord','System health','Execute internally','active',1,1,1),
('taskmaster','Taskmaster','Crew composition','Recommend; internal when capacity live','partial',1,1,1),
('research_bot','Research Bot','Evidence collection','Execute internally','active',1,1,0),
('war_room_bot','War Room Bot','Prospect synthesis','Execute internally','active',1,1,0),
('comparator_bot','Comparator Bot','Best-practice comparison','Execute internally','partial',1,1,0),
('sales_bot','Sales Bot','Customer-safe preparation','Draft','active',1,1,0),
('proposal_bot','Proposal Bot','Scope and packaging','Draft','active',1,1,0),
('customer_ops_bot','Customer Ops Bot','Commitment protection','Execute internally','foundation',1,1,0),
('content_bot','Content Bot','Batch creation','Draft','ready',1,1,0),
('meeting_bot','Meeting Bot','Meeting-to-mission','Observe / draft','blocked',0,0,0),
('inbox_bot','Inbox Bot','M365 intake','Observe / draft','partial',0,0,0),
('recovery_bot','Recovery Bot','Safe workaround','Execute internally','ready',1,1,1),
('qa_lead','QA Lead','Acceptance and release','Hold / pass internally','active',1,1,1),
('connector_steward','Connector Steward','Least-privilege routing','Diagnostic / internal','partial',1,1,0)
ON DUPLICATE KEY UPDATE
  name=VALUES(name),primary_capability=VALUES(primary_capability),autonomy=VALUES(autonomy),
  lifecycle_status=VALUES(lifecycle_status),independently_selectable=VALUES(independently_selectable),
  operator_enabled=VALUES(operator_enabled),system_required=VALUES(system_required);

