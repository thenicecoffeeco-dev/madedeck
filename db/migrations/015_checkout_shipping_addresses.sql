-- Additive shipping destinations captured from verified Stripe Checkout events.
CREATE TABLE IF NOT EXISTS checkout_shipping_addresses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  stripe_checkout_session_id VARCHAR(190) NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  recipient_name VARCHAR(190) NULL,
  phone VARCHAR(40) NULL,
  line1 VARCHAR(190) NOT NULL,
  line2 VARCHAR(190) NULL,
  city VARCHAR(120) NOT NULL,
  state VARCHAR(120) NULL,
  postal_code VARCHAR(40) NOT NULL,
  country CHAR(2) NOT NULL,
  source VARCHAR(40) NOT NULL DEFAULT 'stripe_checkout',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_checkout_shipping_session (stripe_checkout_session_id),
  KEY idx_checkout_shipping_account (account_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
