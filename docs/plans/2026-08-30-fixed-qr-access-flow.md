# Fixed QR Access Flow Implementation Plan

> **For implementation:** Execute this plan task-by-task with the workflow available in the current environment. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-redeeming QR landing page and fixed 24-hour visitor access sessions without changing administrator sessions or production resources.

**Architecture:** Keep signed QR tokens and the existing D1 access-pass rows. Split the current redeeming `GET /access` route into a read-only server page and a same-origin `POST /access/redeem` handler; keep redemption atomic in `portfolio-access.ts` and reuse the signed Cookie without rotating its expiry.

**Tech Stack:** TypeScript, React Server Components, Next/Vinext route handlers, Cloudflare Workers, D1, Node test runner, SQLite test adapter.

**Spec:** `docs/specs/2026-08-30-qr-access-flow.md`

## Global Constraints

- QR visitor sessions are fixed at exactly 24 hours and never slide.
- Administrator sessions remain exactly 12 hours.
- A pass expiry earlier than 24 hours clamps the visitor session expiry.
- An exhausted pass blocks only new redemptions; paused, deleted, or expired passes revoke existing sessions.
- No D1 migration, binding change, Worker replacement, R2, paid service, or mobile-adaptation work is allowed.
- Existing Worker, `workers.dev`, D1, `MEDIA_KV`, Secrets, resource IDs, administrators, media, content, access passes, analytics, and audit data must be preserved.

---

### Task 1: Fixed visitor session and repeat-redemption contract

**Files:**
- Modify: `tests/portfolio-access.test.mjs`
- Modify: `app/api/_lib/portfolio-access.ts`

**Interfaces:**
- Produces: `ACCESS_SESSION_SECONDS = 86_400`.
- Produces: `calculateAccessSessionExpiry(nowSeconds: number, passExpiresAt: string | null): number`.
- Produces: `inspectAccessPassToken(token: string): Promise<AccessPassInspection>`.
- Changes: `redeemAccessPass(request: Request, token: string, now?: Date)` returns `reused: boolean` with the existing `ok`, `cookie`, and `pass` fields.

- [x] **Step 1: Write failing fixed-expiry and D1 redemption tests**

```js
assert.equal(calculateAccessSessionExpiry(1_000, null), 87_400);
assert.equal(calculateAccessSessionExpiry(1_000, "1970-01-01T12:00:00.000Z"), 43_200);
assert.equal(first.reused, false);
assert.equal(repeated.reused, true);
assert.equal(readUsedCount(database, passId), 1);
```

- [x] **Step 2: Run the focused test and confirm it fails**

Run: `node --experimental-strip-types --test tests/portfolio-access.test.mjs`

Expected: FAIL because the 24-hour constant, expiry helper, inspection result, and `reused` result do not exist.

- [x] **Step 3: Implement the minimal access-domain changes**

```ts
export const ACCESS_SESSION_SECONDS = 24 * 60 * 60;

export function calculateAccessSessionExpiry(nowSeconds: number, passExpiresAt: string | null) {
  const passExpiry = passExpiresAt
    ? Math.floor(new Date(passExpiresAt).getTime() / 1000)
    : Number.POSITIVE_INFINITY;
  return Math.min(nowSeconds + ACCESS_SESSION_SECONDS, passExpiry);
}
```

Use the injected `now` for SQL timestamps and session verification. Return the existing Cookie with its original `expiresAt` when the same browser already has a valid session for the same pass; only the atomic D1 update may create a new session.

- [x] **Step 4: Run the focused test and confirm it passes**

Run: `node --experimental-strip-types --test tests/portfolio-access.test.mjs`

Expected: PASS, including one-use repeat redemption, exhausted-new-browser rejection, and paused-session revocation.

---

### Task 2: Non-redeeming `/access` page and POST redemption

**Files:**
- Delete: `app/access/route.ts`
- Create: `app/access/page.tsx`
- Create: `app/access/access-actions.tsx`
- Create: `app/access/access-page.module.css`
- Create: `app/access/redeem/route.ts`
- Modify: `tests/portfolio-access.test.mjs`

**Interfaces:**
- Consumes: `inspectAccessPassToken`, `checkPortfolioAccess`, and `redeemAccessPass` from `app/api/_lib/portfolio-access.ts`.
- Consumes: form field `key` from a same-origin `application/x-www-form-urlencoded` POST.
- Produces: `GET /access?key=...` as a read-only confirmation page.
- Produces: `POST /access/redeem` as the only usage-count mutation path.

- [x] **Step 1: Add failing route-structure tests**

```js
assert.match(accessPage, /action="\/access\/redeem"/u);
assert.doesNotMatch(accessPage, /redeemAccessPass/u);
assert.match(redeemRoute, /export async function POST/u);
assert.doesNotMatch(redeemRoute, /export async function GET/u);
assert.match(redeemRoute, /status: 303/u);
```

- [x] **Step 2: Run the focused test and confirm it fails**

Run: `node --experimental-strip-types --test tests/portfolio-access.test.mjs`

Expected: FAIL because `/access` is still a redeeming GET route.

- [x] **Step 3: Implement the page and route**

The page must render these exact rules:

```text
打开此确认页不会扣除次数。
点击“打开作品集”后计为 1 次成功使用。
当前浏览器随后保持 24 小时访问；重复打开不扣次数，也不会延长到期时间。
```

