-- MadeDeck v0.6 reliable notification outbox

CREATE TABLE IF NOT EXISTS notification_outbox (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_key VARCHAR(100) NOT NULL,
  recipient_type ENUM('owner','merchant','vendor','customer','platform_staff','finance') NOT NULL,
  recipient_ref VARCHAR(190) NOT NULL,
  channel ENUM('email','sms','in_app','webhook') NOT NULL DEFAULT 'email',
  subject VARCHAR(190) NULL,
  payload_json JSON NOT NULL,
  status ENUM('queued','sending','sent','failed','cancelled') NOT NULL DEFAULT 'queued',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  last_error VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_outbox_status(status,available_at),
  INDEX idx_outbox_recipient(recipient_type,recipient_ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vendor_settlement_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  vendor_payable_id BIGINT UNSIGNED NOT NULL,
  event_type ENUM('created','approved','marked_paid','voided','note') NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  amount DECIMAL(12,2) NULL,
  reference_value VARCHAR(190) NULL,
  notes VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_vendor_settlement_payable(vendor_payable_id,created_at),
  CONSTRAINT fk_vendor_settlement_payable FOREIGN KEY(vendor_payable_id) REFERENCES vendor_payables(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Operational policy: paid orders notify the platform owner and assigned vendor.
-- Vendor notification is production-only. It never grants payout authority.
-- Vendor money stays as a payable until a finance/super-admin explicitly marks it paid.
