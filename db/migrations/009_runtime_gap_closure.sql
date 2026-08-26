-- Audit repair: objects referenced by the Power Console runtime but absent from 003-008.
-- Apply after 008_scoped_feature_controls.sql.

ALTER TABLE swarm_bots ADD COLUMN IF NOT EXISTS operator_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE swarm_bots ADD COLUMN IF NOT EXISTS system_required BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE swarm_bots SET system_required=1,operator_enabled=1 WHERE bot_key IN ('overlord','qa_lead','connector_steward');

CREATE TABLE IF NOT EXISTS power_functions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  function_key VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  category VARCHAR(80) NOT NULL,
  invocation_mode ENUM('standalone','swarm','both') NOT NULL DEFAULT 'both',
  readiness ENUM('foundation','partial','ready','blocked','retired') NOT NULL DEFAULT 'foundation',
  operator_visible BOOLEAN NOT NULL DEFAULT TRUE,
  operator_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  authority_ceiling ENUM('A0','A1','A2','A3','A4','A5') NOT NULL DEFAULT 'A2',
  worker_key VARCHAR(100) NULL,
  input_contract_json JSON NULL,
  output_contract_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS power_jobs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_key CHAR(36) NOT NULL UNIQUE,
  function_id BIGINT UNSIGNED NOT NULL,
  requested_by_user_id BIGINT UNSIGNED NOT NULL,
  invocation_mode ENUM('standalone','swarm') NOT NULL,
  state ENUM('queued','running','waiting','blocked','completed','failed','canceled') NOT NULL DEFAULT 'queued',
  input_json JSON NULL,
  output_json JSON NULL,
  failure_text TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  CONSTRAINT fk_power_job_function FOREIGN KEY(function_id) REFERENCES power_functions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_power_job_user FOREIGN KEY(requested_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_power_job_state(state,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO power_functions(function_key,name,category,invocation_mode,readiness,operator_visible,operator_enabled,authority_ceiling,worker_key) VALUES
('lead-gatherer','Gather leads','leads','both','foundation',1,1,'A2','lead-gatherer'),
('lead-digester','Digest external leads','leads','both','partial',1,1,'A1','lead-digester'),
('lead-ranker','Qualify and rank leads','leads','both','foundation',1,1,'A1','lead-ranker'),
('lead-enricher','Enrich leads','leads','both','foundation',1,1,'A2','lead-enricher'),
('research-bot','Company research','intelligence','both','foundation',1,1,'A2','research-bot'),
('war-room','War Room analysis','intelligence','both','foundation',1,1,'A2','war-room'),
('sales-bot','Outreach draft generation','campaigns','both','foundation',1,1,'A2','sales-bot'),
('content-bot','Content package generation','campaigns','both','foundation',1,1,'A2','content-bot'),
('proposal-bot','Proposal generation','campaigns','both','foundation',1,1,'A2','proposal-bot'),
('print-exporter','Production export','print','both','blocked',1,1,'A3','print-exporter')
ON DUPLICATE KEY UPDATE name=VALUES(name),category=VALUES(category),invocation_mode=VALUES(invocation_mode),worker_key=VALUES(worker_key);
