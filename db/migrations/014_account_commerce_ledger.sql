-- Account-scoped subscriptions, purchases, and credits. Additive only.
CREATE TABLE IF NOT EXISTS account_commerce_purchases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  offer_code VARCHAR(80) NOT NULL,
  purchase_kind ENUM('subscription','credits') NOT NULL,
  stripe_checkout_session_id VARCHAR(190) NOT NULL UNIQUE,
  stripe_payment_intent_id VARCHAR(190) NULL,
  amount_total BIGINT NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  status ENUM('pending','paid','failed','refunded') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_account_purchase(account_id,status,created_at),
  CONSTRAINT fk_account_purchase_account FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_account_purchase_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS account_subscriptions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id BIGINT UNSIGNED NOT NULL,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  offer_code VARCHAR(80) NOT NULL,
  plan_key VARCHAR(40) NOT NULL,
  stripe_subscription_id VARCHAR(190) NOT NULL UNIQUE,
  stripe_customer_id VARCHAR(190) NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'active',
  monthly_credit_grant INT NOT NULL DEFAULT 0,
  next_credit_grant_at DATETIME NULL,
  current_period_end DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_account_subscription(account_id,status),
  CONSTRAINT fk_account_subscription_account FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_account_subscription_user FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS account_credit_ledger (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  bucket ENUM('subscription','purchased','adjustment') NOT NULL,
  amount INT NOT NULL,
  offer_code VARCHAR(80) NOT NULL,
  stripe_event_id VARCHAR(190) NOT NULL,
  source_id VARCHAR(190) NOT NULL,
  expires_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_account_credit_event(account_id,stripe_event_id,offer_code),
  INDEX idx_account_credit_balance(account_id,bucket,expires_at),
  CONSTRAINT fk_account_credit_account FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_account_credit_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
