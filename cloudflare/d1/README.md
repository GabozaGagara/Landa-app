# LANDA: D1 migration plan (NOT ACTIVE)

The production system currently uses GitHub-backed `landa-data/backup.json` and Cloudflare Worker. The D1 schema in `migrations/0001_initial.sql` is **prepared only**. Existing links, Cloudflare secrets, supplier codes, and read/write routes must continue to operate exactly as before. **Do not add a D1 binding to production or migrate the current source of truth without validation and the owner's approval.**

## Safe migration sequence

1. Download a full JSON export from the administrative LANDA interface. Confirm it has both `proschet` and `operations`. Keep the original private GitHub history untouched.
2. Create a **separate test database** in Cloudflare D1 and a test Worker environment. Never paste the private backup into the public `Landa-app` repository.
3. Apply `0001_initial.sql` in that test database using Wrangler and perform a one-time data import **from a secure local/private environment**, not from GitHub Pages. Preserve original record IDs and integer money amounts; create stable IDs for `invoice_items` and historical estimate values.
4. Check independently: number and sum of invoices by supplier, pending/accrued totals, payments and allocations, per-account cash balances, number of historical estimate rows/periods, and a random sample of item counts and dates. Confirm every foreign key and payment allocation belongs to the correct supplier.
5. Test simultaneous supplier submissions, updates from the admin, failed writes and retries, security/ownership checks, and offline behavior. Reject duplicate tracking numbers and do not create supplier debt on submission.
6. Add authenticated **admin** APIs to a test Worker; do not expose the D1 binding directly to the browser. Implement explicit roles and expiring sessions. Switch production only after owner review, verified backups, and rollback plan.
7. Keep versioned private GitHub JSON exports as offsite backups even when D1 becomes the primary store. Never publish live records in the public application repository.

### Wrangler setup (only when you have created an actual D1 test database)

Cloudflare's docs require a D1 database UUID. Don't invent one in `wrangler.toml`. For a TEST environment, generate the migration folder/binding using the Cloudflare dashboard or Wrangler, then set `migrations_dir = "d1/migrations"` relative to `cloudflare/wrangler.toml`. No production D1 binding is configured yet.

Docs: https://developers.cloudflare.com/d1/reference/migrations/

## Important accounting considerations

- Money in tables is integer cents to avoid binary-float equality errors.
- `estimate_values` is a separate historical RUB dataset; it must never be merged with operational cash balances automatically.
- `review_status='pending'` does not imply accrual; only explicit confirmed accrual is a debt.
- A supplier may only query their own invoices/summary; no direct access to `cash_entries`, `audit_events`, unrelated suppliers, or raw backup.
- Historical versions of invoices may not have `accrued_at` or `review_status`; importer needs documented legacy defaults rather than silently inventing dates.
- Changes are transactional and auditable; avoid physical deletion of financially settled records.
