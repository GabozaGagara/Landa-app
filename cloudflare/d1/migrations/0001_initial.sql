-- LANDA future transactional database. NOT ACTIVE. No automatic import or live cutover.
-- Amounts are stored in integer cents (USD or RUB as specified).
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL,
  number TEXT NOT NULL,
  tracking TEXT COLLATE NOCASE,
  invoice_date TEXT NOT NULL,
  destination TEXT,
  sender TEXT,
  status TEXT NOT NULL DEFAULT 'created' CHECK(status IN ('created','transit','ready','delivered')),
  status_checked_at TEXT,
  status_source TEXT,
  goods_cents INTEGER NOT NULL DEFAULT 0 CHECK(goods_cents>=0),
  delivery_cents INTEGER NOT NULL DEFAULT 0 CHECK(delivery_cents>=0),
  include_delivery INTEGER NOT NULL DEFAULT 0 CHECK(include_delivery IN (0,1)),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK(total_cents>=0),
  accrued INTEGER NOT NULL DEFAULT 0 CHECK(accrued IN (0,1)),
  accrued_at TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','approved','rejected')),
  submitted_at TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_tracking_unique ON invoices(tracking) WHERE tracking IS NOT NULL AND tracking<>'';
CREATE INDEX IF NOT EXISTS idx_invoice_supplier_date ON invoices(supplier_id,invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_status ON invoices(status);
CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL CHECK(line_no>=0),
  title TEXT NOT NULL,
  sku TEXT,
  quantity REAL NOT NULL CHECK(quantity>0),
  price_cents INTEGER NOT NULL CHECK(price_cents>=0),
  UNIQUE(invoice_id,line_no)
);
CREATE TABLE IF NOT EXISTS supplier_payments (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  payment_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
  from_cash INTEGER NOT NULL DEFAULT 0 CHECK(from_cash IN (0,1)),
  is_opening INTEGER NOT NULL DEFAULT 0 CHECK(is_opening IN (0,1)),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_supplier_date ON supplier_payments(supplier_id,payment_date DESC);
CREATE TABLE IF NOT EXISTS payment_allocations (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES supplier_payments(id) ON DELETE RESTRICT,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_allocation_invoice ON payment_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_allocation_payment ON payment_allocations(payment_id);
CREATE TABLE IF NOT EXISTS cash_entries (
  id TEXT PRIMARY KEY,
  entry_date TEXT NOT NULL,
  account TEXT NOT NULL CHECK(account IN ('RUB','USD','CARD','AVITO')),
  amount_cents INTEGER NOT NULL,
  kind TEXT NOT NULL,
  category TEXT,
  note TEXT,
  payment_id TEXT REFERENCES supplier_payments(id),
  transfer_id TEXT,
  exchange_id TEXT,
  usd_rate_cents INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cash_date ON cash_entries(entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_cash_account_date ON cash_entries(account,entry_date DESC);
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  sale_date TEXT NOT NULL,
  invoice_item_id TEXT REFERENCES invoice_items(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  channel TEXT,
  quantity REAL NOT NULL CHECK(quantity>0),
  purchase_cents_usd INTEGER NOT NULL DEFAULT 0,
  conversion_rate_cents_rub INTEGER NOT NULL,
  sale_price_cents_rub INTEGER NOT NULL,
  fees_cents_rub INTEGER NOT NULL DEFAULT 0,
  delivery_cents_rub INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_audit_occurred ON audit_events(occurred_at DESC);
-- Historical proschet remains an independent dataset (not linked to real cash balances).
CREATE TABLE IF NOT EXISTS estimate_periods (
  id TEXT PRIMARY KEY,
  period_date TEXT,
  label TEXT NOT NULL,
  source TEXT
);
CREATE TABLE IF NOT EXISTS estimate_rows (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  group_id TEXT NOT NULL,
  subgroup TEXT,
  source_row INTEGER,
  included INTEGER NOT NULL DEFAULT 1 CHECK(included IN (0,1))
);
CREATE TABLE IF NOT EXISTS estimate_values (
  row_id TEXT NOT NULL REFERENCES estimate_rows(id) ON DELETE CASCADE,
  period_id TEXT NOT NULL REFERENCES estimate_periods(id) ON DELETE CASCADE,
  amount_cents_rub INTEGER NOT NULL,
  note TEXT,
  PRIMARY KEY(row_id,period_id)
);
CREATE TABLE IF NOT EXISTS migration_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  legacy_backup_sha TEXT,
  imported_at TEXT,
  confirmed_by_owner_at TEXT,
  verified_invoice_count INTEGER,
  verified_payment_count INTEGER,
  verified_proschet_row_count INTEGER,
  verified_proschet_period_count INTEGER
);
