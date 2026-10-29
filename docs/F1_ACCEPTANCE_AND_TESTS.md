# F1 acceptance criteria and manual verification

Owner: Ha implements; Nhung independently verifies and records results; Ha accepts stories as PO. This is a developer handoff, not a completed Sprint Report or customer sign-off. Manual results below are intentionally **Not Run** until the tester executes them.

The 19 IDs follow the supplied workbook. Guest page requests redirect to `/login`; guest **API** requests return JSON HTTP 401, rather than returning an HTML login page to an API client. Update the workbook wording for AC-05.3 to reflect this implementation decision before formal acceptance. Admin-only routes for F2 are guarded, but book management itself is not part of this S1 implementation.

## Preconditions

Run the setup commands in README. Use local Administrator and Customer seed credentials from `.env`. Create disposable accounts for locking/duplicates; never include passwords or full session tokens in submitted screenshots. Use separate browser profiles/private windows for each role. Record app version/commit, browser, tester and actual test date.

## Criteria and test coverage

| AC ID | Acceptance criterion | Manual verification | Result |
| --- | --- | --- | --- |
| AC-01.1 | Given a visitor on `/register`, when valid name, unique email and password of at least 8 characters are submitted, a Customer is persisted and the visitor is redirected to `/login`. | Register a unique address; log in; inspect account role; reload and log in again. | Not Run |
| AC-01.2 | Given an existing email, registration rejects a duplicate with “Email is already registered”. | Register twice; repeat with different email capitalization. | Not Run |
| AC-01.3 | A 7-character registration password is rejected by client and server. | Submit 7 characters in browser; separately bypass native validation with an HTTP client and a valid CSRF token. Confirm no account; verify 8 characters accepted. | Not Run |
| AC-01.4 | Passwords are stored as irreversible bcrypt hashes, never plaintext. | Inspect a disposable account in local DB without exposing actual credentials; compare bcrypt hash with input using bcrypt. | Not Run |
| AC-02.1 | Active Customer/Administrator credentials create a session and open the corresponding account/admin page. | Log in as each role in separate browser windows. | Not Run |
| AC-02.2 | Unknown email or wrong password shows “Invalid email or password” and grants no session. | Test both cases; directly open a protected page afterward. | Not Run |
| AC-02.3 | A locked account cannot log in and sees “Your account has been locked”. | Lock a disposable Customer with Admin, then attempt correct login; also verify a pre-existing Customer session loses access. | Not Run |
| AC-02.4 | Blank email/password is rejected on client and server. | Test each missing field in browser and by HTTP client. | Not Run |
| AC-03.1 | Logout invalidates the session, clears the cookie and returns to public home. | Log out; attempt `/account`; confirm a captured disposable session cannot be reused. | Not Run |
| AC-03.2 | After logout, browser Back cannot restore an accessible authenticated page. | Log out from account page, use Back, reload and attempt protected actions; inspect no-store headers. | Not Run |
| AC-03.3 | After logout, header immediately displays Log in/Create account instead of the name/logout controls. | Observe home after logout. | Not Run |
| AC-04.1 | Admin creates valid accounts with Administrator or Customer role and hashed passwords. | Create each role; log in with each; inspect role and hash. | Not Run |
| AC-04.2 | Admin can lock/unlock another Customer and locked users cannot log in. | Lock, observe status, test blocked login; unlock and test login again. Old sessions remain revoked. | Not Run |
| AC-04.3 | Admin cannot lock their own account, including by direct POST. | Confirm own row has no Lock button; send self-lock HTTP request as Admin and expect 422. | Not Run |
| AC-04.4 | Admin-created duplicate email is rejected server-side with a clear message. | Reuse a seed email in Create account; repeat with different capitalization. | Not Run |
| AC-05.1 | Administrator can open implemented management pages and actions. | Open `/admin/users`, create/lock/unlock; inspect `/api/admin/users`. | Not Run |
| AC-05.2 | Customer cannot access admin pages or read/write management APIs. | Enter `/admin/users`, `/admin/books`; expect 403. Direct GET/POST to `/api/admin/users` must fail. | Not Run |
| AC-05.3 | Guest admin page requests redirect to `/login`; guest management API requests return 401 without private data. | Logged out, request HTML route; separately request API read/write with valid anonymous CSRF for the write. | Not Run |
| AC-05.4 | Database and middleware enforce distinct Administrator/Customer roles. | Verify both roles; public registration cannot assign Admin; invalid role rejected by admin API and DB constraint. | Not Run |

## Additional checks

- Desktop 1280px, tablet 768px, mobile 360px; keyboard navigation and readable validation messages.
- Browser Show/Hide password control; minimum-length, email format, required fields and maximum UTF-8 byte rule.
- Blank/overlong name, invalid email, missing role, password over 72 UTF-8 bytes; user input escapes HTML.
- Writes without signed CSRF token fail. Cookies HttpOnly/SameSite, and Secure on HTTPS deployment.
- Repeated failed logins trigger throttling; expired sessions cannot access protected pages.
- Account data remains after local server restart. Verify PostgreSQL persistence separately after provisioning.

## Evidence record format

For each execution record: `Test ID | AC ID | Preconditions | Steps | Test data description | Expected | Actual | Pass/Fail/Not Run | Tester | Date | Commit | Evidence path | Bug ID`.

One AC can require multiple cases (e.g. two roles, HTML/API, client/server). Do not force a one-to-one test count. If a failure is found, record exact steps/expected/actual, assign it to Ha, and retest the same case after the fix. Keep original failure evidence.

## Completion gate

Developer checks are not member evaluation, independent QA, Sponsor approval or UAT. Stories are ready for PO acceptance only after the relevant manual checks, peer review and evidence are complete. Do not backfill a historical Daily log or mark the Sprint complete from this document alone.
