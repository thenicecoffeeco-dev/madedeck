-- Native account-owned side services for the replacement of /v3/market.
-- Additive migration: does not remove or repurpose legacy commerce tables.

ALTER TABLE account_commerce_purchases
  MODIFY purchase_kind ENUM('subscription','credits','service','addon') NOT NULL;

CREATE TABLE IF NOT EXISTS account_service_fulfillment (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  purchase_id BIGINT UNSIGNED NOT NULL,
  service_code VARCHAR(80) NOT NULL,
  status ENUM('pending','queued','in_progress','awaiting_customer','completed','canceled','refunded') NOT NULL DEFAULT 'pending',
  customer_note TEXT NULL,
  internal_note TEXT NULL,
  due_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_service_purchase(purchase_id),
  INDEX idx_service_account(account_id,status,created_at),
  INDEX idx_service_user(account_id,user_id,created_at),
  CONSTRAINT fk_service_account FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_service_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_service_purchase FOREIGN KEY(purchase_id) REFERENCES account_commerce_purchases(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Ledger remains append-only. Negative rows are debits/reversals; positive rows are grants/purchases.
-- Existing UNIQUE(account_id,stripe_event_id,offer_code) keeps webhook replay idempotent.
CREATE INDEX idx_credit_ledger_account_time ON account_credit_ledger(account_id,created_at);
