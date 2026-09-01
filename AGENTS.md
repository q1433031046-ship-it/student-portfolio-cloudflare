# Agent-assisted Cloudflare deployment

This repository is a public deployment template for non-technical site owners.

## Canonical documentation

- Human-facing guide: `README.md`
- Machine-readable deployment contract: `deployment/agent-manifest.json`
- Version and upgrade policy: `deployment/template-version.json`
- Canonical upgrade instruction: `deployment/upgrade-prompt.json`

The current release contract is version `1.3.0`, source ref `refs/tags/v1.3.0`. Before showing or executing an upgrade prompt, verify the prompt's exact UTF-8 SHA-256 against both release manifests. `main` may advertise a later version manifest; the prompt itself must come from that manifest's matching `v<version>` tag.

Do not send users to multiple setup documents. The repository README is the only public student guide. After deployment, the same operational guidance is available from the password-protected administrator interface.

The user flow is GPT-first: verify account context first, then direct the user to the official Deploy to Cloudflare button. The deployment provisions a Worker, D1 database, and Workers KV namespace and configures Workers Builds.

The public template declares only the `DB` and `MEDIA_KV` bindings and carries no site-specific resource ids or fixed `database_name`. Deploy to Cloudflare derives independent resources from the effective Worker name and binding and writes exact ids into the cloned configuration where supported; sites in the same account must never reuse D1 through a fixed template database name. After first deployment, read-only compare the cloned `DB.database_id` and `MEDIA_KV.id` with the live Worker bindings. If the platform did not write them back, stop automatic-upgrade preparation and copy only the exact ids shown for this site in the official Cloudflare resource UI into the cloned config; never guess or reuse another site's ids. When Workers Builds provides `WRANGLER_CI_OVERRIDE_NAME`, validate it and treat it as the effective Worker name for status, version inspection, resource fingerprinting, and final deployment.

## Accepted target

- Use the generated `workers.dev` hostname unless the owner explicitly requests a custom domain.
- Keep new-site D1 and KV resources independent from every existing site.
- Store new media in `MEDIA_KV` as 4 MiB chunks. Final video is optional; new video uploads are MP4, at most 50 MiB. A project without video publishes with `00:00` and no public play control.
- Legacy R2 migration is available only when the existing site already has a fixed D1 `DB` resource id and a unique `MEDIA_KV` resource id, with matching bindings on the live Worker. An untouched v1.0 R2-only install is not supported by the v1.3.0 automatic upgrade path: fail closed before fingerprinting or deployment, make no remote mutation, and never create, reuse, or adopt a KV namespace. For an eligible site with legacy R2 rows, retain its existing `BUCKET`, preserve 50–90 MiB media, copy resumably to KV, verify every chunk, and never delete the R2 source automatically.
- Enforce an application storage ceiling of 800 MiB and warn at 700 MiB.
- Initialize the administrator once with the `INITIAL_ADMIN_CODE` secret, then use a site password.
- Generate a system recovery code after initialization and after each password recovery. Display each recovery code once and store only its keyed hash.
- Local-password sessions last 12 hours. Five consecutive password failures from the same Cloudflare client-network bucket lock password login for that bucket for 15 minutes. Other network buckets and the high-entropy recovery-code flow remain independent; a wrong recovery code never triggers the password-login lock. Derive only an irreversible truncated bucket digest from trusted Cloudflare request metadata keyed with `password_hash`; use `unknown` when that metadata is absent, and never persist the raw address. Explicit logout revokes the active session.
- QR visitor sessions last a fixed, non-sliding 24 hours and are clamped to the pass expiry. Reusing the same pass in the same valid browser session neither increments use count nor extends expiry.
- Exhausting a QR pass blocks new redemptions without revoking valid sessions; pausing, deleting, or expiring the pass revokes its sessions immediately.
- Do not expose a public `/guide` route. Pre-deployment guidance is served by GitHub; post-deployment guidance is opened only after an administrator signs in.

## GPT and account isolation

The same GPT account may assist many different students. GPT identity is not the hosting identity.

Before every new deployment, explicitly resolve:

1. which student/site is being deployed;
2. the GitHub account currently signed in in the browser;
3. the Cloudflare account currently signed in in the browser;
4. whether this Cloudflare account already contains another copy of this portfolio;
5. the intended new repository, Worker, D1, and KV names.

If the browser is still signed in to a previous student's GitHub or Cloudflare account, stop and ask the user to switch the official account first. Never continue based only on the ChatGPT account identity.

One GitHub/Cloudflare account may host multiple portfolio sites, but each site must have an independent Git repository, Worker, D1 database, `MEDIA_KV`, URL, administrator password, and recovery code. Never bind a new site to another site's D1 or KV.

## Work autonomously

