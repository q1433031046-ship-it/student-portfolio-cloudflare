# v1.2.1 Latest-Version Convergence Record

> Status at source freeze: the local release candidate has passed every reproducible release gate. Remote PR, main-branch verification, immutable tag creation, and production-only acceptance remain separate evidence gates.

## Goal and release boundary

Converge the released v1.2.0 tree into v1.2.1 without changing the existing Worker, D1, KV, Secrets, administrator identity, media, drafts, published content, QR records, analytics, or audit logs.

This release remains desktop-first. Mobile-specific layout adaptation is deferred. A pre-existing `BUCKET` binding may remain only while legacy R2 media is being copied into an already configured `MEDIA_KV`; new sites and upgrades must not create or guess storage resources.

The archived schema-1 draft video is retained as an administrator-readable private document archive reference. It is excluded from public documents, preview, playback, and the active editor.

## Completed convergence work

### 1. Administrator authentication and upload authorization

- [x] Decoupled v2 passwords, sessions, and recovery from `INITIAL_ADMIN_CODE`; that secret is used only for first setup and legacy confirmation.
- [x] Added `admin_login_throttle` in the forward migration and runtime bootstrap.
- [x] Made wrong-password throttling atomic and scoped to a keyed Cloudflare client-network bucket; raw client IP addresses are not stored.
- [x] Made recovery rotation compare-and-swap so one recovery code has exactly one concurrent winner.
- [x] Ensured correct recovery bypasses password throttles, clears all old throttle buckets, rotates recovery state, and revokes old administrator sessions.
- [x] Prevented an in-flight old password from creating a session after recovery rotation.
- [x] Restricted `UPLOAD_API_TOKEN` to media upload authorization only.

Primary evidence: `tests/auth-v2.test.mjs`, `tests/upload-token-authorization.test.mjs`.

### 2. QR access state machine

- [x] Added generation-bound visitor sessions with backward-compatible generation-one cookies.
- [x] Made pause, delete, and expiry tightening invalidate previously issued visitor sessions.
- [x] Kept visitor sessions fixed at 24 hours and non-sliding, while clamping them to pass expiry.
- [x] Made public mode open directly without consuming a pass or issuing a restricted-session cookie.
- [x] Allowed a fail-closed restricted state with zero usable passes and surfaced an administrator warning.
- [x] Made partial pass updates preserve omitted fields and protected redeem/policy races with atomic database transitions.

Primary evidence: `tests/portfolio-access.test.mjs`.

### 3. Media, quota, cleanup, and legacy preservation

- [x] Required `MEDIA_KV` for every new upload and kept the 50 MiB limit for new videos.
- [x] Preserved legacy 50–90 MiB videos and schema-1 hero media without exposing archived draft video publicly.
- [x] Made capacity reservation atomic; replacement credit is granted only for the exact editable draft slot.
- [x] Added immutable 4 MiB upload chunks, finalization leases, seven-day expiry, reclaim, and idempotent completion/cleanup.
- [x] Prevented cleanup starvation beyond 1,000 referenced rows and rejected draft references to non-uploaded/deleted media.
- [x] Added resumable R2-to-KV copying in `app/api/admin/storage/migrate/route.ts` with pinned source ETag, per-chunk byte/SHA-256 verification, a final full KV reread, and compare-and-swap backend switching.
- [x] Kept all legacy R2 source objects intact.
- [x] Added the idempotent forward migration `drizzle/0007_legacy_media_and_access_state.sql` and synchronized Drizzle metadata.

Primary evidence: `tests/legacy-media-migration.test.mjs`, `tests/media-cleanup.test.mjs`, `tests/upload-token-authorization.test.mjs`, `tests/portfolio-model.test.mjs`.

### 4. Desktop portfolio and Chinese interaction surfaces

- [x] Made final video optional; absent video publishes with `00:00` and no public play control.
- [x] Hid whitespace-only optional hero and contact content.
- [x] Guarded uploads for unsaved projects/categories and copied unsaved end covers without claiming the source media key.
- [x] Kept independent end covers editable, sortable, uploadable, and rendered before the footer.
- [x] Added stable validation locations and Chinese normalization for user-visible network/media errors.
- [x] Kept IME composition and multiline Enter behavior correct in inline editors.
- [x] Changed access-revocation navigation to a full-page history-replacing redirect and cleared the final lint warning.

