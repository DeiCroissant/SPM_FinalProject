# F3 catalogue browsing and acceptance evidence

Prepared 2 November 2026. Implementation branch: `codex/sprint2-f3`, based on F2 commit `0303754`. F3 is submitted as a separate change for review against develop. F2 PR #2 has been merged into develop. Record the actual F3 PR head commit when executing QA. This file records developer checks, not Nhung's independent QA or PO acceptance.

## Run and view

From the code directory:

```
npm run seed:catalogue
npm start
```

Open `/books`. The explicit seed adds 32 sample books on a fresh catalogue; it does not delete users, reset existing books, overwrite edits or unhide records. It is repeatable. Set `PUBLIC_BASE_URL` to the actual app origin before seeding when the app is not at `http://localhost:3000`; this sets the cover URLs. Samples use the local cover asset rather than an external image service.

The seed was tested in isolated memory databases for this task; it has not been run against the team's existing local database. On an existing catalogue the total may exceed 32; the exact 12/12/8 acceptance fixture is a fresh catalogue with 32 active books. Hidden seed records stay hidden on repeat runs.

## Acceptance and code map

| AC | Implementation / evidence |
| --- | --- |
| AC10.1 | `views/books-public.ejs`: each card has cover, title, author and formatted VND price; links open the existing minimal detail route. |
| AC10.2 | `public/styles.css`: 4 columns at desktop, 3 at tablet and 2 on phones; Edge verified at 1280/768/360 px with no horizontal page overflow. |
| AC10.3 | `src/catalogue.js`, `listBookPage`: count and page queries both filter `is_deleted=0`; a hidden fixture is absent from results and counts. |
| AC11.1 | `BOOKS_PER_PAGE=12`; page query uses parameterized LIMIT/OFFSET. Previous/Next and accessible numbered links work. |
| AC11.2 | `ORDER BY created_at DESC, id DESC`; stable tie-break; a newly saved book is first. |
| AC11.3 | Browser complete-load measurements with 32 active books and local covers: see measured results below. Hosted performance remains unverified. |
| AC11.4 | Seed/test fixture: 32 active books -> page counts 12/12/8; no overlap between pages. |

`src/catalogue-routes.js` validates the page input before querying. Missing page means page 1; malformed, nonpositive, fractional, array or unsafe-integer inputs receive a friendly HTTP400. A positive page beyond the end redirects to the last valid page. An empty catalogue shows an empty-state message without broken pagination.

`public/app.js` replaces a failed cover with the local fallback once, without an error loop. Eager image loading is bounded to the 12 visible page records, so the complete-page measurement includes all page cover loads.

## Developer validation

`npm test`: **51 passed, 0 failed** on 2 November 2026: 25 F1 + 17 F2 + 9 F3 developer tests. Run log: `output/f3/test-run-20261102.txt`. Tests cover card fields, hidden records, 12/12/8 pagination, newest-first order, malformed and out-of-range pages, empty state, 12/13-book boundaries, stable timestamp ties, and idempotent seed preservation.

Browser: Microsoft Edge via bundled Playwright (Browser plugin unavailable), isolated localhost app with SQLite in memory, 32 active samples plus one hidden fixture, local covers, no network or CPU throttling. For each viewport, a fresh browser context made 5 navigations; first navigation was cold, later navigations warm. Timing is wall-clock from navigation start until the load event and all 12 cover images are complete with a nonzero natural width.

| Width | Five complete-load times (ms) | Maximum |
| --- | --- | --- |
| 1280 | 171, 61, 47, 48, 46 | 171 ms |
| 768 | 93, 45, 44, 56, 52 | 93 ms |
| 360 | 109, 52, 54, 54, 49 | 109 ms |

Each viewport also exercised Page 1 -> Page 2 -> Page 3 -> Previous, showing 12/12/8 cards. Page title and heading were verified; no unexpected console/JavaScript errors or blank/framework error page appeared. A separate intentionally missing-cover case verified the fallback; its expected HTTP404 is not counted as an unexpected error.

Screenshots and the JSON browser measurement record are in the temporary F3 QA workspace. These values apply only to this local environment, not Vercel, production, remote cover hosts or a deployed PostgreSQL database. Re-measure on the selected host before making a hosted <2 second claim.

## Review handoff

- Nhung runs the AC checks on the actual F3 commit and records her own results, defects and evidence.
- F2 PR #2 is merged into develop. This F3 change targets develop separately; its integration and independent QA remain pending.
- Exact back-to-list-page behavior and full book-detail acceptance remain F4 work. Search/filter remain F5 work.
- This task did not edit the SPM workbook, Jira, CR decision or production configuration.
