-- LANDA D1 schema, staging only. Do not apply until a backup and migration verification are complete.
-- All amounts use integer minor units: USD and RUB cents/kopecks.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY NOT NULL,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  invoice_number TEXT NOT NULL,
  tracking TEXT,
  invoice_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','transit','ready','delivered','received')),
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending','approved','rejected')),
  accrued INTEGER NOT NULL DEFAULT 0 CHECK (accrued IN (0,1)),
  goods_cents INTEGER NOT NULL DEFAULT 0 CHECK (goods_cents >= 0),
  delivery_cents INTEGER NOT NULL DEFAULT 0 CHECK (delivery_cents >= 0),
  include_delivery INTEGER NOT NULL DEFAULT 0 CHECK (include_delivery IN (0,1)),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  route TEXT,
  sender TEXT,
  notes TEXT,
  status_checked_at TEXT,
  status_source TEXT,
  accrued_at TEXT,
  reviewed_at TEXT,
  submitted_at TEXT,
  raw_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (supplier_id, invoice_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_tracking_unique
  ON invoices (lower(tracking)) WHERE tracking IS NOT NULL AND tracking != '';
CREATE INDEX IF NOT EXISTS invoices_supplier_date
  ON invoices (supplier_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS invoices_status_date
  ON invoices (status, invoice_date DESC);

CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY NOT NULL,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL CHECK (line_number >= 1),
  name TEXT NOT NULL,
  sku TEXT,
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  UNIQUE (invoice_id, line_number)
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id TEXT PRIMARY KEY NOT NULL,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  payment_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  from_cash INTEGER NOT NULL DEFAULT 0 CHECK (from_cash IN (0,1)),
  is_opening INTEGER NOT NULL DEFAULT 0 CHECK (is_opening IN (0,1)),
  note TEXT,
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS payments_supplier_date
  ON supplier_payments (supplier_id,payment_date DESC);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id TEXT PRIMARY KEY NOT NULL,
  payment_id TEXT NOT NULL REFERENCES supplier_payments(id) ON DELETE RESTRICT,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS allocations_invoice ON payment_allocations (invoice_id);
CREATE INDEX IF NOT EXISTS allocations_payment ON payment_allocations (payment_id);

CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY NOT NULL,
  movement_date TEXT NOT NULL,
  account TEXT NOT NULL CHECK (account IN ('RUB','USD','CARD','AVITO')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor != 0),
  kind TEXT NOT NULL,
  category TEXT,
  note TEXT,
  rate_kopecks INTEGER,
  transfer_id TEXT,
  exchange_id TEXT,
  payment_id TEXT REFERENCES supplier_payments(id),
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS cash_account_date ON cash_movements (account,movement_date DESC);

CREATE TABLE IF NOT EXISTS sale_records (
  id TEXT PRIMARY KEY NOT NULL,
  sale_date TEXT NOT NULL,
  invoice_id TEXT REFERENCES invoices(id),
  item_line_number INTEGER,
  item_name TEXT NOT NULL,
  channel TEXT,
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  purchase_unit_cents INTEGER NOT NULL CHECK (purchase_unit_cents >= 0),
  purchase_rate_kopecks INTEGER NOT NULL CHECK (purchase_rate_kopecks > 0),
  sale_unit_kopecks INTEGER NOT NULL CHECK (sale_unit_kopecks >= 0),
  fees_kopecks INTEGER NOT NULL DEFAULT 0 CHECK (fees_kopecks >= 0),
  delivery_kopecks INTEGER NOT NULL DEFAULT 0 CHECK (delivery_kopecks >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS proschet_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  snapshot_date TEXT,
  label TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS proschet_rows (
  id TEXT PRIMARY KEY NOT NULL,
  group_id TEXT NOT NULL,
  subgroup TEXT,
  name TEXT NOT NULL,
  source_row INTEGER,
  values_json TEXT NOT NULL DEFAULT '{}',
  notes_json TEXT NOT NULL DEFAULT '{}',
  aux_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  event_time TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('admin','supplier','system')),
  actor_supplier_id TEXT REFERENCES suppliers(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS audit_events_date ON audit_events (event_time DESC);

CREATE TABLE IF NOT EXISTS sessions (
  session_hash TEXT PRIMARY KEY NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','supplier')),
  supplier_id TEXT REFERENCES suppliers(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  CHECK ((role='supplier' AND supplier_id IS NOT NULL) OR (role='admin' AND supplier_id IS NULL))
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS app_meta (
  meta_key TEXT PRIMARY KEY NOT NULL,
  meta_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
