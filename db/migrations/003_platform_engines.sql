-- MadeDeck v0.6 platform engines foundation
-- Apply once after 002_saas_foundation.sql.

ALTER TABLE users MODIFY role ENUM(
  'admin','merchant','customer','platform_admin','merchant_admin','merchant_staff',
  'production_vendor','platform_staff','finance_admin','super_admin'
) NOT NULL DEFAULT 'customer';

ALTER TABLE store_members MODIFY member_role ENUM('owner','admin','staff','viewer','finance') NOT NULL DEFAULT 'staff';

CREATE TABLE IF NOT EXISTS billing_plans (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  monthly_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  annual_price DECIMAL(10,2) NULL,
  promo_first_month_price DECIMAL(10,2) NULL,
  activation_fee DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  preorder_fee DECIMAL(10,2) NOT NULL DEFAULT 6.00,
  managed_preorder_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
  platform_fee_percent DECIMAL(7,4) NOT NULL DEFAULT 0,
  platform_fee_fixed DECIMAL(10,2) NOT NULL DEFAULT 0,
  metadata_json JSON NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS billing_plan_benefits (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  plan_id BIGINT UNSIGNED NOT NULL,
  benefit_key VARCHAR(100) NOT NULL,
  value_json JSON NOT NULL,
  UNIQUE KEY uq_plan_benefit(plan_id,benefit_key),
  CONSTRAINT fk_plan_benefit_plan FOREIGN KEY(plan_id) REFERENCES billing_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS store_usage_counters (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  usage_key VARCHAR(100) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  quantity DECIMAL(14,4) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_store_usage(store_id,usage_key,period_start,period_end),
  CONSTRAINT fk_usage_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS revenue_rules (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scope_type ENUM('platform','store','product','campaign') NOT NULL DEFAULT 'platform',
  scope_id BIGINT UNSIGNED NULL,
  event_key VARCHAR(100) NOT NULL,
  version_no INT UNSIGNED NOT NULL,
  status ENUM('draft','active','retired') NOT NULL DEFAULT 'draft',
  base_amount DECIMAL(10,2) NULL,
  percent_amount DECIMAL(8,4) NULL,
  rule_json JSON NULL,
  effective_at DATETIME NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_revenue_rule(scope_type,scope_id,event_key,version_no),
  INDEX idx_revenue_active(scope_type,scope_id,event_key,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS money_routing_versions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NULL,
  version_no INT UNSIGNED NOT NULL,
  status ENUM('draft','active','retired') NOT NULL DEFAULT 'draft',
  routing_json JSON NOT NULL,
  change_reason VARCHAR(500) NULL,
  approved_by BIGINT UNSIGNED NULL,
  approved_at DATETIME NULL,
  effective_at DATETIME NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_money_route_version(store_id,version_no),
  INDEX idx_money_route_active(store_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS financial_change_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NULL,
  change_type VARCHAR(100) NOT NULL,
  old_value_json JSON NULL,
  new_value_json JSON NOT NULL,
  status ENUM('pending','approved','rejected','cancelled','applied') NOT NULL DEFAULT 'pending',
  requested_by BIGINT UNSIGNED NOT NULL,
  approved_by BIGINT UNSIGNED NULL,
  reauth_required BOOLEAN NOT NULL DEFAULT TRUE,
  dual_approval_required BOOLEAN NOT NULL DEFAULT FALSE,
  security_hold_until DATETIME NULL,
  applied_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_fin_change_status(status,security_hold_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_economic_snapshots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL UNIQUE,
  revenue_rule_version_json JSON NOT NULL,
  money_route_version_json JSON NOT NULL,
  totals_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_snapshot_order FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_ledger_entries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NOT NULL,
  entry_type ENUM('customer_payment','tax','processor_fee','shipping','production_cost','merchant_margin','platform_fee','vendor_payable','refund','chargeback','adjustment') NOT NULL,
  recipient_type ENUM('platform','merchant','vendor','tax','processor','carrier','customer','other') NOT NULL,
  recipient_ref VARCHAR(190) NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  status ENUM('pending','earned','held','settled','reversed') NOT NULL DEFAULT 'pending',
  source_version VARCHAR(100) NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ledger_order(order_id),
  INDEX idx_ledger_recipient(recipient_type,recipient_ref,status),
  CONSTRAINT fk_ledger_order FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_ledger_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vendor_profiles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(190) NULL,
  phone VARCHAR(60) NULL,
  status ENUM('active','paused','disabled') NOT NULL DEFAULT 'active',
  capabilities_json JSON NULL,
  default_turnaround_days INT UNSIGNED NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_vendor_user(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vendor_jobs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  vendor_id BIGINT UNSIGNED NOT NULL,
  status ENUM('queued','notified','accepted','printing','qc','complete','cancelled') NOT NULL DEFAULT 'queued',
  production_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  job_sheet_json JSON NOT NULL,
  notified_at DATETIME NULL,
  accepted_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_vendor_job_vendor(vendor_id,status),
  CONSTRAINT fk_vendor_job_order FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_vendor_job_vendor FOREIGN KEY(vendor_id) REFERENCES vendor_profiles(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vendor_payables (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  vendor_job_id BIGINT UNSIGNED NOT NULL UNIQUE,
  vendor_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  status ENUM('pending','approved','paid','void') NOT NULL DEFAULT 'pending',
  payment_method VARCHAR(80) NULL,
  payment_reference VARCHAR(190) NULL,
  approved_by BIGINT UNSIGNED NULL,
  approved_at DATETIME NULL,
  paid_by BIGINT UNSIGNED NULL,
  paid_at DATETIME NULL,
  notes VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payable_job FOREIGN KEY(vendor_job_id) REFERENCES vendor_jobs(id) ON DELETE CASCADE,
  CONSTRAINT fk_payable_vendor FOREIGN KEY(vendor_id) REFERENCES vendor_profiles(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE preorder_campaigns
  ADD COLUMN description VARCHAR(180) NULL,
  ADD COLUMN hero_asset_url VARCHAR(600) NULL,
  ADD COLUMN public_token VARCHAR(96) NULL,
  ADD COLUMN setup_fee DECIMAL(10,2) NOT NULL DEFAULT 6.00,
  ADD COLUMN managed_service BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN managed_service_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN target_amount DECIMAL(12,2) NULL,
  ADD COLUMN threshold_behavior ENUM('produce','refund','manual_review') NOT NULL DEFAULT 'produce';

CREATE UNIQUE INDEX uq_preorder_public_token ON preorder_campaigns(public_token);

CREATE TABLE IF NOT EXISTS direct_pay_campaigns (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  creator_user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(180) NOT NULL,
  description VARCHAR(180) NULL,
  hero_asset_url VARCHAR(600) NULL,
  public_token VARCHAR(96) NOT NULL UNIQUE,
  status ENUM('draft','live','paused','closed','cancelled') NOT NULL DEFAULT 'draft',
  target_amount DECIMAL(12,2) NULL,
  amount_raised DECIMAL(12,2) NOT NULL DEFAULT 0,
  platform_fee_percent DECIMAL(8,4) NOT NULL DEFAULT 0,
  platform_fee_fixed DECIMAL(10,2) NOT NULL DEFAULT 0,
  closes_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_direct_pay_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_direct_pay_creator FOREIGN KEY(creator_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS direct_pay_contributions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  campaign_id BIGINT UNSIGNED NOT NULL,
  contributor_name VARCHAR(190) NULL,
  contributor_email VARCHAR(190) NULL,
  amount DECIMAL(12,2) NOT NULL,
  payment_provider VARCHAR(60) NULL,
  payment_reference VARCHAR(190) NULL,
  status ENUM('pending','paid','refunded','failed','chargeback') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_contribution_campaign FOREIGN KEY(campaign_id) REFERENCES direct_pay_campaigns(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS artwork_versions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NULL,
  campaign_id BIGINT UNSIGNED NULL,
  asset_id BIGINT UNSIGNED NULL,
  version_no INT UNSIGNED NOT NULL,
  source_file_name VARCHAR(255) NOT NULL,
  source_file_url VARCHAR(600) NOT NULL,
  production_file_url VARCHAR(600) NULL,
  proof_file_url VARCHAR(600) NULL,
  metadata_json JSON NULL,
  status ENUM('uploaded','review','approved','rejected','superseded') NOT NULL DEFAULT 'uploaded',
  locked_for_live_campaign BOOLEAN NOT NULL DEFAULT FALSE,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_artwork_product(product_id,version_no),
  CONSTRAINT fk_artwork_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_state_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  from_state VARCHAR(60) NULL,
  to_state VARCHAR(60) NOT NULL,
  actor_type VARCHAR(60) NOT NULL,
  actor_ref VARCHAR(190) NULL,
  reason VARCHAR(500) NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_order_state(order_id,created_at),
  CONSTRAINT fk_order_state_order FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shipments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  carrier VARCHAR(80) NULL,
  service VARCHAR(120) NULL,
  tracking_number VARCHAR(190) NULL,
  label_url VARCHAR(600) NULL,
  shipping_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  status ENUM('rate_selected','label_created','in_transit','delivered','lost','returned','cancelled') NOT NULL DEFAULT 'rate_selected',
  shipped_at DATETIME NULL,
  delivered_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_shipment_order FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS support_tickets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NULL,
  order_id BIGINT UNSIGNED NULL,
  opened_by BIGINT UNSIGNED NULL,
  ticket_type ENUM('support','refund','reprint','damage','fraud','chargeback','shipping','other') NOT NULL DEFAULT 'support',
  priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  status ENUM('open','waiting_customer','waiting_merchant','waiting_vendor','resolved','closed') NOT NULL DEFAULT 'open',
  subject VARCHAR(190) NOT NULL,
  body TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_support_store(store_id,status),
  INDEX idx_support_order(order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notification_preferences (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  channel ENUM('email','sms','in_app') NOT NULL,
  event_key VARCHAR(100) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_notify_pref(user_id,channel,event_key),
  CONSTRAINT fk_notify_pref_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO billing_plans(code,name,monthly_price,annual_price,promo_first_month_price,activation_fee,preorder_fee,managed_preorder_fee,platform_fee_percent,platform_fee_fixed,metadata_json)
VALUES
('payg','Pay As You Go',0,NULL,NULL,1.00,6.00,0,0,0,JSON_OBJECT('storefront',false,'preorders_included',0)),
('creator','Creator',19.00,190.00,1.00,0,2.00,0,2.5,0.25,JSON_OBJECT('storefront',true,'preorders_included',2)),
('growth','Growth',39.00,390.00,1.00,0,0.00,0,1.5,0.15,JSON_OBJECT('storefront',true,'preorders_included',10,'analytics',true))
ON DUPLICATE KEY UPDATE name=VALUES(name),monthly_price=VALUES(monthly_price),annual_price=VALUES(annual_price),promo_first_month_price=VALUES(promo_first_month_price);

-- Vendor policy: vendors receive job notifications and accrue payables, but MadeDeck does not auto-pay them.
-- Vendor payable settlement requires an explicit finance/super-admin action and records who approved and who paid.