The POST handler must reject a mismatched `Origin`, bodies larger than 2 KiB, non-form content types, and tokens outside 20–300 characters. It must redirect only to `/` or `/access`, use `303`, and set `Cache-Control: no-store` plus `Referrer-Policy: no-referrer`.

```ts
export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) return accessRedirect(requestUrl, "", "二维码无效");
  const rawBody = await request.text();
  if (rawBody.length > 2_048) return accessRedirect(requestUrl, "", "二维码无效");
  const token = new URLSearchParams(rawBody).get("key") ?? "";
  const result = await redeemAccessPass(request, token);
  return result.ok ? homeRedirect(requestUrl, result.cookie) : accessRedirect(requestUrl, token, result.reason);
}
```

- [x] **Step 4: Run the focused test and build**

Run: `node --experimental-strip-types --test tests/portfolio-access.test.mjs && npm run build`

Expected: PASS and the route table contains `ƒ /access` plus `λ /access/redeem`.

---

### Task 3: Gate, administrator copy, documentation, and release metadata

**Files:**
- Modify: `app/portfolio/access-gate.tsx`
- Modify: `app/admin/access-manager.tsx`
- Modify: `app/admin/admin-client.tsx`
- Modify: `app/admin/admin-guide-center.tsx`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `deployment/agent-manifest.json`
- Modify: `deployment/template-version.json`
- Modify: `deployment/upgrade-prompt.json`
- Modify: `tests/agent-deployment-package.test.mjs`
- Modify: `tests/tutorial-ui-audit.test.mjs`
- Modify: `tests/update-notifier.test.mjs`

**Interfaces:**
- Consumes: the Task 1 fixed-session and Task 2 confirmation-page behavior.
- Produces: release v1.1.5 with `template-version.json.version === upgrade-prompt.json.promptVersion`.

- [x] **Step 1: Add failing copy and metadata tests**

```js
assert.match(accessManager, /固定 24 小时/u);
assert.match(accessManager, /不会延长/u);
assert.match(accessGate, /此作品集已开启限制访问/u);
assert.match(adminClient, /请输入你的姓名/u);
assert.match(adminClient, /label: "联系方式"/u);
assert.equal(version.version, "1.1.5");
assert.equal(prompt.promptVersion, version.version);
```

- [x] **Step 2: Run the focused tests and confirm they fail**

Run: `node --experimental-strip-types --test tests/portfolio-access.test.mjs tests/agent-deployment-package.test.mjs tests/tutorial-ui-audit.test.mjs tests/update-notifier.test.mjs`

Expected: FAIL on the old copy and v1.1.4 metadata.

- [x] **Step 3: Update copy, canonical guides, manifests, and prompt version**

Keep “管理员密码登录 12 小时” separate from “二维码访客固定 24 小时”. Document that no migration is required and that mobile adaptation is deferred to a later release.

```json
{
  "version": "1.1.5",
  "releaseNotes": [
    "二维码先进入确认页，只有点击打开作品集才会计入一次成功使用。",
    "成功进入后当前浏览器获得固定 24 小时访问，会话不会因刷新或重复扫码而续期或重复扣次数。",
    "二维码耗尽只阻止新兑换；暂停、删除或到期会立即撤销关联访问会话。"
  ]
}
```

- [x] **Step 4: Run the complete verification suite**

Run:

```bash
npm test
npm run lint
npx tsc --noEmit
git diff --check
```

Expected: every command exits 0; no Wrangler binding, D1 ID, KV ID, migration, or mobile-layout file changes are present.

---

### Task 4: Publish and verify v1.1.5

**Files:**
- Verify only: all files changed in Tasks 1–3.

**Interfaces:**
- Consumes: a locally verified Git tree.
- Produces: a reviewed and deployed `main` commit for v1.1.5.

- [x] **Step 1: Commit the verified tree**

```bash
git add AGENTS.md README.md app/access/page.tsx app/access/access-actions.tsx app/access/access-page.module.css app/access/redeem/route.ts app/admin/access-manager.tsx app/admin/admin-client.tsx app/admin/admin-guide-center.tsx app/api/_lib/portfolio-access.ts app/portfolio/access-gate.tsx deployment/agent-manifest.json deployment/template-version.json deployment/upgrade-prompt.json docs/specs/2026-08-30-qr-access-flow.md docs/plans/2026-08-30-fixed-qr-access-flow.md tests/agent-deployment-package.test.mjs tests/portfolio-access.test.mjs tests/tutorial-ui-audit.test.mjs tests/update-notifier.test.mjs
git commit -m "Release v1.1.5 fixed QR access flow"
```

- [ ] **Step 2: Publish a release branch and open a pull request**

Create the remote branch from the current verified `main`, ensure its tree SHA equals the local commit tree, and open a PR describing the 24-hour fixed session, non-redeeming intermediate page, repeat-use protection, unchanged resources, and mobile deferral.

- [ ] **Step 3: Merge only after all PR checks pass**

Expected: `Workers Builds: student-portfolio` and `verify-key-areas` both complete with `success`.

- [ ] **Step 4: Verify production**

Expected: the merged `main` commit reports successful `Workers Builds: student-portfolio`, `verify-key-areas`, and `full-verify`; canonical version and prompt manifests both report `1.1.5`.