Inspect, verify, deploy, migrate, and test the project with the tools available to you. Do not ask the owner to type shell commands when tools can do the work.

Ask the owner only to:

1. Approve official browser login and Cloudflare/GitHub authorization.
2. Enter an `INITIAL_ADMIN_CODE` of at least 16 characters containing ASCII letters and digits on an official secret-input surface.
3. Choose the administrator password inside `/admin` and save the generated recovery-code file.

Never request a Cloudflare password. Never request a GitHub password, browser cookie, QR code or QR access link, long-lived API token, administrator password, deployment code, or recovery code in chat. Do not write secrets into source files, commits, logs, screenshots, or public repositories. When a screenshot is necessary, request only a redacted local crop of the relevant control or error.

Before requesting GitHub or Cloudflare authorization, run one harmless read-only action against each relevant official connector. Reuse every connection that succeeds. Request official authorization only when the connector explicitly reports Connect, Reconnect, expired authorization, or insufficient permission. After one authorization, repeat the same read-only action and resume the exact interrupted step. Never restart the deployment or recreate its repository, Worker, D1, or `MEDIA_KV` after authorization. If the authorization prompt repeats after approval, stop and resolve the account identity, target site, and already-created resources before continuing.

## Trusted GitHub release command

For future release candidates, the repository owner or an authorized GitHub plugin may start the protected release gate without opening the GitHub Actions browser form:

1. Use an open, non-draft pull request from this repository's exact `release/vX.Y.Z` branch into `main`.
2. As the repository owner, add the exact pull-request comment `/verify-and-tag vX.Y.Z`.
3. `.github/workflows/release-command.yml` resolves the current release-branch tip and current `main` SHA from GitHub, then calls `.github/workflows/release-verify.yml` with those immutable values.

The comment entry is owner-only, accepts no arbitrary SHA, requires the release branch and version to agree, and grants no Cloudflare access. It reuses the existing Linux, Chrome, macOS WebKit, release-contract, remote-ref, ancestry and immutable-tag checks. It may verify and create the release tag only; it does not deploy a production Worker, change D1 or KV, or bypass the strict production-upgrade workflow.

## Deployment workflow

1. Read `README.md`, `deployment/agent-manifest.json`, `deployment/template-version.json`, and `deployment/upgrade-prompt.json`.
2. Confirm account isolation and target site identity before opening the deploy link.
3. Verify the Node.js version from `package.json#engines`; run `npm ci`, `npm test`, `npm run lint`, and `./node_modules/.bin/tsc --noEmit` when performing a release or final package validation.
4. For a new site, reuse valid GitHub and Cloudflare connections; open the Deploy to Cloudflare authorization flow only when a harmless read-only check explicitly requires it.
5. Confirm the deployment creates or binds resources named `DB` and `MEDIA_KV` for this site only. If the UI asks the user to choose a resource, use a newly created resource rather than another site's existing D1 or KV.
6. After the first deployment, read-only verify that the cloned `wrangler.jsonc` has fixed `DB.database_id` and `MEDIA_KV.id` values matching the live Worker. If Cloudflare did not write them back, stop upgrade preparation and restore only this site's exact ids from the official resource UI; never infer or reuse values.
7. Keep the production branch as `main`, build command as `npm run build`, deploy command as `npm run deploy`, and root directory as the UI default unless the repository configuration explicitly changes.
8. Ensure `INITIAL_ADMIN_CODE` is configured as a secret, has at least 16 characters, and contains ASCII letters and digits. The owner enters it on an official or hidden-input surface.
9. Confirm all D1 migrations, including `0005_password_auth_kv_media.sql`, `0006_auth_v2.sql`, and `0007_legacy_media_and_access_state.sql`, were applied.
10. Open `/admin`. The owner enters the deployment code once and creates a password, then downloads and safely stores the recovery code.
11. Verify an unauthenticated admin visit requires a password, explicit logout revokes the session, and the 12-hour session behavior is understood.
12. Confirm the password-protected administrator UI contains the “使用教程” entry and that no public `/guide` route is shipped.
13. Execute the applicable verification list in the manifest. For a project without final video, verify publish, `00:00`, and no play control; run range playback and seeking only when a video exists.
14. Report the deployed URL, resource names, automated test outcomes, production evidence, owner-manual results, and every unverified item separately.

## Upgrade workflow

