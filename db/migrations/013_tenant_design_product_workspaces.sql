-- Additive tenant-owned design and saved-product workspaces.
-- No foreign keys: legacy GoDaddy schemas use mixed integer definitions.
CREATE TABLE IF NOT EXISTS tenant_designs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  design_key VARCHAR(100) NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NULL,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  product_key VARCHAR(60) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'draft',
  schema_version INT UNSIGNED NOT NULL DEFAULT 7,
  design_json LONGTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant_design (account_id, design_key),
  KEY idx_tenant_design_owner (account_id, owner_user_id, updated_at),
  KEY idx_tenant_design_store (account_id, store_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tenant_saved_products (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_key VARCHAR(100) NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NULL,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  catalog_product_id BIGINT UNSIGNED NULL,
  name VARCHAR(160) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'draft',
  retail_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  product_json LONGTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant_saved_product (account_id, product_key),
  KEY idx_tenant_product_owner (account_id, owner_user_id, updated_at),
  KEY idx_tenant_product_store (account_id, store_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
