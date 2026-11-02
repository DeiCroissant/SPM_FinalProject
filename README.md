# Le Bookstore

Team 5's Software Project Management final project. This repository contains application code and developer handoff notes only. Course documents are kept separately in `SPM_Đồ án cuối kì`.

Sprint 1 implements **F1 — accounts and roles**. F2–F5 are not implemented yet. The public home page intentionally says the catalogue is being prepared.

## Run locally

Use Node.js **24 LTS** and npm. From this folder:

```powershell
npm ci
npm run setup
npm run db:init
npm start
```

Open http://localhost:3000. The setup command creates an ignored `.env` with random local demo passwords. Read `ADMIN_EMAIL` / `ADMIN_PASSWORD` and `CUSTOMER_EMAIL` / `CUSTOMER_PASSWORD` in that file to log in. Do not upload `.env`, the SQLite database, or screenshots containing credentials.

`npm run setup` keeps an existing `.env`. `npm run db:init` creates missing tables/accounts; it never overwrites an existing user's password. Run `npm run dev` for automatic server restart while coding. Stop the server with Ctrl+C.

## What works

- Public registration creates only Customer accounts; normalized unique email, name and password validation on the server and native HTML validation in the browser.
- Login for Administrator/Customer; bcrypt password hashes; opaque session cookie backed by a database, eight-hour expiry.
- Logout invalidates the server-side session. Protected pages use `Cache-Control: no-store`; restored browser pages refresh their authorization state.
- Administrator lists accounts, creates either role, locks/unlocks other accounts. Self-lock is rejected server-side. Locking revokes existing sessions.
- Both HTML and API management routes enforce authorization. Hiding a menu is not the access-control mechanism.
- Signed CSRF token on writes, HttpOnly/SameSite cookies, secure cookies in production, database-backed login/registration throttling, escaped HTML output, parameterized queries.

## Architecture

Express + EJS renders the UI from the server. There is no separate SPA or backend project. SQLite makes local development runnable without an external account. PostgreSQL is supported through the same data layer and is **required in production**; there is no production fallback to an ephemeral SQLite file.

| Location | Responsibility |
| --- | --- |
| `src/app.js` | HTTP routes, auth guards, form handling |
| `src/users.js` | Validation, bcrypt, user creation/seeding |
| `src/security.js` | Session helpers, CSRF comparison, rate limits |
| `src/db.js` | SQLite/PostgreSQL adapter and schema |
| `views/`, `public/` | Responsive pages and browser validation |
| `tests/f1.test.js` | Automated HTTP/database/security checks |
| `docs/F1_ACCEPTANCE_AND_TESTS.md` | AC and manual test handoff to Nhung |
| `docs/TEAM_HANDOFF.md` | Responsibilities, demo flow, Jira handoff |

## Verification

```powershell
npm test
```

Tests use an isolated in-memory SQLite database and do not touch local demo data. Automated results do not replace Nhung's independent browser checks, screenshots, or PO acceptance. PostgreSQL and Vercel must be verified after real service configuration.

## Vercel preparation

The serverless entry is `api/index.js`; `vercel.json` bundles EJS views/static assets and routes requests into the app.

1. Create a persistent PostgreSQL database and obtain its connection string. This repo does not create a cloud account or database.
2. Configure `DATABASE_URL`, a random `SESSION_SECRET` of at least 32 characters, and initial `ADMIN_EMAIL` / `ADMIN_PASSWORD` in a trusted local environment and the matching Vercel environment. Never commit real values. `CUSTOMER_EMAIL` / `CUSTOMER_PASSWORD` are optional seed accounts.
3. Against that database, run `npm run db:init` once from a trusted shell, with those environment variables set. Migrations and seeding are explicit, not automatically run on every production request. Use provider-required TLS settings in the connection string; do not disable certificate verification.
4. Import the repository into Vercel with the code repository as Root Directory; use the Node.js 24 runtime and the included configuration. No frontend build is required.
5. Verify deployed register/login/admin lock/logout, cookies, authorization and persistence across deployments before the class demo. The app deliberately returns a setup error if production `DATABASE_URL`/`SESSION_SECRET` is absent.

Cloud hosting, PostgreSQL provisioning and production verification are **pending**. Local success does not prove deployment works. Provider free-tier availability/limits must be checked when provisioning.

References: [Express on Vercel](https://vercel.com/docs/frameworks/backend/express), [Node.js 24 SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html).

## Next Sprints

F2: book/category/author management and soft delete. F3: responsive grid, newest-first, 12/page and 30+ seeds. F4: details, friendly missing/hidden IDs and return-state navigation. F5: combined title/author search, category/price filters and paging. Receive the exact CR01 before adding its scope.

Extend `src/db.js` with book migrations and keep all management endpoints under the guarded `/admin` and `/api/admin` namespaces. Do not substitute browser localStorage for durable catalogue or account data.

## Sprint 2 F2 catalogue management

F2 is implemented on `codex/sprint2-f2`. Start the existing app with `npm start`, log in as Administrator, then open `/admin/books`. Add categories and authors first, then create/edit/hide books. Cover images use HTTP/HTTPS URLs. Hide preserves the database record.

Run `npm test` for F1 regression and F2 validation/security checks. Read [F2 acceptance and code evidence](docs/F2_ACCEPTANCE_AND_TESTS.md) for exact files, routes, test mapping and QA handoff. The public `/books` and `/books/:id` pages currently provide the minimum read surfaces needed for F2; full F3 pagination, seed and performance verification are separate work.

## Sprint 2 F3 public catalogue

F3 adds `/books?page=1` with 12 active books per page, newest-first order, responsive cards and a cover fallback. Add the optional sample catalogue explicitly with `npm run seed:catalogue`; it preserves existing records. Set `PUBLIC_BASE_URL` when the app is not at localhost:3000. On a fresh catalogue the 32 sample books produce 12/12/8 pages.

See [F3 acceptance and measurements](docs/F3_ACCEPTANCE_AND_TESTS.md) for code locations, pagination edge cases, local performance measurements and independent QA handoff. Full F4 back-to-page behavior, F5 search/filter and hosting remain separate work.