1. Read `README.md`, this file, `deployment/agent-manifest.json`, `deployment/template-version.json`, and `deployment/upgrade-prompt.json`. First inspect the original `wrangler.jsonc`: automatic upgrade requires exactly one `DB` binding with `database_id` and exactly one `MEDIA_KV` binding with `id`. A missing requirement, including an untouched v1.0 R2-only install, is unsupported and must fail closed before fingerprinting or deployment without provisioning or adopting a namespace. For an eligible site, fetch and verify only `refs/tags/v1.3.0` in a temporary detached worktree outside the original site worktree/repository directory; calculate the prompt SHA-256 before trusting it. Install the tag dependencies there, but never deploy from the isolated worktree and never copy its Wrangler resource identifiers into the original site.
2. Before mutation, ask only whether the owner has opened and safely stored the current recovery file for this exact hostname. Never ask for its value. Stop before deployment if the owner cannot confirm it.
3. Record the remote workers.dev setting and full URL separately, then resolve the exact existing Worker, D1, `MEDIA_KV`, optional existing `BUCKET`, all live secret binding names, and runtime variables. For a legacy repository without the fingerprint command, invoke the verified tag's absolute `scripts/cloudflare-deploy.mjs --mode upgrade --inspect` path. The script pins Wrangler's process directory to that verified tag worktree root and uses the dependencies installed there, even when Node is launched from another current directory. Pass the original site's absolute `wrangler.jsonc` path as `--config`, the isolated tag manifest as `--manifest`, and the original site's fixed `.wrangler/upgrade-before-fingerprint.json` as `--output`; resolve paths yourself instead of asking the owner. The isolated worktree must remain read-only with respect to deployment. The baseline is exclusively created with mode 0600 once per upgrade round, retained across retries, and never overwritten. An existing path fails closed; start a new round only after the owner confirms the old baseline is obsolete and it has been moved to an archive location. The fingerprint covers Worker name, the original Wrangler `configuredWorkersDevEnabled` value, DB, KV, optional R2, every live secret binding name, and each runtime variable binding/type/value SHA-256 without storing the value. The remote workers.dev setting and full hostname are separate manual baselines and must be revisited after deployment.
4. Record a read-only baseline: version and commit, migration journal, draft/published revision, media count and bytes, access-pass count, and legacy R2 status. Preserve resource identifiers, secrets, administrator identity, media, content, access passes, analytics, and audit records.
5. Inspect the legacy branch. When R2 rows exist, the same old `BUCKET` binding is required; when none exist, no R2 action is needed. Preserve schema-1 hero media in the current hero. Store retired schema-1 draft-video media only as an administrator-readable private document archive reference; strip it before returning public documents and omit it from preview, public UI, and playback.
6. After recovery is confirmed, record the original branch and commit and require a clean worktree. If local changes exist, stop until the owner confirms a recoverable commit, patch, or separate backup; never force checkout, run `reset --hard`, or silently discard files. Preserve an exact copy of the original `wrangler.jsonc` outside the repository, converge the verified tag's tracked source into the original site worktree, and restore the original Worker/DB/KV/optional BUCKET/vars configuration byte-for-byte. Keep `.wrangler/upgrade-before-fingerprint.json`. From that original site worktree and current v1.3.0 source, run `npm ci`, then `npm run cloudflare:fingerprint -- --output .wrangler/upgrade-predeploy-fingerprint.json`; compare it strictly with the before fingerprint without overwriting the before file. Run the complete verification gate only after they match. `npm run deploy` is for Deploy Button first deployment only; an automatic Cloudflare Builds deploy against an existing Worker must fail closed and never substitutes for an upgrade. From the same original site worktree, apply only forward migrations and run the sole strict upgrade entry `npm run cloudflare:deploy`, which reads `.wrangler/upgrade-before-fingerprint.json`. A D1 permission fallback is allowed only after `wrangler d1 migrations list` succeeds and reliably enumerates every pending migration, the later apply command clearly fails for D1 permission, the fingerprint matches, and every pending file is both allowlisted in `databaseMigrationPolicy.runtimeSafeBootstrapMigrations` and verified as idempotent DDL. A list failure or uncertain pending set, resource mismatch, unknown migration, SQL, configuration, and network failures remain closed.
7. After deployment, return to the recorded official `/admin`. The owner enters the current recovery code, administrator password, and repeated password, then downloads and opens the new `{hostname}-v1.3.0-系统恢复码-{YYYYMMDDTHHMMSSZ}.txt` file before entering the admin. Confirmation rotates recovery state, replaces the password verifier, revokes all prior administrator sessions, and creates one new 12-hour session for the current browser.
8. If legacy R2 rows exist, read `GET /api/admin/storage` and repeat `POST /api/admin/storage/migrate`. The ledger pins the original R2 object ETag; copying advances one 4 MiB chunk per call and verifies R2/KV byte counts plus SHA-256. After every copied chunk is recorded, the resumable `final-verifying` phase rereads one current KV chunk per call and compares it with the copy ledger. Only a complete, matching final ledger may CAS the media row to KV. An ETag change or missing/changed KV chunk fails closed and leaves the row on R2. Require `legacyMigration.status=complete` and `r2FileCount=0`; keep the old bucket and source objects through observation unless the owner separately approves exact deletion targets.
9. Run `npm run cloudflare:fingerprint -- --output .wrangler/upgrade-after-fingerprint.json` and compare it with `.wrangler/upgrade-before-fingerprint.json`; separately confirm the recorded workers.dev URL. Run production checks only against that target. Ten-viewer tests require isolated browser profiles or cookie jars, not ten tabs. Mainland mobile-data and broadband checks are owner-manual. Report every check without production evidence as unverified.

