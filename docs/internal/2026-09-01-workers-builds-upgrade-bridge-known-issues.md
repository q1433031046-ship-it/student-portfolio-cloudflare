# Workers Builds Upgrade Bridge — Known Issues

This record applies only to the v1.3.0 emergency Workers Builds existing-site upgrade bridge. It does not relax the hard safety gates for Worker identity, fixed D1/MEDIA_KV resources, Secrets/vars preservation, migration ordering, migration failure, immutable product source, or resource provisioning.

## KI-1 — Resource-ID redaction is pattern-based

- **Risk level:** Low.
- **Issue:** Failure-output redaction recognizes current token/password/resource-key patterns, UUIDs, and 32-character hexadecimal identifiers. A future Cloudflare/Wrangler release could introduce a new opaque resource identifier format without a recognizable resource key.
- **Maximum impact:** A resource identifier, not a Secret value, could appear in a failed build log if Cloudflare introduces an unrecognized format.
- **Current isolation:** Successful Migration apply and Worker deploy raw output is suppressed. Bridge-generated mismatch errors do not interpolate DB or MEDIA_KV IDs. Failure output is redacted for known token/cookie/password/Secret patterns, resource ID/name fields, UUIDs, and 32-character hexadecimal IDs.
- **Why it does not block this emergency bridge:** Current known/tested Wrangler output shapes are covered, Secret values are never read, and this logging limitation cannot change or select a production resource. Resource selection remains guarded independently by the Worker and complete-binding fingerprints.
- **Stop condition:** Immediately stop the upgrade if any real/preflight log shows an unredacted production resource identifier or credential-like value.
- **Planned follow-up:** v1.3.1 — move bridge failures toward structured allowlisted diagnostics that do not echo raw Wrangler output.

## Platform evidence still required before any real rollout

The following are not deferred code bugs and are not claimed as passed by this Candidate:

- live Cloudflare Workers Builds execution;
- confirmation that the selected build token has both Account `Workers Scripts:Edit` and Account `D1:Edit`;
- real `WRANGLER_CI_OVERRIDE_NAME` identity;
- real D1 `migrations list/apply/list` behavior;
- real new Worker Version observation and post-deploy complete-binding fingerprint;
- production-site functional verification.

Any uncertainty in these platform gates is fail-closed and must stop the real upgrade rather than be converted into a Known Issue waiver.
