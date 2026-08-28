# Agent-assisted Cloudflare deployment

This package is designed to be deployed by an AI coding agent on behalf of a non-technical site owner. Read `deployment/agent-manifest.json` and `START-HERE.md` before making changes or running deployment commands.

For non-technical owners, prefer the public repository's **Deploy to Cloudflare** button. It automatically provisions the Worker, D1 database, and R2 bucket from the root `wrangler.jsonc`. Use direct Wrangler deployment only when the button is unavailable or when maintaining an existing installation.

## Accepted deployment target

- Deploy the application to Cloudflare Workers with a fresh D1 database and R2 bucket.
- Use the generated `workers.dev` hostname unless the owner explicitly asks to add a custom domain.
- Protect `/admin*`, `/api/admin*`, and `/preview*` with Cloudflare Access One-time PIN.
- Bind the first server-verified administrator email as the immutable site owner.
- Send the permanent `/admin` link through Cloudflare Email Service before unlocking management features.

## Work autonomously

After the owner confirms deployment, inspect the package, run its local verification, and perform all safe deployment work available through configured Cloudflare tools or Wrangler. Do not ask the owner to type shell commands.

Ask the owner only for actions that require their identity or account authority:

1. Approve Cloudflare OAuth or Wrangler's official browser login.
2. State the administrator email they want Access to allow.
3. Verify or select a Cloudflare Email Service sender address.
4. Read the OTP delivered to their mailbox when they test sign-in.

Never request a Cloudflare password, mailbox password, long-lived API token, or copied browser cookie. Do not place the administrator email or credentials in source files, build logs, commits, or the public deployment.

## Deployment workflow

1. Verify Node.js satisfies `package.json#engines`, then run `npm ci`, `npm test`, `npm run lint`, and `npx tsc --noEmit`.
2. For a new owner, open the repository's Deploy to Cloudflare link and let the owner approve Cloudflare and repository authorization. Confirm the deployment page provisions `DB` and `BUCKET` and uses `npm run deploy`.
3. For a direct CLI deployment, check Cloudflare authentication with `npx wrangler whoami`. If authorization is missing, start the official login flow and let the owner approve it.
4. Confirm Cloudflare Email Service has a verified sender. If it does not, pause only this dependency and guide the owner through the official dashboard. Do not bypass onboarding-email delivery.
5. When direct Cloudflare tools are used instead of the deploy button, run `npm run cloudflare:setup` in a PTY and complete the prompts while preserving the manifest's bindings and security policy.
6. Configure Cloudflare Access for all three protected path patterns, allow only the confirmed administrator email, enable One-time PIN, and set both application and global session duration to 15 minutes.
7. Finish the first-run flow at `/admin`. The displayed email must match the verified Access identity; the owner chooses “绑定当前邮箱”.
8. Execute every live verification in the manifest. Report the deployed URL, resource names, test outcomes, and any remaining account-owned action.

## Safety and recovery

- The formal environment intentionally starts empty. Do not copy data or media from another deployment unless the owner explicitly changes that decision.
- Do not modify `site_ownership.owner_email`; the database trigger intentionally rejects it.
- Preserve D1 and R2 on later code deployments. Use `npm run cloudflare:deploy` for updates.
- Before a destructive resource action, identify the exact Worker, D1 database, and R2 bucket and obtain explicit owner approval.
- If deployment stops after resource creation, inspect existing resources and resume. Do not create duplicates merely to recover from an interrupted login or prompt.
