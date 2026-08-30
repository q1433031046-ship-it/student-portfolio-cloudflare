# Administrator Network Throttle Implementation Plan

> **For implementation:** Execute this plan task-by-task with the workflow available in the current environment. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the global administrator credential lock with a bounded per-Cloudflare-client-network password throttle while keeping recovery-code rotation available and concurrency-safe.

**Architecture:** Password login derives one of 4,096 irreversible bucket identifiers from the trusted `cf-connecting-ip` value (or the fixed `unknown` fallback) and the current password verifier. D1 owns the atomic failure counter and lock lease; credential rotation clears all buckets in the same guarded batch, while recovery failures never mutate password throttle state.

**Tech Stack:** TypeScript, Cloudflare Workers Request metadata, D1/SQLite, Drizzle schema snapshots, Node test runner.

**Spec:** `docs/plans/2026-08-30-latest-version-convergence.md`

## Global Constraints

- Never persist a raw client IP or a reversible derivative.
- The bucket key space is fixed at 4,096 values so unauthenticated traffic cannot create an unbounded D1 table.
- Five wrong passwords lock only that bucket for 15 minutes; other buckets remain usable.
- A correct recovery code works while any password bucket is locked, rotates the password/recovery verifier, revokes old sessions, clears all password buckets, and creates exactly one new session.
- Wrong recovery codes do not increment or lock password buckets.
- A stale password verification cannot create a session or mutate the new credential generation after recovery wins.
- Extend the unreleased, idempotent `0007_legacy_media_and_access_state.sql`; do not add migration `0008`.

---

### Task 1: Authentication regression tests

**Files:**
- Modify: `tests/auth-v2.test.mjs`

**Interfaces:**
- Consumes: `POST /api/admin/login`, `POST /api/admin/recover`, trusted request header `cf-connecting-ip`.
- Produces: deterministic assertions for `admin_login_throttle(bucket_key, failed_attempts, locked_until, updated_at)`.

- [ ] **Step 1: Replace the global-lock concurrency assertion**

Use twenty concurrent wrong-password requests from `203.0.113.10`, assert only `401`/`429`, assert exactly one bounded bucket row with a future `locked_until`, then assert the correct password is `429` from that network.

- [ ] **Step 2: Add network isolation**

Send the correct password from `198.51.100.20` after the first network is locked and assert `200`; assert the locked network remains `429` until its own bucket is cleared or expires.

- [ ] **Step 3: Add recovery independence**

Lock one password bucket, submit the correct recovery code from that same network, assert `200`, assert the throttle table is empty, and assert the rotated password logs in. Submit repeated wrong recovery codes in a separate case and assert the password throttle table remains empty and the correct password still logs in.

- [ ] **Step 4: Preserve credential-rotation interleavings**

Gate the failure upsert, let recovery rotate first, release the stale failure, and assert no old-generation bucket row is written. Keep the existing old-password/session CAS test and update its SQL predicate only as needed.

- [ ] **Step 5: Run the failing test**

Run: `node --experimental-strip-types --test tests/auth-v2.test.mjs`

Expected: the old global-lock implementation fails network isolation and recovery-independence assertions.

---

### Task 2: Bounded D1 password throttle

**Files:**
- Modify: `app/api/_lib/admin-auth.ts`

**Interfaces:**
- Produces: runtime-idempotent `ensureAdminLoginThrottleTable()`, finite `loginNetworkBucketKey(request, passwordHash)`, atomic `recordPasswordFailure(...)`, bucket precheck and guarded bucket cleanup.

- [ ] **Step 1: Add the runtime table contract**

Create `admin_login_throttle` with `bucket_key` primary key, integer `failed_attempts`, nullable `locked_until`, and `updated_at`, plus an idempotent index on `locked_until`.

- [ ] **Step 2: Derive a non-identifying finite key**

Hash `admin-login-throttle\nv1\n${passwordHash}\n${network}` with SHA-256, use only the low 12 bits, and serialize `b1-000` through `b1-fff`. Normalize a missing/empty trusted header to `unknown`; never persist the source string.

