# v1.3.0 GitHub → Cloudflare Workers Builds Upgrade Bridge Specification

## Purpose

Provide a fail-closed upgrade path for an already deployed student portfolio when the student-side ChatGPT / Work environment can update GitHub but cannot use Wrangler against the Cloudflare API. The Git push is only the trigger; the connected Cloudflare Workers Builds job performs the verified build, D1 migration, and deployment to the same existing Worker.

## Frozen product payload

- Product version: `1.3.0`.
- Immutable release tag: `v1.3.0`.
- Product source commit: `4658bc834d6ea21aa94ce0db0d9c99e82b856235`.
- Product source tree: `2d9bc4a77dc96bbc75aa85ed5bdca13c9823ea54`.
- The bridge may add deployment control, tests, and documentation, but may not modify the v1.3.0 application, Worker runtime, database schema, or migration payload.

## Eligibility and identity

- The target must already exist as the Worker connected to the current Cloudflare Workers Builds project.
- The build token selected by Workers Builds must grant Account `Workers Scripts:Edit` and Account `D1:Edit`. Cloudflare's automatically created Workers Builds token does not currently include `D1:Edit`, so the owner must add that permission to the selected token in Cloudflare before the upgrade trigger. The token value stays inside Cloudflare and is never copied into chat or the repository.
- `WRANGLER_CI_OVERRIDE_NAME` must be present and valid; it is the only effective Worker name for every remote operation.
- The retained site configuration must contain exactly one `DB` D1 binding with a non-empty `database_id`, exactly one `MEDIA_KV` binding with a non-empty `id`, exactly one `ASSETS` binding, and at most one existing `BUCKET` R2 binding.
- The bridge accepts no other local resource-binding field. Every active Worker version must expose only the modeled binding types and must have the same complete binding inventory and per-binding digest.
- The live `DB` and `MEDIA_KV` IDs must exactly match the retained site configuration.
- A missing Worker, missing fixed resource ID, mismatched live binding, inconsistent active version, or unprovable remote state is a blocking result. The bridge never creates or adopts a Worker, D1 database, KV namespace, or R2 bucket.

## Ordered transaction

1. Verify the bridge contract, v1.3.0 product payload digest, package/runtime dependency and build-command digest, migration journal, non-empty client assets, and the server bundle before any remote mutation.
2. Read the existing Worker deployment and all active versions, then capture an in-memory resource fingerprint without logging values or credentials.
3. Run `wrangler d1 migrations list DB --remote` and require a complete parse.
4. Permit only an empty pending set or an ordered suffix of `0006_auth_v2.sql`, `0007_legacy_media_and_access_state.sql`. Any pending migration from `0000` through `0005`, any unknown file, duplicate, reordered set, or changed file digest blocks the run.
5. Apply pending migrations once. Any non-zero result blocks the run and deployment; there is no runtime-bootstrap or deploy-before-migration fallback.
6. List migrations again and require an empty pending set. A partial application or ambiguous result blocks deployment.
7. Re-read and strictly compare the existing Worker fingerprint immediately before deployment.
8. Create an ephemeral Wrangler configuration beside the retained config, remove the complete `vars` object, set `keep_vars: true`, preserve the existing fixed bindings, and deploy to the same effective Worker name with `--keep-vars --strict --experimental-provision=false --experimental-auto-create=false --autoconfig=false`. Always remove the ephemeral file.
9. Re-read all active versions after deployment and require the same complete binding inventory and per-binding digest as the pre-deploy fingerprint before reporting success.

## Migration compatibility

- Supported legacy database state: migrations `0000` through `0005` already applied.
- Retry-compatible intermediate state: `0006` applied and only `0007` pending.
- Already-upgraded state: no pending migration.
- `0006_auth_v2.sql` SHA-256: `edee5672e5b8281ec495cf5f9d34db7df4311f51dfcb6136c9bdfe127d815ad4`.
- `0007_legacy_media_and_access_state.sql` SHA-256: `c29e080e93d8fa71378c43d7afdbcef97a591e434dca092af84741428acd9a1e`.

## Secrets and logs

- The chat-side workflow never requests a Cloudflare token, cookie, administrator password, initial administrator code, or recovery code.
- The bridge consumes only the Cloudflare Workers Builds authentication already supplied to Wrangler by the platform.
- A missing `D1:Edit` permission is reported as a failed migration gate and cannot reach Worker deployment or success output.
- Raw remote variable values are used only in memory to compute SHA-256 fingerprints and are never printed or persisted.
- Secret values are never read. Only Secret binding names are compared.
- D1/KV/R2/other resource identifiers are never interpolated into bridge errors. Successful Wrangler apply/deploy output is not echoed; failure output is redacted before logging.
- Logs use explicit `[BRIDGE][CHECK]`, `[BRIDGE][BLOCKED]`, `[BRIDGE][FAILED]`, and `[BRIDGE][SUCCESS]` outcomes. Success is emitted only after post-deploy verification.

## Parallel student repositories

- The bridge has no shared repository, account, Worker, D1, or KV identifier.
- Each repository keeps its own fixed resource IDs and receives its own Cloudflare-provided Worker override and build credentials.
- Temporary configuration names are process-unique and are removed in `finally`, so unrelated student builds do not share state.

## Candidate boundary

- Work only on branch `emergency/v1.3.0-workers-builds-upgrade-bridge` in its isolated worktree.
- Do not modify, overwrite, or use the 3A governance Candidate, its branch, or `governance-state`.
- Do not merge `main`, move `v1.3.0`, create a release, or deploy any production site.
- Validate a real legacy repository structure non-destructively using the historical source snapshot that contains fixed DB/KV IDs and migrations `0000`–`0005`; redact all resource identifiers from test output and evidence.

## Acceptance

- Bridge-specific positive, retry, already-current, identity-mismatch, list-failure, unknown-migration, changed-migration, apply-failure, partial-apply, missing-Worker, missing-build-identity, variable-preservation, Secret-preservation, and post-deploy-drift tests pass.
- The real legacy structure compatibility test performs no network access and no remote mutation.
- Complete repository tests, production build, ESLint, TypeScript, migration drift, shell/Node syntax, dependency audit, Wrangler dry-run, and whitespace checks pass.
- Candidate report includes changed files, risks, exact Candidate commit SHA, exact tree SHA, branch, and an explicit statement that no merge, tag mutation, or production deployment occurred.