Primary evidence: `tests/desktop-convergence.test.mjs`, `tests/admin-regressions.test.mjs`, `tests/rendered-html.test.mjs`, `tests/inline-editing.test.mjs`.

### 5. Fail-closed deployment and resource identity

- [x] Added strict before/after target fingerprints covering the effective Worker name, every active-version binding, D1/KV/R2 identities, secret names, `workers_dev`, and hashed runtime variables.
- [x] Applied `WRANGLER_CI_OVERRIDE_NAME` consistently to status, version inspection, fingerprinting, and final deployment.
- [x] Made D1 migration-list failure stop by default; the only fallback is a known pending runtime-safe, create-only migration whose digest matches the release manifest.
- [x] Removed fixed D1 names and all D1/KV resource IDs from the public template so independent sites cannot silently reuse resources.
- [x] Limited first deployment to a platform-provisioned Deploy Button working copy with independently injected binding IDs.
- [x] Required existing sites to supply a fixed, live-matching D1/KV fingerprint; pure R2-only v1.0 sites stop before any remote mutation.
- [x] Removed non-executable alternate first-deploy paths and kept one tested deployment contract.

Primary evidence: `tests/cloudflare-deploy-script.test.mjs`, `tests/cloudflare-build-config.test.mjs`, `tests/agent-deployment-package.test.mjs`.

### 6. Tutorial and upgrade clarity

- [x] Kept one eight-step student flow in README and the authenticated administrator guide, using the actual UI labels.
- [x] Separated first deployment, existing-site upgrade, and the conditional legacy-R2 migration branch.
- [x] Explained that screenshots must not contain secrets or recovery codes.
- [x] Required the original branch/commit to be recorded and local edits to be clean or saved recoverably before upgrade; no force/reset operation is part of the procedure.
- [x] Required an isolated checkout of the immutable v1.2.1 tag and exact restoration of the original site configuration.
- [x] Required the cloned template's platform-injected D1/KV IDs to be verified before upgrade preparation; no resource name or ID may be guessed.
- [x] Explained recovery/session rotation, the newly named recovery file, fixed QR sessions, ten independent-cookie-session testing, and manual mainland-network checks truthfully.
- [x] Kept the README copy block byte-identical to `deployment/upgrade-prompt.json.prompt` and synchronized the prompt digest across release metadata.

Primary evidence: `tests/tutorial-ui-audit.test.mjs`, `tests/update-notifier.test.mjs`, `tests/agent-deployment-package.test.mjs`.

## Reproducible release gates

| Gate | Result at source freeze |
|---|---|
| Clean install | Passed |
| Build and complete test suite | 180/180 passed |
| ESLint | Passed, 0 errors and 0 warnings |
| TypeScript `--noEmit` | Passed |
| Production dependency audit | 0 vulnerabilities |
| Shell and Node script syntax | Passed |
| Wrangler deploy dry-run | Passed with D1, KV, assets, and runtime-var bindings |
| Drizzle generation drift | No schema changes; no new migration |
| Git whitespace check | Passed |
| Upgrade prompt SHA-256 | `8e0a389a1a6c38a833c39ee6ed1b9c18690e067e83d42cc9e8d810d2219ec2dc` |
| Migration 0007 SHA-256 | `c29e080e93d8fa71378c43d7afdbcef97a591e434dca092af84741428acd9a1e` |

The full development dependency audit still reports advisories in build-only transitive packages under Vinext and Drizzle Kit. The production dependency tree is clean. The audit-proposed forced changes cross toolchain compatibility boundaries, so they are deferred to a dedicated framework/toolchain validation cycle instead of being mixed into this release.

## Remote and production evidence gates

- [ ] Create the v1.2.1 release PR from this exact source snapshot and wait for the complete PR workflow to pass.
- [ ] Merge only the verified head and confirm both main-branch release workflows pass.
- [ ] Confirm annotated tag `v1.2.1` peels to the verified merged commit and read back the tagged manifests/digests.
- [ ] On a second Cloudflare site, confirm Deploy Button injects independent D1/KV IDs and writes them into the cloned configuration.
- [ ] Compare the real production resource fingerprint and verify the actual D1/R2 migration inventory.
- [ ] Run ten independent live browser sessions and manual mainland-network playback checks.

No production deployment, live resource mutation, live data migration, or manual network acceptance may be reported complete without direct evidence.
