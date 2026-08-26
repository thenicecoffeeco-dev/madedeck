-- Final feature-expansion migration: revenue dialer, CRM calling governance,
-- and the 15 customer-safe Swarm storefront products.
-- Apply after 006_system_communications.sql.

CREATE TABLE IF NOT EXISTS dialer_plans (
  plan_code VARCHAR(40) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  monthly_price_cents INT UNSIGNED NOT NULL,
  included_calls INT UNSIGNED NOT NULL,
  feature_json JSON NOT NULL,
  stripe_price_id VARCHAR(190) NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dialer_accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL UNIQUE,
  plan_code VARCHAR(40) NULL,
  subscription_status ENUM('inactive','trialing','active','past_due','paused','canceled') NOT NULL DEFAULT 'inactive',
  calls_used INT UNSIGNED NOT NULL DEFAULT 0,
  usage_period_start DATETIME NULL,
  usage_period_end DATETIME NULL,
  default_provider_key VARCHAR(60) NULL,
  settings_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_dialer_account_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_dialer_account_plan FOREIGN KEY(plan_code) REFERENCES dialer_plans(plan_code) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dialer_provider_connections (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  provider_key ENUM('twilio','google_voice','openphone','ringcentral','viber','pinger','cell_manual') NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  connection_mode ENUM('api','browser_assist','device_handoff') NOT NULL,
  status ENUM('unconfigured','configured','connected','error','disabled') NOT NULL DEFAULT 'unconfigured',
  from_number_hint VARCHAR(40) NULL,
  secret_reference VARCHAR(255) NULL,
  config_json JSON NULL,
  last_verified_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dialer_provider(user_id,provider_key),
  CONSTRAINT fk_dialer_provider_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS crm_leads (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  external_key VARCHAR(190) NULL,
  company VARCHAR(190) NULL,
  contact_name VARCHAR(190) NULL,
  phone_e164 VARCHAR(32) NULL,
  email VARCHAR(254) NULL,
  website VARCHAR(500) NULL,
  industry VARCHAR(120) NULL,
  postal_code VARCHAR(24) NULL,
  lifecycle_stage VARCHAR(60) NOT NULL DEFAULT 'new',
  qualification_score DECIMAL(6,2) NULL,
  qualification_lane VARCHAR(80) NULL,
  source VARCHAR(100) NULL,
  consent_status ENUM('unknown','express','existing_relationship','not_required','revoked') NOT NULL DEFAULT 'unknown',
  consent_evidence_json JSON NULL,
  custom_fields_json JSON NULL,
  last_contacted_at DATETIME NULL,
  next_action_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_crm_external(owner_user_id,external_key),
  INDEX idx_crm_queue(owner_user_id,lifecycle_stage,next_action_at,qualification_score),
  INDEX idx_crm_phone(owner_user_id,phone_e164),
  CONSTRAINT fk_crm_lead_owner FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dialer_suppressions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  phone_e164 VARCHAR(32) NOT NULL,
  scope ENUM('cooldown','permanent','legal','customer') NOT NULL,
  reason_code VARCHAR(60) NOT NULL,
  reason_text VARCHAR(500) NULL,
  expires_at DATETIME NULL,
  source_call_id BIGINT UNSIGNED NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_active_suppression(user_id,phone_e164,scope,reason_code),
  INDEX idx_suppression_lookup(user_id,phone_e164,expires_at),
  CONSTRAINT fk_suppression_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dialer_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_key CHAR(36) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  source_type ENUM('crm','csv','swarm_segment','manual') NOT NULL,
  source_reference VARCHAR(190) NULL,
  state ENUM('open','paused','closed') NOT NULL DEFAULT 'open',
  queue_filter_json JSON NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME NULL,
  CONSTRAINT fk_dialer_session_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dialer_calls (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  call_key CHAR(36) NOT NULL UNIQUE,
  session_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  lead_id BIGINT UNSIGNED NULL,
  provider_key VARCHAR(60) NOT NULL,
  provider_call_id VARCHAR(190) NULL UNIQUE,
  direction ENUM('outbound','inbound') NOT NULL DEFAULT 'outbound',
  state ENUM('prepared','initiated','ringing','answered','completed','failed','canceled') NOT NULL DEFAULT 'prepared',
  disposition_code VARCHAR(60) NULL,
  disposition_category VARCHAR(40) NULL,
  started_at DATETIME NULL,
  answered_at DATETIME NULL,
  completed_at DATETIME NULL,
  talk_seconds INT UNSIGNED NOT NULL DEFAULT 0,
  provider_cost_minor INT NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  recording_status ENUM('off','consent_required','recording','available','deleted','failed') NOT NULL DEFAULT 'off',
  recording_reference VARCHAR(500) NULL,
  notes TEXT NULL,
  objection_codes_json JSON NULL,
  provider_payload_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_dialer_call_user_time(user_id,created_at),
  INDEX idx_dialer_call_lead(lead_id,created_at),
  CONSTRAINT fk_dialer_call_session FOREIGN KEY(session_id) REFERENCES dialer_sessions(id) ON DELETE SET NULL,
  CONSTRAINT fk_dialer_call_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_dialer_call_lead FOREIGN KEY(lead_id) REFERENCES crm_leads(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dialer_callbacks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  lead_id BIGINT UNSIGNED NOT NULL,
  call_id BIGINT UNSIGNED NULL,
  scheduled_for DATETIME NOT NULL,
  status ENUM('scheduled','snoozed','completed','canceled','missed') NOT NULL DEFAULT 'scheduled',
  note VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_callback_due(user_id,status,scheduled_for),
  CONSTRAINT fk_callback_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_callback_lead FOREIGN KEY(lead_id) REFERENCES crm_leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_callback_call FOREIGN KEY(call_id) REFERENCES dialer_calls(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO dialer_plans(plan_code,name,monthly_price_cents,included_calls,feature_json,active) VALUES
('DIALER_STARTER','Dialer Starter',9900,500,JSON_OBJECT('dialer',true,'kpi','basic','sms',false,'recording',false,'aiDetection',false),0),
('DIALER_GROWTH','Dialer Growth',29900,2000,JSON_OBJECT('dialer',true,'kpi','full','sms',true,'recording',false,'aiDetection',false),0),
('DIALER_ENTERPRISE','Dialer Enterprise',79900,10000,JSON_OBJECT('dialer',true,'kpi','full','sms',true,'recording',true,'aiDetection',true,'teamOversight',true),0)
ON DUPLICATE KEY UPDATE name=VALUES(name),monthly_price_cents=VALUES(monthly_price_cents),included_calls=VALUES(included_calls),feature_json=VALUES(feature_json);

INSERT INTO app_modules(module_key,name,module_type,version,lifecycle_status,entrypoint,manifest_json) VALUES
('operator.dialer','Revenue Dialer & Native CRM','operator','1.0.0','foundation','src/dialer.js',JSON_OBJECT('dockable',true,'resizable',true,'providers',JSON_ARRAY('twilio','google_voice','openphone','ringcentral','viber','pinger','cell_manual'))),
('storefront.quick-strike','Quick Strike Tools','commerce','1.0.0','foundation',NULL,JSON_OBJECT('tier',1)),
('storefront.set-forget','Set & Forget Systems','commerce','1.0.0','foundation',NULL,JSON_OBJECT('tier',2)),
('storefront.enterprise','Enterprise Shields','commerce','1.0.0','foundation',NULL,JSON_OBJECT('tier',3))
ON DUPLICATE KEY UPDATE name=VALUES(name),version=VALUES(version),manifest_json=VALUES(manifest_json);

INSERT INTO action_catalog
(action_code,module_key,name,description,category,billing_unit,pricing_type,base_credits,minimum_credits,quantity_step,preview_quantity,worker_key,pricing_config_json,output_contract_json) VALUES
('CMD-007-LITE','storefront.quick-strike','SitePulse','One-page website health scorecard.','quick-strike','site','fixed_credits',1,1,1,1,'website-reality-check',JSON_OBJECT('retailUsd',9),JSON_OBJECT('format','pdf','pages',1)),
('FUNC-019-REVIEWS','storefront.quick-strike','ReviewRescue','Generate responses for up to 50 uploaded reviews.','quick-strike','batch','fixed_credits',1,1,50,5,'review-response',JSON_OBJECT('retailUsd',9),JSON_OBJECT('format','csv')),
('CMD-012-LITE','storefront.quick-strike','CompetitorX-Ray','Compare one business against up to two competitors.','quick-strike','action','fixed_credits',2,2,1,1,'competitor-comparison',JSON_OBJECT('retailUsd',19),JSON_OBJECT('format','pdf','pages',1)),
('OPP-00341-LITE','storefront.quick-strike','LeadRevive','Three compliant reactivation drafts per ten leads.','quick-strike','lead','fixed_credits',1,1,10,1,'retention-reactivation',JSON_OBJECT('retailUsd',9),JSON_OBJECT('format','csv')),
('CMD-016-LITE','storefront.quick-strike','AutoMap','Automation readiness and ROI micro-audit.','quick-strike','action','fixed_credits',1,1,1,1,'automation-readiness',JSON_OBJECT('retailUsd',9),JSON_OBJECT('format','pdf','pages',1)),
('FUNC-019-NAP','storefront.quick-strike','CitationScan','Citation health check against major directories.','quick-strike','site','fixed_credits',1,1,1,1,'citation-verifier',JSON_OBJECT('retailUsd',9),JSON_OBJECT('format','pdf')),
('M-153','storefront.set-forget','NeverMiss AI','Missed-call text-back and CRM routing.','recurring-system','action','estimate',0,1,1,0,'missed-call-router',JSON_OBJECT('monthlyUsd',49,'providerUsageSeparate',true),JSON_OBJECT('format','crm-events')),
('OPP-00520','storefront.set-forget','5-Star Autopilot','Review requests plus approval-first AI replies.','recurring-system','action','estimate',0,1,1,0,'review-autopilot',JSON_OBJECT('monthlyUsd',79),JSON_OBJECT('format','approval-queue')),
('ENG-1500','storefront.set-forget','MarketSpy','Weekly monitored competitor change reports.','recurring-system','site','estimate',0,1,3,0,'competitor-monitor',JSON_OBJECT('monthlyUsd',29,'includedTargets',3),JSON_OBJECT('format','pdf-email')),
('OPP-00080','storefront.set-forget','CashInjection','Governed database reactivation campaign.','productized-service','batch','estimate',0,1,1,0,'reactivation-campaign',JSON_OBJECT('setupUsdMin',500,'setupUsdMax',1500,'successFeePercent',10),JSON_OBJECT('format','mission-package')),
('A&A-115','storefront.set-forget','PlaybookBuilder AI','Turn recordings into searchable SOPs.','recurring-system','minute','estimate',0,1,10,0,'sop-builder',JSON_OBJECT('monthlyUsd',199,'includedSops',10,'fullBuildUsd',999),JSON_OBJECT('format','editable-playbook')),
('M-148','storefront.set-forget','CitationFix','Citation correction workflow and fix report.','productized-service','site','estimate',0,1,1,0,'citation-fixer',JSON_OBJECT('oneTimeUsd',299),JSON_OBJECT('format','fix-ledger')),
('ENG-1810','storefront.enterprise','RFP Autopilot','Evidence-backed RFP response workspace with confidence review.','enterprise','action','estimate',0,1,1,0,'rfp-responder',JSON_OBJECT('monthlyUsd',1500,'setupUsdFrom',5000),JSON_OBJECT('format','xlsx','humanReviewRequired',true)),
('CMD-021-CLAIMS','storefront.enterprise','ClaimShield','Recurring marketing claim and compliance audit.','enterprise','site','estimate',0,1,1,0,'claim-firewall',JSON_OBJECT('monthlyUsd',499),JSON_OBJECT('format','compliance-dashboard','notLegalAdvice',true)),
('CMD-022','storefront.enterprise','ClientCockpit','White-label read-only client operations portal.','enterprise','action','estimate',0,1,1,0,'client-portal',JSON_OBJECT('monthlyAddonUsdFrom',200),JSON_OBJECT('format','dashboard')),
('dialer.call','operator.dialer','CRM dialer call','One governed call attempt from an eligible CRM queue.','dialer','action','fixed_credits',0,0,1,1,'dialer-router',JSON_OBJECT('requiresDialerPlan',true,'providerUsageSeparate',true),JSON_OBJECT('format','call-ledger')),
('dialer.lookup','operator.dialer','Phone validation','Validate and normalize one phone before calling.','dialer','lead','fixed_credits',1,1,1,1,'phone-lookup',JSON_OBJECT('providerUsageSeparate',true),JSON_OBJECT('format','crm-update'))
ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),pricing_config_json=VALUES(pricing_config_json),output_contract_json=VALUES(output_contract_json);

INSERT INTO billing_offers(offer_code,name,purchase_mode,tier_code,entitlement_key,credit_grant,active,config_json) VALUES
('dialer_starter_monthly','Dialer Starter','subscription',NULL,'dialer_starter',0,0,JSON_OBJECT('displayPriceUsd',99,'includedCalls',500,'providerUsageSeparate',true)),
('dialer_growth_monthly','Dialer Growth','subscription',NULL,'dialer_growth',0,0,JSON_OBJECT('displayPriceUsd',299,'includedCalls',2000,'providerUsageSeparate',true)),
('dialer_enterprise_monthly','Dialer Enterprise','subscription',NULL,'dialer_enterprise',0,0,JSON_OBJECT('displayPriceUsd',799,'includedCalls',10000,'providerUsageSeparate',true)),
('quickstrike_50','Quick Strike 50','payment',NULL,NULL,50,0,JSON_OBJECT('displayPriceUsd',99)),
('quickstrike_100','Quick Strike 100','payment',NULL,NULL,100,0,JSON_OBJECT('displayPriceUsd',179))
ON DUPLICATE KEY UPDATE name=VALUES(name),entitlement_key=VALUES(entitlement_key),config_json=VALUES(config_json);
