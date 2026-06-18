# CLAUDE.md — commercial-pm

Commercial property management demo: operations + accounting for multi-tenant
**commercial** real estate. The whole point is the commercial 20% that residential
tools and Yardi handle badly — CAM recoveries, base-year stops, percentage rent,
and a real AP workflow with compliance gates, work verification, and approval
routing. This is a portfolio piece aimed at PropTech roles, so it must look and
behave like a shippable product, not a toy.

## Conventions (match the trading-bot repo)
- TypeScript + ESM. `module`/`moduleResolution` = Node16, so **relative imports use
  the `.js` extension** (e.g. `import { db } from './db.js'`).
- `better-sqlite3`. DB lives at `data/commercial-pm.db` (git-ignored).
- Schema changes go in `/migrations` as new numbered `.sql` files. **Never edit an
  applied migration** — add `003_*.sql`, `004_*.sql`, etc. `src/db.ts` applies them
  in order on boot.
- Demo data is `seed.sql`, loaded by `npm run seed` (kept out of migrations).
- Structure: `src/index.ts` only bootstraps. One Express `Router` per domain in
  `src/routes/` (reports, ap, leasing, vendors, capital, investor), mounted under `/api`.
  Keep SQL as prepared statements near its router; promote to `src/queries/` if it grows.
  EJS screens in `/views`, named after the screen.
- Frontend: EJS views in `/views` + static assets in `/public`. Build finished
  screens from the references in `/design` — match `design/DESIGN.md` exactly.
- Deploy: `deploy.sh` (ff-only pull, build, `pm2 startOrReload`). Port 4010, own
  Nginx vhost. **Do not touch port 3333 or the other PM2 services on the server.**

## Run
`npm install` → `npm run seed` (migrates + seeds) → `npm run dev` (http://localhost:4010).

## Build order
1. **Budget vs actual** — `/views/budget-vs-actual.ejs` from `design/budget-vs-actual.html`,
   reading `/api/budget-vs-actual`. Add header rollup (`v_budget_vs_actual_grouped`)
   with drill-down, a variance filter ($/% threshold), and account search.
2. **Rent roll** — view off `v_rent_roll`.
3. **AP intake + review** — upload a PDF → `src/reader.ts` extracts + suggests coding
   → draft into `invoices`/`invoice_lines` with `coding_source`/`confidence` → review
   screen from `design/ap-review-queue.html` with the pre-payment gates + approval chain.
4. **Vendor onboarding** — banking + insurance-certificate capture, approve-before-active.
5. **Capital projects** — capex vs a project budget; reuse the approval engine, route to
   capital accounts.
6. **Investor reporting — debt/mortgage stacking** — `loans` per building (balance, rate,
   maturity, LTV, DSCR) → portfolio debt-stack. Different audience; its own section.

## Data-model invariants (do not simplify away)
These encode the product's differentiation. Never collapse them into hardcoded
logic or boolean flags to save effort. If a build needs one and it's missing,
add it via a new numbered migration.
- Approval routing is DATA-DRIVEN via an `approval_rules` table (scope + trigger +
  threshold -> required role). Never hardcode thresholds in a route. "Configure
  approvals without a developer" is a selling point.
- Roles are a first-class ranked `roles` table, referenced by users and rules.
- Recurring obligations live in `service_contracts`; the work-verification gate
  reads `work_confirmations` against them, not a boolean on the vendor.
- Money is always integer cents. Reports read from SQL views, not ad-hoc queries.
- Schema changes are new numbered migrations; never edit an applied one.

## Rules
- One commit per concern. Test before deploy.
- Any **mutating** route (approve / reject / pay / vendor edits) requires auth from the
  start — sessions + hashed passwords. Don't ship destructive controls unauthenticated.
- The invoice reader keeps a human in the loop; extraction is a draft, never an auto-pay.