- [ ] **Step 3: Atomically record failures**

Use one `INSERT ... SELECT ... ON CONFLICT DO UPDATE` guarded by the current password hash and salt. Concurrent failures increment one row; the fifth atomically sets a 15-minute lease; a stale failure after rotation changes zero rows.

- [ ] **Step 4: Make login bucket-scoped**

Read and enforce only the derived bucket before PBKDF2. On a valid password, keep the credential hash/salt CAS and session insert, and delete the current bucket only when that credential generation still matches.

- [ ] **Step 5: Make recovery independent**

Remove the password lock precheck and password-failure write from recovery. Add a credential-generation-guarded `DELETE FROM admin_login_throttle` to the successful recovery batch.

- [ ] **Step 6: Run the authentication tests**

Run: `node --experimental-strip-types --test tests/auth-v2.test.mjs`

Expected: all authentication tests pass, including concurrency and rotation races.

---

### Task 3: Forward migration and Drizzle metadata

**Files:**
- Modify: `db/schema.ts`
- Modify: `drizzle/0007_legacy_media_and_access_state.sql`
- Modify: `drizzle/meta/0007_snapshot.json`
- Verify: `drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: the exact runtime table/index contract from Task 2.
- Produces: idempotent deployment DDL and a snapshot matching `db/schema.ts`.

- [ ] **Step 1: Add the Drizzle table**

Define `adminLoginThrottle` with the same four columns, primary key, defaults, and `admin_login_throttle_locked_until_idx`.

- [ ] **Step 2: Extend migration 0007**

Append only `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`; retain all existing legacy-media and access-state DDL byte-for-byte.

- [ ] **Step 3: Update the existing 0007 snapshot**

Add the table and index entry without creating a new journal migration.

- [ ] **Step 4: Calculate the release digest**

Run: `sha256sum drizzle/0007_legacy_media_and_access_state.sql`

Expected: one new digest to propagate to the deployment manifest and tests.

---

### Task 4: User guidance and release contract

**Files:**
- Modify through assigned documentation agents: `README.md`
- Modify through assigned documentation agents: `AGENTS.md`
- Modify through assigned documentation agents: `app/admin/admin-guide-center.tsx`
- Modify through assigned release agent: `deployment/agent-manifest.json`
- Update associated release/tutorial tests selected by those agents.

**Interfaces:**
- Consumes: final migration SHA-256 and behavior verified by Tasks 1–3.
- Produces: one consistent statement: five wrong passwords lock the same Cloudflare client network for 15 minutes; another network and the system recovery code remain available.

- [ ] **Step 1: Deliver exact behavior and digest to the assigned agents**

State that raw IP addresses are not stored, recovery failures do not lock password login, password rotation clears all buckets, and migration remains `0007`.

- [ ] **Step 2: Read back every changed surface**

Verify README, AGENTS, administrator guide, manifest allowlist/hash, and tutorial/release assertions all describe the same accepted behavior.

---

### Task 5: Verification and final read-only audit

**Files:**
- Verify all task-owned and agent-updated files.

**Interfaces:**
- Consumes: completed Tasks 1–4.
- Produces: evidence-backed release decision for the administrator authentication surface.

- [ ] **Step 1: Run focused security tests**

Run: `node --experimental-strip-types --test tests/auth-v2.test.mjs tests/owner-onboarding.test.mjs tests/agent-deployment-package.test.mjs tests/tutorial-ui-audit.test.mjs`

Expected: all selected tests pass.

- [ ] **Step 2: Run static checks**

Run: `npm exec tsc -- --noEmit`

Run: `npm run lint`

Run: `git diff --check`

Expected: zero TypeScript errors, zero lint errors, and no whitespace errors.

- [ ] **Step 3: Re-read concurrency invariants**

Confirm a stale wrong password cannot write after rotation, a stale correct password cannot create a session after rotation, concurrent failures yield one atomic lease, recovery is never gated by password buckets, and successful login clears only its matching current-generation bucket.
