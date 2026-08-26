-- Reconcile the temporary storefront monetization schema before migration 004.
-- Safe to run more than once. Run after 003 and before 004.

SET @made_deck_has_store_credit_ledger := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'credit_ledger'
    AND column_name = 'store_id'
);

SET @made_deck_has_user_credit_ledger := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'credit_ledger'
    AND column_name = 'user_id'
);

SET @made_deck_has_legacy_backup := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name = 'legacy_store_credit_ledger_pre_full'
);

SET @made_deck_reconcile_sql := IF(
  @made_deck_has_store_credit_ledger > 0
  AND @made_deck_has_user_credit_ledger = 0
  AND @made_deck_has_legacy_backup = 0,
  'RENAME TABLE credit_ledger TO legacy_store_credit_ledger_pre_full',
  IF(
    @made_deck_has_store_credit_ledger > 0
    AND @made_deck_has_user_credit_ledger = 0
    AND @made_deck_has_legacy_backup > 0,
    'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''Manual credit_ledger reconciliation required: legacy backup already exists''',
    'SELECT ''credit_ledger schema already compatible or previously preserved'' AS migration_status'
  )
);

PREPARE made_deck_reconcile_stmt FROM @made_deck_reconcile_sql;
EXECUTE made_deck_reconcile_stmt;
DEALLOCATE PREPARE made_deck_reconcile_stmt;
