-- LANDA: D1 migration foundation (PREPARATION ONLY). No existing backup is changed.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS suppliers (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS invoices (
 id TEXT PRIMARY KEY, seq INTEGER NOT NULL, supplier_id TEXT NOT NULL REFERENCES suppliers(id),
 date TEXT NOT NULL, number TEXT NOT NULL, tracking TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'created' CHECK(status IN ('created','transit','ready','delivered')),
 review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','approved','rejected')),
 accrued INTEGER NOT NULL DEFAULT 0 CHECK(accrued IN (0,1)),
 accrued_at TEXT, reviewed_at TEXT, reviewed_by TEXT,
 goods_usd_cents INTEGER NOT NULL DEFAULT 0, delivery_usd_cents INTEGER NOT NULL DEFAULT 0,
 include_delivery INTEGER NOT NULL DEFAULT 0, total_usd_cents INTEGER NOT NULL DEFAULT 0,
 sender TEXT, route TEXT, note TEXT, status_checked_at TEXT, status_source TEXT,
 submitted_at TEXT, version INTEGER NOT NULL DEFAULT 1,
 CHECK(goods_usd_cents>=0 AND delivery_usd_cents>=0 AND total_usd_cents>=0)
);
CREATE INDEX IF NOT EXISTS idx_invoices_supplier_date ON invoices(supplier_id,date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status,review_status);
CREATE TABLE IF NOT EXISTS invoice_items (
 id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
 name TEXT NOT NULL, sku TEXT, quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 unit_price_usd_cents INTEGER NOT NULL CHECK(unit_price_usd_cents>=0)
);
CREATE TABLE IF NOT EXISTS payments (
 id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id),
 date TEXT NOT NULL, amount_usd_cents INTEGER NOT NULL CHECK(amount_usd_cents>0),
 from_cash INTEGER NOT NULL CHECK(from_cash IN (0,1)), is_opening INTEGER NOT NULL DEFAULT 0,
 note TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_supplier_date ON payments(supplier_id,date DESC);
CREATE TABLE IF NOT EXISTS allocations (
 id TEXT PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES payments(id),
 invoice_id TEXT NOT NULL REFERENCES invoices(id),
 amount_usd_cents INTEGER NOT NULL CHECK(amount_usd_cents>0)
);
CREATE INDEX IF NOT EXISTS idx_allocations_invoice ON allocations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_allocations_payment ON allocations(payment_id);
CREATE TABLE IF NOT EXISTS cash_movements (
 id TEXT PRIMARY KEY, date TEXT NOT NULL, account TEXT NOT NULL CHECK(account IN ('RUB','USD','CARD','AVITO')),
 amount_cents INTEGER NOT NULL, kind TEXT NOT NULL, category TEXT, note TEXT,
 payment_id TEXT REFERENCES payments(id), transfer_id TEXT, exchange_id TEXT,
 rate_rub_per_usd_cents INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cash_account_date ON cash_movements(account,date DESC);
CREATE TABLE IF NOT EXISTS sales (
 id TEXT PRIMARY KEY, date TEXT NOT NULL, invoice_id TEXT REFERENCES invoices(id),
 item_name TEXT NOT NULL, channel TEXT NOT NULL, qty_milli INTEGER NOT NULL CHECK(qty_milli>0),
 purchase_usd_cents INTEGER NOT NULL, rate_rub_per_usd_cents INTEGER NOT NULL,
 sale_rub_cents INTEGER NOT NULL, fees_rub_cents INTEGER NOT NULL, delivery_rub_cents INTEGER NOT NULL,
 note TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
 id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL,
 action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
 summary TEXT NOT NULL, previous_version INTEGER, next_version INTEGER
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(at DESC);
CREATE TABLE IF NOT EXISTS sync_meta (
 id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT
);
INSERT OR IGNORE INTO sync_meta(id,revision) VALUES(1,0);
