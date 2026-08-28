# Agent-assisted Cloudflare deployment

This repository is a public deployment template for non-technical site owners. Read `deployment/agent-manifest.json`, `START-HERE.md`, `docs/guides/student-cloudflare-setup.md`, and `UPGRADE-GUIDE.md` before changing, deploying, or upgrading it.

The user flow is GPT-first: verify account context first, then direct the user to the official Deploy to Cloudflare button. The deployment provisions a Worker, D1 database, and Workers KV namespace and configures Workers Builds.

## Accepted target

- Use the generated `workers.dev` hostname unless the owner explicitly requests a custom domain.
- Keep new-site D1 and KV resources independent from every existing site.
- Store media in `MEDIA_KV` as 4 MiB chunks. Video uploads are MP4, at most 50 MB.
- Enforce an application storage ceiling of 800 MiB and warn at 700 MiB.
- Initialize the administrator once with the `INITIAL_ADMIN_CODE` secret, then use a site password.
- Generate a system recovery code after initialization and after each password recovery. Display each recovery code once and store only its keyed hash.
- Local-password sessions last 12 hours. Five failed password attempts lock login for 15 minutes. Explicit logout revokes the active session.

## GPT and account isolation

The same GPT account may assist many different students. GPT identity is not the hosting identity.

Before every new deployment, explicitly resolve:

1. which student/site is being deployed;
2. the GitHub account currently signed in in the browser;
3. the Cloudflare account currently signed in in the browser;
4. whether this Cloudflare account already contains another copy of this portfolio;
5. the intended new repository and Worker names.

If the browser is still signed in to a previous student's GitHub or Cloudflare account, stop and ask the user to switch the official account first. Never continue based only on the ChatGPT account identity.

One GitHub/Cloudflare account may host multiple portfolio sites, but each site must have an independent Git repository, Worker, D1 database, `MEDIA_KV`, URL, administrator password, and recovery code. Never bind a new site to another site's D1 or KV.

## Work autonomously

Inspect, verify, deploy, migrate, and test the project with the tools available to you. Do not ask the owner to type shell commands when tools can do the work.

Ask the owner only to:

1. Approve official browser login and Cloudflare/GitHub authorization.
2. Enter an `INITIAL_ADMIN_CODE` of at least 16 characters containing ASCII letters and digits on an official secret-input surface.
3. Choose the administrator password inside `/admin` and save the generated recovery-code file.

Never request a Cloudflare password. Never request a GitHub password, browser cookie, long-lived API token, administrator password, deployment code, or recovery code in chat. Do not write secrets into source files, commits, logs, screenshots, or public repositories.

## Deployment workflow

1. Confirm account isolation and target site identity before opening the deploy link.
2. Verify the Node.js version from `package.json#engines`; run `npm ci`, `npm test`, `npm run lint`, and `./node_modules/.bin/tsc --noEmit` when performing a release or final package validation.
3. For a new site, open the Deploy to Cloudflare link and let the owner approve official authorization. Confirm the deployment creates or binds resources named `DB` and `MEDIA_KV` for this site only.
4. Ensure `INITIAL_ADMIN_CODE` is configured as a secret, has at least 16 characters, and contains ASCII letters and digits. The owner enters it on an official or hidden-input surface.
5. Confirm all D1 migrations, including `0005_password_auth_kv_media.sql`, were applied.
6. Open `/admin`. The owner enters the deployment code once and creates a password, then downloads and safely stores the recovery code.
7. Verify an unauthenticated admin visit requires a password, explicit logout revokes the session, and the 12-hour session behavior is understood.
8. Execute the live verification list in the manifest, including storage reporting, program upgrade center, range playback, seeking, password recovery, and media behavior.
9. Report the deployed URL, resource names, test outcomes, and any remaining account-owned action.

## Safety and recovery

- Do not copy content or media from another site unless the owner explicitly requests it.
- Preserve D1 and `MEDIA_KV` during program updates. Use `npm run cloudflare:deploy` for an existing installation.
- Before deleting a Worker, D1 database, KV namespace, or media, resolve the exact target and obtain explicit owner approval.
- If deployment stops after resources are created, inspect and resume those resources instead of creating duplicates.
- Losing both the administrator password and the latest recovery code requires an operator-assisted credential reset in D1. Do not weaken authentication to work around that condition.
- For mainland-China audiences, verify the final `workers.dev` address on the owner's actual mobile and broadband networks.
