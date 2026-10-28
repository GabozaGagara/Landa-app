# LANDA — staged migration from GitHub JSON to Cloudflare D1

**STATUS: NOT ENABLED.** The production Worker still reads/writes the private
`GabozaGagara/Landa-financenot/landa-data/backup.json`. This guide describes a future, separately approved migration. Do not run remote migrations or cut over production in an unattended job.

## Why

The present GitHub Contents API updates one entire financial JSON file.
It correctly detects conflicts, but cannot transactionally merge concurrent
admin changes and supplier submissions. D1 can separate transactional entities.

## Prerequisites

1. Export and independently store a *full* LANDA JSON backup.
2. Make sure the current GitHub sync reports success; record source SHA.
3. Validate invoice, payment, allocation, cash and proschet counts and totals.
4. Stop production writes from both LANDA administrator and supplier portals for
   the brief cutover. Keep GitHub untouched as a recovery source.
5. Use a staging Cloudflare Worker and D1 DB first.

## Creating a **staging** D1 database

Cloudflare D1 migrations are versioned SQL scripts.

From the `cloudflare/` folder:

```bash
npx wrangler d1 create landa-finance-staging
```

Copy the returned database ID into the *staging* Worker config. Do not commit
tokens or supplier codes. Example binding **only for staging**:

```toml
[[d1_databases]]
binding = "LANDA_DB"
database_name = "landa-finance-staging"
database_id = "PUT_THE_CREATED_DATABASE_UUID_HERE"
migrations_dir = "migrations"
```

Try migrations locally, then against the *staging* remote database:

```bash
npx wrangler d1 migrations apply landa-finance-staging --local
npx wrangler d1 migrations apply landa-finance-staging --remote
```

## Required import design (not implemented yet)

- Create an **offline import** tool that reads a private full-backup JSON on
  the administrator's machine, validates it, and sends it directly to a
  **staging-only**, admin-authenticated import endpoint.
- Never place the source backup or PAT in the public GitHub repo or CI logs.
- Convert dollars and roubles to integer cents/kopecks. Validate conversion
  of decimal item quantities to `quantity_milli`.
- Insert suppliers, invoice records, line items, payments, allocations,
  cash, historical proschet snapshots, sales and audit events in the required
  dependency order.
- Verify all counts and recomputed per-supplier balances against the source.
- Verify total cash balances per account, proschet historical period counts and
  selected control totals.
- Run concurrency and access-control tests with separate administrator and
  supplier identities.
- Only after full parity, switch a staging Worker to D1 and test supplier
  submissions, owner approvals, balances and backup exports.
- Keep **one writer only** during cutover. Avoid dual-write divergence.
- Establish hourly/daily D1 backups and periodic independent GitHub JSON
  snapshots; check actual restorability.

## Authentication design

Admin must eventually use a separate, revocable, server-validated session;
never grant a supplier the GitHub PAT or unfiltered finance backup.
Session hashes only (not raw tokens) are stored in D1, with expiry and
revocation. A supplier route must filter by session supplier_id **on the server**.

## Explicit rollback

Keep the current Worker deployment and private GitHub JSON intact until
D1 has passed parity and restore tests. If cutover verification fails, disable
staging writes and resume existing GitHub-only Worker. Before returning to GitHub
production, reconcile any data entered after cutover; never overwrite blindly.

**No production D1 binding, database creation, migration or import is performed
by merely adding the SQL and this document to the repository.**
