-- MadeDeck v0.6 monetization, credits, modules and inquiry control plane

CREATE TABLE IF NOT EXISTS platform_plans (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  monthly_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  included_credits INT UNSIGNED NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  stripe_price_id VARCHAR(190) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS platform_modules (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(140) NOT NULL,
  description VARCHAR(500) NULL,
  billing_type ENUM('included','monthly','one_time','credits') NOT NULL DEFAULT 'monthly',
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  credit_cost INT UNSIGNED NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  stripe_price_id VARCHAR(190) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plan_modules (
  plan_id BIGINT UNSIGNED NOT NULL,
  module_id BIGINT UNSIGNED NOT NULL,
  included BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY(plan_id,module_id),
  CONSTRAINT fk_plan_modules_plan FOREIGN KEY(plan_id) REFERENCES platform_plans(id) ON DELETE CASCADE,
  CONSTRAINT fk_plan_modules_module FOREIGN KEY(module_id) REFERENCES platform_modules(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS credit_wallets (
  store_id BIGINT UNSIGNED PRIMARY KEY,
  balance INT NOT NULL DEFAULT 0,
  lifetime_purchased INT UNSIGNED NOT NULL DEFAULT 0,
  lifetime_used INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_credit_wallet_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS credit_ledger (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  amount INT NOT NULL,
  reason VARCHAR(140) NOT NULL,
  reference_type VARCHAR(80) NULL,
  reference_id VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_credit_ledger_store_time(store_id,created_at),
  CONSTRAINT fk_credit_ledger_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inquiries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NULL,
  name VARCHAR(160) NOT NULL DEFAULT '',
  email VARCHAR(190) NOT NULL,
  company VARCHAR(190) NULL,
  source VARCHAR(100) NOT NULL DEFAULT 'website',
  status ENUM('new','contacted','qualified','converted','closed') NOT NULL DEFAULT 'new',
  message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_inquiries_status_time(status,created_at),
  CONSTRAINT fk_inquiry_store FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO platform_plans(code,name,monthly_price,included_credits,active,sort_order) VALUES
('free','Free Studio',0,25,1,10),
('pro','Pro',49,500,1,20),
('advanced','Advanced',129,2000,1,30)
ON DUPLICATE KEY UPDATE name=VALUES(name),sort_order=VALUES(sort_order);

INSERT INTO platform_modules(code,name,description,billing_type,price,credit_cost,active,sort_order) VALUES
('lead-cleanup','Lead Cleanup','Normalize and clean a lead list.','one_time',9,0,1,10),
('prospect-intelligence','Prospect Intelligence','Research, ranking and reputation scan bundle.','one_time',19,0,1,20),
('campaign-launch','Campaign Launch','Scripts, campaign setup and launch workflow.','one_time',29,0,1,30),
('dialer-crm','Dialer + CRM','Calling workspace, outcomes and customer history.','monthly',39,0,1,40),
('product-customizer','Product Customizer','Sell configurable products with production-ready exports.','monthly',49,0,1,50),
('content-engine','Content Engine','Create posts, campaigns and export packages.','credits',0,40,1,60),
('swarm-power','Swarm Power','Taskmaster, bots, missions, approvals and evidence.','monthly',79,0,1,70),
('premium-template-pack','Premium Template Pack','Expanded reusable design and workflow templates.','one_time',29,0,1,80),
('print-credits-50','50 Print Credits','One-time production/export credit pack.','one_time',15,0,1,90)
ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),billing_type=VALUES(billing_type),sort_order=VALUES(sort_order);

INSERT INTO credit_wallets(store_id,balance) SELECT id,0 FROM stores
ON DUPLICATE KEY UPDATE store_id=VALUES(store_id);
