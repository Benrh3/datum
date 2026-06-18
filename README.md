# Commercial PM (demo)

Operations + accounting for multi-tenant commercial real estate — CAM recoveries,
budget-vs-actual with accruals, and an AP workflow with compliance gates, work
verification, and approval routing. A PropTech portfolio piece built to feel shippable.

## Stack
TypeScript + Express (ESM), SQLite via better-sqlite3, EJS views. Same conventions as
the hyperliquid-trading-bot repo.

## Run
```
npm install
npm run seed     # migrates the schema + loads demo data
npm run dev      # http://localhost:4010
```

`CLAUDE.md` is the working brief (conventions, build order, rules). Visual spec is in
`/design`. Deploy via `deploy.sh` (git pull → build → PM2), on its own port.
