# Agent-assisted Cloudflare deployment

This repository is a public deployment template for non-technical site owners. Read `deployment/agent-manifest.json` and `START-HERE.md` before changing or deploying it.

Prefer the repository's **Deploy to Cloudflare** button. The deployment provisions a Worker, a fresh D1 database, and a Workers KV namespace from the root `wrangler.jsonc`. Use direct Wrangler deployment for maintenance or when the deployment button is unavailable.

## Accepted target

- Use the generated `workers.dev` hostname unless the owner explicitly requests a custom domain.
- Keep formal D1 and KV resources empty on first deployment.
- Store media in `MEDIA_KV` as 4 MiB chunks. Video uploads are MP4, at most 50 MB.
- Enforce an application storage ceiling of 800 MiB and warn at 700 MiB.
- Initialize the administrator once with the `INITIAL_ADMIN_CODE` secret, then use a site password.
- Generate a system recovery code after initialization and after each password recovery. Display each recovery code once and store only its keyed hash.

## Work autonomously

Inspect, verify, deploy, migrate, and test the project with the tools available to you. Do not ask the owner to type shell commands.

Ask the owner only to:

1. Approve the official browser login and Cloudflare or repository authorization.
2. Enter an `INITIAL_ADMIN_CODE` of at least 16 characters containing ASCII letters and digits in the official deployment form or hidden terminal prompt.
3. Choose their administrator password inside `/admin` and save the generated recovery-code file.

Never request a Cloudflare password, browser cookie, long-lived API token, administrator password, deployment code, or recovery code in chat. Do not write secrets into source files, commits, logs, screenshots, or the public repository.

## Deployment workflow

1. Verify the Node.js version from `package.json#engines`; run `npm ci`, `npm test`, `npm run lint`, and `./node_modules/.bin/tsc --noEmit`.
2. For a new site, open the Deploy to Cloudflare link and let the owner approve official authorization. Confirm the form creates bindings named `DB` and `MEDIA_KV` and runs `npm run deploy`.
3. Ensure `INITIAL_ADMIN_CODE` is configured as a secret, has at least 16 characters, and contains ASCII letters and digits. The value must be entered by the owner on an official or local hidden-input surface.
4. Confirm all D1 migrations, including `0005_password_auth_kv_media.sql`, were applied.
5. Open `/admin`. The owner enters the deployment code once and creates a password. Wait while they download and safely store the recovery code.
6. Execute every live verification in the manifest, including range playback, seeking, storage reporting, the 800 MiB gate, password recovery, and ten complete playback sessions.
7. Report the deployed URL, resource names, test outcomes, and any remaining account-owned action.

## Safety and recovery

- Do not copy content or media from another site unless the owner explicitly requests it.
- Preserve D1 and `MEDIA_KV` during program updates. Use `npm run cloudflare:deploy` for an existing installation.
- Before deleting a Worker, D1 database, KV namespace, or media, resolve the exact target and obtain explicit owner approval.
- If deployment stops after resources are created, inspect and resume those resources instead of creating duplicates.
- Losing both the administrator password and the latest recovery code requires an operator-assisted credential reset in D1. Do not weaken authentication to work around that condition.
- For mainland-China audiences, verify the final `workers.dev` address on the owner's actual mobile and broadband networks. Platform capacity can support the expected viewing volume, but route quality must be measured from the audience's networks.
