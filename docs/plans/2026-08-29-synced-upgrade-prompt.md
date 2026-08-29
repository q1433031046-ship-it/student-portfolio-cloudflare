# Synchronized Upgrade Prompt Implementation Plan

## Goal

Make the upgrade instructions a versioned, machine-readable source of truth that every upgraded student site refreshes during its normal version check. All administrator copy actions must use the latest validated prompt and fall back to the bundled safe prompt when GitHub cannot be reached.

## Scope and safety constraints

- Preserve the existing Worker, `workers.dev` hostname, D1 database, `MEDIA_KV`, Secrets, runtime variables, administrator state, media, drafts, published content, access passes, analytics, and audit records.
- Do not create or bind Worker, D1, KV, or R2 resources.
- Do not change database schemas or Cloudflare bindings for this release.
- Accept a remote prompt only when its schema, program identity, version, and content bounds are valid.
- Keep a bundled prompt available so copying still works offline or if the canonical response is malformed.

## Implementation

1. Add `deployment/upgrade-prompt.json` as the canonical prompt manifest with schema version, program identity, prompt version, and the complete upgrade instruction.
2. Update `deployment/template-version.json` to v1.1.4 and declare the prompt manifest path.
3. Refactor `app/admin/admin-upgrade-content.ts` to import the bundled manifest and expose a getter, validated synchronizer, sync event, prompt version, and local fallback.
4. Extend `app/api/version/route.ts` to fetch the canonical version and prompt manifests, validate both against the installed program identity, and return the canonical prompt or the bundled fallback with explicit synchronization status.
5. Update `app/admin/admin-update-notifier.tsx` to install the validated prompt returned by the version endpoint and display whether the instruction is synchronized or using its local fallback.
6. Update `app/admin/admin-upgrade-center.tsx`, `app/admin/admin-guide-center.tsx`, and `app/admin/admin-interaction-enhancements.tsx` so every visible or copied instruction comes from the synchronized getter.
7. Update `README.md` to explain automatic prompt synchronization, keep its displayed prompt identical to the manifest, and document the new machine-readable file.
8. Strengthen `tests/update-notifier.test.mjs` to verify manifest identity, endpoint validation and fallback behavior, all copy entry points, synchronization UI, and byte-for-byte README prompt parity.

## Verification

Run from the repository root:

```bash
npm test
npm run lint
npx tsc --noEmit
git diff --check
```

Expected result: every command exits with status 0; the test suite confirms v1.1.4, remote prompt validation, local fallback, shared copy behavior, and README parity.

## Release

Commit as `Release v1.1.4 synchronized upgrade prompts`, publish a release branch, open a pull request, wait for required checks, squash-merge to `main`, then verify the production commit, Cloudflare deployment checks, and both canonical manifests on `main`.
