# F2 implementation and review evidence

Prepared 2 November 2026 (Asia/Saigon). This is a developer handoff, not independent QA, PO acceptance or a Sprint Done declaration.

## Scope and requirements

Sources read: Final Project Assignment section 2.2 (F2 and minimum quality requirements), plus the current Team 5 Product_Backlog US-06–US-09 and S2 tasks. F2 has 13 acceptance criteria. CR-05 recommends a DBMS change; no such change is implemented here. Adding catalogue tables in the existing database is ordinary F2 schema development, not SQLite-to-PostgreSQL migration.

Branch: `codex/sprint2-f2`, based on local F1 commit `a704f91e045ae52f72436604948c0e49dbe08f6d`. The implementation is submitted for review against develop. Use the pull request head commit when recording QA results; independent review and acceptance are still required.

## Open the app

Use the existing local setup and demo accounts. Run `npm start`, log in as Administrator and open `/admin/books`. From there use Categories and Authors, then Add a book. Do not publish `.env`, passwords or the SQLite file.

Local startup applies additive table creation via `src/runtime.js` -> `src/db.js`. It does not delete/reset F1 users or sessions. Tests use memory databases; the existing local database was not initialized or reset during this implementation. For the existing PostgreSQL adapter, schema initialization remains explicit using `npm run db:init` in the intended environment. PostgreSQL has not been executed or certified in this task; production SQLite restrictions are unchanged.

## Task to code to proof

| Backlog task / AC | Actual source | How to demonstrate |
| --- | --- | --- |
| T03 schema | `src/catalogue.js` `migrateCatalogue`; invoked by `src/db.js` | Show categories/authors/books DDL, references, price/stock constraints and `is_deleted`; run repeatability/preservation test. |
| T04, AC06.1–06.3 | `src/catalogue.js` taxonomy validation and save; `src/catalogue-routes.js`; `views/taxonomy.ejs` | Add/edit taxonomy; select saved entries in book form; show duplicate-name and 0/101-character errors. Unicode-normalized case-insensitive keys are persisted. |
| T05, AC07.1–07.4 | `bookSchema` and `saveBook`; `views/book-form.ejs`; `public/app.js` | Create valid book; show required fields, price zero/negative rejection, stock zero accepted/negative rejected. Show server test results as well as UI. |
| T06, AC08.1–08.3 | `saveBook`, `findBook`; edit routes and form | Update title/price/stock; open public list and detail. Attempt invalid update and confirm original data remains. Unknown edit ID -> friendly 404. |
| T07, AC09.1–09.2 | `hideBook`; `views/books-admin.ejs` | Confirm Hide; public list excludes it but admin shows Hidden/Record retained. Inspect test SQL result and absence of a production DELETE FROM books statement. |
| T08, AC09.3 | `/books/:id` route; `views/book-detail.ejs` | Open hidden book's direct URL -> 404 Book unavailable; hidden edit also fails. |
| Permissions / CSRF | Existing `/admin` and `/api/admin` guards in `src/app.js`; catalogue routes mounted after guards | Test guest HTML redirect/API401, Customer403, Admin success, forged CSRF403. |
| T12 developer checks | `tests/f2.test.js` and existing `tests/f1.test.js` | Run `npm test`; use actual dated output and reviewed commit for presentation. |

## Routes

Administrator pages: `/admin/books`, `/admin/books/new`, `/admin/books/:id/edit`, `/admin/categories`, `/admin/authors`, and taxonomy `/:id/edit` pages.

HTML writes: POST `/admin/books` (create), `/admin/books/:id` (edit), `/admin/books/:id/hide`; taxonomy POST `/admin/categories` or `/admin/authors` and `/:id` for edits.

JSON management endpoints mirror these writes under `/api/admin`; GET `/api/admin/books`, `/api/admin/categories`, `/api/admin/authors` provide the relevant lists. Writes require an authenticated Administrator and the current CSRF token.

Public F2 verification surfaces: `/books` and `/books/:id`. These are minimal read views for F2 acceptance, not a claim of full F3/F4. Pagination, 30/32-book sample seed, measured list performance and exact back-to-page behavior are still future tasks.

## Validation decisions

- Cover images use public HTTP/HTTPS URLs. No upload subsystem is included. A local demonstration cover is available at `/book-cover-placeholder.svg`; enter its absolute localhost URL when testing locally. External covers require network availability.
- Category/author names are trimmed, NFC-normalized and limited to 100 characters; normalized lowercase keys prevent case duplicates. Both taxonomy types support create/edit; there is no delete action.
- Prices must be finite, positive, at most 9,999,999,999.99 and use at most two decimal places. Stock is an integer from 0 to 2,147,483,647. Client constraints and server schemas enforce these separately.
- Author/category IDs are checked before saving; all values use bound parameters. Public templates escape stored text. Only Administrator routes expose management operations.
- Description, title and cover are required. Hidden records cannot be edited or publicly read. There is no restore or hard-delete action.

## Verification performed

Automated run: 2 November 2026, Node 24, isolated SQLite memory databases. `npm test`: **42 pass, 0 fail** (25 F1 + 17 F2 developer tests). All 13 F2 AC have a mapped developer test; AC09.1/09.2 share one test. Additional cases cover authorization, CSRF, bad foreign IDs, stored HTML, Unicode duplicates, HTML form writes and repeatable schema setup. Actual local log: `output/f2/test-run-20261102.txt` (ignored by Git; retain it for the team handoff).

Browser flow: isolated in-memory app on `http://127.0.0.1:3469`, Microsoft Edge via bundled Playwright, 1440×1000 desktop and 390×844 mobile. Browser plugin unavailable; no project browser dependency was installed. Verified login, category/author creation, duplicate rejection, client invalid-price prevention, book create/edit, public detail reflection, Hide confirmation, retained database row, and hidden-book 404. No unexpected console or JavaScript errors in the successful flow. Mobile form had no horizontal page overflow. Expected HTTP409/404 error cases were handled separately.

The browser test server was stopped after verification. Screenshots are retained outside the repository in the temporary QA workspace. These results are developer verification; Nhung must still execute independent QA, review the code and record her actual evidence/date/version before stories are marked Done.

## Handoff checklist

1. Nhung checks the AC cases against the reviewed source version; records actual results and any defects.
2. Ha fixes failures; Nhung retests before PR approval. Do not infer approval from these developer tests.
3. Vinh records actual task evidence and hours in the workbook based on real records; no workbook/Jira edits were made by this coding task.
4. Implement F3 separately, then run regression again. Hosting and the Sponsor's CR-05 decision remain separate unresolved items.
