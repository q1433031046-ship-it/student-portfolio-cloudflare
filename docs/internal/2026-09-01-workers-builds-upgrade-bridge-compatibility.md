# Workers Builds Upgrade Bridge — Real Legacy Structure Compatibility Evidence

## Evidence boundary

- Historical source snapshot: `dbbbf185983449898b91da96de75d3e07f9ed345`.
- Inspection method: read-only local Git object reads with `git show` and `git ls-tree`.
- Remote Cloudflare API calls: none.
- Production Worker, D1, KV, Secrets, vars, and data mutations: none.
- Resource identifiers: verified as present, then replaced in memory with test-only placeholders; no real identifier is recorded in this document or emitted by the test.

## Observed legacy structure

The historical `wrangler.jsonc` contains:

- one existing Worker name;
- one `DB` D1 binding with a fixed `database_id`;
- one `MEDIA_KV` binding with a fixed `id`;
- `migrations_dir` pointing to `./drizzle`;
- the same Cloudflare Worker entry and static-assets layout expected by v1.3.0.

The tracked SQL migration set in that snapshot is exactly:

1. `0000_bumpy_ultimo.sql`
2. `0001_perpetual_firestar.sql`
3. `0002_nosy_silhouette.sql`
4. `0003_careful_justice.sql`
5. `0004_owner_email_onboarding.sql`
6. `0005_password_auth_kv_media.sql`

This is the required real legacy shape: fixed existing resources with migrations `0000`–`0005` and without the v1.3.0 `0006`/`0007` files.

## Non-destructive compatibility run

Test: `real fixed-ID 0000-0005 legacy source structure reaches only 0006 and 0007 non-destructively` in `tests/cloudflare-workers-builds-upgrade-bridge.test.mjs`.

The test performs these steps entirely in a temporary directory:

1. Reads the historical config and migration tree from Git.
2. Confirms the fixed DB/KV fields exist without printing their values.
3. Replaces both identifiers with local placeholders.
4. Supplies the exact v1.3.0 `0006` and `0007` SQL files.
5. Uses a fake `npx`/Wrangler executable; no network-capable Wrangler process is invoked.
6. Reports pending `0006`, then `0007`, applies once, and reports an empty second migration list.
7. Allows one same-name deploy only after the empty second list.
8. Returns a new fake Worker version whose resource fingerprint matches the pre-deploy fingerprint.

Observed result: passed. The command trace contains one migration apply, two migration-list reads, one deployment, and a post-deploy version read in the required order.

## Conclusion

The bridge accepts the real fixed-resource `0000`–`0005` legacy repository structure after its product payload is updated to the frozen v1.3.0 source. This evidence proves structural compatibility only; it does not claim a live production migration or deployment.

The audit-remediated bridge also requires the legacy site to expose only the modeled `ASSETS`, `DB`, `MEDIA_KV`, optional `BUCKET`, vars, and Secret bindings. Wrangler automatic provisioning, draft auto-create, and autoconfig are explicitly disabled. The compatibility harness records no resource identifier and never echoes raw Wrangler apply/deploy output.