## Safety and recovery

- Do not copy content or media from another site unless the owner explicitly requests it.
- Before deleting a Worker, D1 database, KV namespace, repository, or media, resolve the exact target and obtain explicit owner approval.
- If deployment stops after resources are created, inspect and resume those resources instead of creating duplicates.
- Losing both the administrator password and the latest recovery code requires an operator-assisted credential reset in D1. Do not weaken authentication to work around that condition.
- For mainland-China audiences, verify the final `workers.dev` address on the owner's actual mobile and broadband networks.

## Default manual review boundary

Use this simplified manual workflow by default: plan once, audit the plan once, role 3 implements, audit the exact Candidate once, then role 4 releases only after the Candidate audit passes. When an audit fails, role 3 fixes the recorded blockers; the follow-up audit is limited to those blockers, the task-owned changes, and their direct regressions.

Freeze review scope at the approved request. An audit may require changes only for unmet acceptance criteria, failing required verification, Candidate identity mismatch, or a credible risk to production, data, security, or an irreversible operation. Do not use an audit to require unrelated refactors, new features, new protocols, new monitoring, speculative cleanup, or zero known defects.

Classify findings by disposition:

- A Blocking Risk that can affect correctness, production, data, security, Candidate identity, or reversibility must be fixed before approval.
- A contained Medium or Low risk may be accepted when its issue, severity, impact or blast radius, containment, stop or escalation condition, and planned follow-up are recorded.
- A Low issue that does not cross a blocking boundary may be explicitly accepted for the current Candidate and must not block approval merely to make the known-issue count zero.

End the audit when the approved behavior is complete, all Blocking Risks are closed, required checks pass, and the Candidate SHA, Tree SHA, PR, branch, and Base are exact. Re-run a full audit only when the Base, Candidate identity, approved scope, production or data behavior, or a trust boundary changes materially; otherwise do not reopen unaffected areas.

Human reviewers decide release eligibility and record an unambiguous pass or fail against the exact Candidate. Do not use automated Markdown parsing or `governance-state` transitions to grant release eligibility unless the project owner explicitly reactivates that system in a separate approved change.

## Four-role governance entry

This section documents retained four-role infrastructure; it is not the default project workflow. If the project owner explicitly reactivates it in a separate approved change, use the fixed roles 1=超级规划, 2=超级审计, 3=超级工作, and 4=超级发布, and first read `governance/README.md`, `governance/workflow.md`, `governance/role-contract.json`, and the matching `governance/roles/*.md` contract.

Read dynamic handoff state from `governance/runtime/current.json` on the dedicated `governance-state` branch, then follow its version and record pointers. The current repository governance contract and coordinated state take priority over old chat memory. Keep the full role contracts in `governance/`; this section is navigation only and must not replace or weaken the existing version, deployment, upgrade, or security contract above.

Governance state is written only by `.github/workflows/governance-state.yml` after the default-branch verifier re-reads the repository owner's exact source comment, previous tip/revision, immutable records, remote Candidate, and compare-and-swap inputs. After opening each proposal, the writer may request the independent Gate through the fixed `repository_dispatch` event, but its job has no `checks: write` authority. The Gate runs trusted code from `main`, treats proposal branches and PR bodies as untrusted data, never executes proposal-tree code, and creates the head-bound `governance-state-write` Check through the Checks API. That Check must come from GitHub Actions App id `15368`; the writer cannot authorize its own proposal, and the ruleset has no bypass actors.

The governance bootstrap trust root must first be reviewed by role 2 in its own PR. Until that review passes and the trust root reaches `main`, do not execute the failed-audit recovery or describe PR #14 as effective. The recovery is then limited to the fixed legacy tip, revision 2, PR #13 Candidate commit/tree, and PR #14 recovery head; it writes records before pointers and produces schema 2 revision 3 at `IMPLEMENTATION_REQUIRED`.

Direct pushes and Cloudflare previews from `governance-state`, `governance/*`, and `governance-write/*` are forbidden. A two-parent `main` merge that changes the trust-root workflow must also stop before build or version creation after its complete changed-path set is verified, independent of GitHub's configured merge-title format; the `Governance trust root:` subject remains an additional fail-closed signal. If GitHub or Cloudflare protections cannot be proven active, stop the handoff as `BLOCKED` instead of editing state locally.
