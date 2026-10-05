# API reference

Full route reference for `apps/api`. For a compact table of the core routes see [api.md](api.md).

All routes are mounted under `/v1` except health.

Health and meta:
- `GET /health`
- `GET /metrics`
- `GET /version`
- `GET /v1/doctor`
- `GET /v1/stats`

Retrieval and generation:
- `POST /v1/search` – hybrid search, returns ranked chunks
- `POST /v1/explain` – same retrieval, returns per-chunk BM25 / dense / hybrid / rerank / MMR scores and stage funnel counts (no LLM call)
- `POST /v1/ask` – RAG answer with citations
- `POST /v1/ask/stream` – SSE streaming variant
- `GET /v1/ask/cache/stats`
- `POST /v1/ask/cache/clear`
- `GET /v1/related` – related documents for a path

Ingest and sources:
- `POST /v1/ingest` – kick off an ingest for a path
- `GET /v1/ingest/status`
- `GET /v1/sources` – list indexed sources
- `GET /v1/sources/file?path=&start=&end=` – read a span of a source file
- `GET /v1/sources/stale?olderThanDays=&limit=`

Conversations:
- `GET /v1/conversations?archived=`
- `POST /v1/conversations`
- `GET /v1/conversations/:id`
- `PATCH /v1/conversations/:id` (rename)
- `DELETE /v1/conversations/:id`
- `GET /v1/conversations/:id/export.md`
- `GET /v1/conversations/:id/export.json`
- `GET /v1/conversations/:id/export.csv`
- `POST /v1/conversations/:id/archive` | `/unarchive`
- `POST /v1/conversations/:id/fork`
- `POST /v1/conversations/:id/ask`
- `POST /v1/conversations/:id/ask/stream` (SSE: `rewrite`, `sources`, `token`, `error`)

Saved searches and snapshots:
- `GET|POST /v1/saved`, `PATCH|DELETE /v1/saved/:id` (PATCH updates title, query, or tags)
- `GET /v1/saved/:savedId/snapshots`
- `POST /v1/saved/:savedId/snapshots`
- `GET|DELETE /v1/saved/:savedId/snapshots/:id`
- `POST /v1/saved/:savedId/snapshots/:id` (rerun / promote)

Try it: visit <http://127.0.0.1:7412/saved> to add tags inline, filter by tag, and rename a saved search. Or from the CLI:

```bash
curl -X PATCH http://127.0.0.1:7411/v1/saved/$ID \
  -H 'authorization: Bearer $TOKEN' -H 'content-type: application/json' \
  -d '{"title":"Weekly ingest digest","tags":["work","ops"]}'
```

Collections (group saved searches into folders):
- `GET /v1/collections` (list with per-folder item count)
- `POST /v1/collections` (create with optional `description` and palette `color`)
- `PATCH|DELETE /v1/collections/:id`
- `GET /v1/collections/:id` (collection plus hydrated saved-search rows)
- `POST /v1/collections/:id/members` (assign one saved search)
- `PUT /v1/collections/:id/members` (replace the full set)
- `DELETE /v1/collections/:id/members/:savedId`
- `GET /v1/collections/_membership` (saved-id to collection-id map for the saved-searches page)

Try it locally: with the web app running at <http://127.0.0.1:7412/collections>, create a folder, click Manage, then tick saved searches in or out. From the CLI:

```bash
curl -X POST http://127.0.0.1:7411/v1/collections \
  -H 'authorization: Bearer $TOKEN' -H 'content-type: application/json' \
  -d '{"name":"Onboarding playbooks","color":"violet","description":"Things new hires ask in week one"}'
```

History, share, feedback:
- `GET|DELETE /v1/history`
- `DELETE /v1/history/:id` (delete one past ask; see [Delete a single history entry](#delete-a-single-history-entry))
- `POST /v1/share`, `GET /v1/share/:id`, `DELETE /v1/share/:id`
- `GET /v1/shares` (list shares I created, with per-link view counts)

Try it locally: with the web app running at `http://127.0.0.1:7412`, share an answer from the chat, then open `http://127.0.0.1:7412/s/<id>` in an incognito window and view source to see the `og:image` / `twitter:image` meta tags. Fetch the rendered card directly:

```bash
curl -fsSL http://127.0.0.1:7412/s/<id>/opengraph-image -o /tmp/og.png && file /tmp/og.png
```

List your shares and revoke one:

```bash
# Browse manageable shares in the UI
open http://127.0.0.1:7412/shares

# Or via the API with a session cookie or Bearer key
curl -fsSL -H 'Authorization: Bearer cm_live_...' http://127.0.0.1:7410/v1/shares
curl -fsSL -X DELETE -H 'Authorization: Bearer cm_live_...' http://127.0.0.1:7410/v1/share/<id>
```

Mint a short-lived link (1 day) and watch it auto-expire to `410 Gone`:

```bash
# Create with ttlDays. Omit for the 30d default; pass null for "no expiry"
# (still hard-capped at 365 days server-side).
curl -fsSL -X POST -H 'Authorization: Bearer cm_live_...' \
  -H 'content-type: application/json' \
  -d '{"query":"hello","answer":"world","sources":[],"ttlDays":1}' \
  http://127.0.0.1:7410/v1/share
# => {"id":"...","url":"/s/...","expiresAt":1735689600000}

# Once expiresAt passes, the public viewer returns 410:
curl -i http://127.0.0.1:7410/v1/share/<id>
# HTTP/1.1 410 Gone
# {"error":"share expired","expiredAt":...}
```

- `GET|POST|DELETE /v1/feedback`

Curation:
- `GET|POST|DELETE /v1/pins`
- `GET|POST|DELETE /v1/mutes`
- `GET|POST|DELETE /v1/aliases`
- `GET /v1/tags`, `GET /v1/tags/:tag`
- `GET|PUT|POST|DELETE /v1/tags/by-path?path=`

Digests:
- `GET /v1/digests`
- `GET /v1/digests/:id`
- `POST /v1/digests/:id/run`
- `POST /v1/digests/run`

Auth and admin:
- `GET|POST /v1/keys`, `DELETE /v1/keys/:id`, `POST /v1/keys/:id/rotate`
- `POST /v1/maintenance/compact`
- `POST /v1/maintenance/forget`
- `GET /v1/me/export` – download every per-user record as JSON
- `GET /v1/me/export.zip` – same bundle as a ZIP containing the structured JSON plus CSV views of history, conversations, saved searches, feedback, and API keys, with a manifest and README for downstream tooling
- `DELETE /v1/me/data` – erase every per-user record, body `{"confirm":"DELETE"}`

Requests are rate-limited globally to 240/min, keyed by API key id, session user, or IP in that order. Individual API keys can carry a stricter custom limit set via `PUT /v1/keys/:id/rate-limit` (or the inline editor on the `/keys` page); when present it is enforced on every authenticated route and returns 429 with `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`, and `RateLimit-Policy` headers so SDKs back off correctly. Every denial is written to the audit log.

### Pin an API key to specific source IPs

Individual API keys can be bound to one or more IPv4 or IPv6 addresses or CIDR blocks (e.g. a CI runner range, a backend egress, or a single office IP). Any request from outside the configured ranges is rejected with `403 ip not allowed for this key` before the call executes, and the denial is written to the audit log as `api_key.ip.denied`. The workspace-level allowlist still applies; the per-key list adds a stricter cap.

From the `/keys` page click the **Restrict IPs** button on a row, paste one rule per line, and save. From a script:

```bash
curl -X PUT \
  -H "Cookie: cm_session=..." \
  -H "Content-Type: application/json" \
  -d '{"allowedIps":["203.0.113.7","10.0.0.0/8"]}' \
  http://127.0.0.1:7410/v1/keys/k_abc123/ip-allowlist
```

Send `{"allowedIps": null}` (or omit the field) to clear the restriction. The active rules surface in the key row footer and in `GET /v1/keys` so an admin can audit blast radius at a glance.

### Lock an API key to a browser origin

For keys that are deliberately embedded in a first-party browser bundle, each key can also carry an Origin allowlist. Requests with an `Origin` header that is not on the list are rejected with `403 origin not allowed for this key` and the denial is written to the audit log as `api_key.origin.denied`. Server-to-server callers (which do not send an `Origin` header) keep working unchanged, so adding a list does not break CI or backend jobs that share the same key.

From the `/keys` page click **Restrict origins** on a row, paste one `scheme://host[:port]` per line (no paths, no wildcards), and save. From a script:

```bash
curl -X PUT \
  -H "Cookie: cm_session=..." \
  -H "Content-Type: application/json" \
  -d '{"allowedOrigins":["https://app.example.com","https://admin.example.com:8443"]}' \
  http://127.0.0.1:7410/v1/keys/k_abc123/origin-allowlist
```

Send `{"allowedOrigins": null}` to clear the restriction. Origins are normalised (case-folded host, default ports stripped) and duplicates are rejected, so the saved rules match exactly what a browser will stamp on a `fetch`.

### Invite a teammate by email

Open <http://127.0.0.1:7412/settings/invitations>, click **New invitation**, enter the teammate's email and the role they should land in (admin, member, or viewer). The link and raw token are shown exactly once; send the link to them out of band. From the CLI:

```sh
# Owner or admin session cookie required. POST returns { token, acceptUrl, invitation }.
curl -X POST http://127.0.0.1:7411/v1/invitations \
  -H 'content-type: application/json' --cookie-jar cookies --cookie cookies \
  -d '{"email":"ada@example.com","role":"member","ttlMs":604800000}'
```

The recipient signs in (any configured OIDC IdP works) using `ada@example.com`, then opens the acceptUrl. The accept endpoint enforces that the authenticated email matches the invited email, so a forwarded link cannot be redeemed by anyone else. The token itself is never stored in plaintext on the server.

### Rotate a leaked or aging API key

When a deploy needs fresh credentials (or you suspect a leak) you can rotate a key in place from `/keys` (Rotate button) or via the API. Rotation issues a new secret on the same key id while the previous secret keeps working for a short grace window so callers can swap credentials without an outage. Try it locally with the web app running at `http://127.0.0.1:7412`:

```bash
# Rotate key id k_abc123 using an owner-scoped key with keys:admin
curl -X POST -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  http://127.0.0.1:7412/v1/keys/k_abc123/rotate
# {"key":{"id":"k_abc123","label":"watcher","role":"owner",...,"rotatedAt":...,"previousHashExpiresAt":...},
#  "secret":"cm_...","previousExpiresAt":1700000600000}
```

The response shows the new plaintext secret exactly once, plus when the old secret stops working. The rotation is recorded in the audit log as `api_key.rotate`.

### Try MFA step-up

With the dashboard running at `http://127.0.0.1:7412`, visit `/settings/mfa`, click *Start enrollment*, scan or paste the secret into your authenticator, and enter the six-digit code to confirm. After confirmation the API requires a fresh code for sensitive routes:

```bash
# Check status (200 with confirmed:true once enrolled)
curl -s -b cm.sid=... http://127.0.0.1:7412/v1/mfa/status

# Step up the current session for the next 15 minutes
curl -s -X POST -b cm.sid=... -H 'content-type: application/json' \
  -d '{"code":"123456"}' \
  http://127.0.0.1:7412/v1/mfa/verify
# {"ok":true,"method":"totp","recoveryCodesRemaining":10,"stepUpExpiresAt":...}
```

Without a recent verify, `POST /v1/keys`, `DELETE /v1/me/data`, `PUT /v1/ip-allowlist`, maintenance, session revoke, and every webhook mutation return `401 mfa step-up required` with `x-mfa-required: 1`. API key callers bypass MFA: their scopes are their authorization.

To skip the prompt on the same laptop, tick *Remember this device for 14 days* during a verify. The cookie is bound to the user, only its sha256 is stored on disk, and you can list or revoke every browser from the same page:

```bash
# Mint a trusted-device cookie alongside the step-up
curl -s -c jar.txt -b jar.txt -X POST -H 'content-type: application/json' \
  -d '{"code":"123456","rememberDevice":true,"deviceLabel":"Work laptop"}' \
  http://127.0.0.1:7412/v1/mfa/verify
# {"ok":true,...,"trustedDevice":{"id":"td_...","expiresAt":...,"trustDays":14}}

# List trusted devices (the current browser is flagged inline)
curl -s -b jar.txt http://127.0.0.1:7412/v1/mfa/trusted-devices

# Revoke one (requires a fresh code in the same session)
curl -s -b jar.txt -X DELETE http://127.0.0.1:7412/v1/mfa/trusted-devices/td_abc
```


### See per-key API usage

Before rotating or revoking, confirm a key is actually in use. Every successful Bearer call appends a small event (route, method, status, timing) to a per-key log, summarised at `GET /v1/keys/:id/usage`. The `/keys` page exposes the same report inline behind a Usage button per row. Try it locally with the web app running at `http://127.0.0.1:7412`:

```bash
# Drive some traffic through a key, then read its usage report
CLAWMIND_API_KEY=cm_... # key being audited
curl -s -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  http://127.0.0.1:7410/v1/search?q=hello > /dev/null

curl -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  http://127.0.0.1:7410/v1/keys/k_abc123/usage?recent=10\&routes=6
# {"keyId":"k_abc123",
#  "totals":{"total":42,"last24h":12,"last7d":40,"lastStatusOk":38,"lastStatusErr":2,...},
#  "recent":[{"ts":...,"route":"/v1/search","method":"GET","status":200,"ms":7}, ...],
#  "byRoute":[{"route":"/v1/ask","method":"POST","count":18,"lastAt":...}, ...]}
```

The call is gated by the `keys:admin` scope and returns 404 across users, so one customer cannot read another's key usage even if they guess the id. Revoking a key purges its usage log.

### Try the API key snippets

When you issue a key from <http://127.0.0.1:7412/keys>, the freshly-minted secret panel includes copy-pasteable `curl` commands for `/v1/ask`, `/v1/search`, and `/v1/history`, pre-filled with the real secret. A permanent Using your key section at the bottom of the page shows the same snippets with a `$CLAWMIND_KEY` placeholder for returning users. Sample call:

```bash
export CLAWMIND_KEY=cm_...   # paste a secret from /keys

curl -X POST http://127.0.0.1:7410/v1/ask \
  -H "Authorization: Bearer $CLAWMIND_KEY" \
  -H "Content-Type: application/json" \
  -d '{"q":"What did I write about retrieval reranking?","k":6}'
```

### Review the audit log

Every mutation in ClawMind appends a hash-chained record to the audit log. The owner-only `/audit` page renders that log with filters and a one-click chain verifier. Try it locally with both servers running:

```bash
# List recent key rotations and issuances for any user, newest first
curl -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  'http://127.0.0.1:7410/v1/admin/audit?action=keys&limit=10'

# Verify the on-disk chain is intact and grab the current head hash
curl -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  http://127.0.0.1:7410/v1/admin/audit/verify
# {"ok":true,"checked":42,"headHash":"7a6d...c1"}
```

Both endpoints require owner role plus the `audit:read` scope on the key. The page itself is at <http://127.0.0.1:7412/audit>.

### Legal hold

When a workspace is in litigation, scheduled retention sweeps and self-service GDPR erase must be suppressed. The owner-only `/settings/legal-hold` page exposes one switch backed by `/v1/legal-hold`. Try it locally with both servers running:

```bash
# Read current hold status (admin+, audit:read not required)
curl -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  http://127.0.0.1:7410/v1/legal-hold
# {"hold":{"active":false, ...}}

# Impose a hold (owner + MFA step-up required)
curl -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  -d '{"reason":"SEC subpoena","ticket":"LEGAL-2026-042"}' \
  http://127.0.0.1:7410/v1/legal-hold

# Any user-initiated erase now fails closed with the hold metadata
curl -X DELETE -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  -d '{"confirm":"DELETE"}' \
  http://127.0.0.1:7410/v1/me/data
# 409 {"error":"legal_hold_active", "hold":{...}}

# Release the hold (owner + MFA)
curl -X DELETE -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  http://127.0.0.1:7410/v1/legal-hold
```

The UI is at <http://127.0.0.1:7412/settings/legal-hold>. Every impose, update, release, and every blocked delete attempt is written to the hash-chained audit log so an auditor can prove evidence preservation across the lifetime of the matter.

### Workspace freeze (kill switch)

When a workspace needs to be paused during an incident, contract dispute, or offboarding wind-down, an owner can flip a single switch and every mutating endpoint outside a narrow allowlist starts returning HTTP `423 Locked`. Reads, exports, MFA step-up, and sign-out keep working so the customer can still pull their data and an owner can sign in and unfreeze.

UI lives at <http://127.0.0.1:7412/settings/workspace-freeze>. Sample API calls:

```bash
# Read current freeze state (admin+).
curl -s -H "Authorization: Bearer $CLAWMIND_KEY" \
  http://127.0.0.1:7410/v1/workspace/freeze

# Activate freeze (owner-only, MFA step-up).
curl -s -H "Authorization: Bearer $CLAWMIND_KEY" \
  -H 'content-type: application/json' \
  -d '{"reason":"security incident","ticket":"SEC-2026-009"}' \
  http://127.0.0.1:7410/v1/workspace/freeze

# Release.
curl -s -X DELETE -H "Authorization: Bearer $CLAWMIND_KEY" \
  http://127.0.0.1:7410/v1/workspace/freeze
```

While frozen, any blocked request emits a `workspace-freeze.denied` audit entry so support can correlate user-reported errors with the freeze. The freeze state surfaces in `GET /v1/admin/overview` so an enterprise reviewer can see a workspace pause from the same one screen they use for SSO, MFA, and IP allowlist status. Gated by the new `workspace-freeze:read` / `workspace-freeze:admin` API key scopes.

### Workspace MFA enforcement

Per-user MFA exists, but SOC 2 CC6.6 and most procurement questionnaires ask whether the workspace can *require* MFA for every member, not just hope each member enrols. An owner can now flip a single switch at <http://127.0.0.1:7412/settings/mfa-policy> and every signed-in human is required to have confirmed TOTP MFA before any mutating endpoint will accept their session. Non-MFA sessions receive `HTTP 412 Precondition Failed` with a stable `mfa_enrollment_required` body and an `enrollUrl` so SDKs route the user to `/settings/mfa` without parsing English. A configurable grace window (default 7 days, max 90) gives existing members time to enrol after the policy is enabled so flipping the switch never bricks a live workspace. API key callers are exempt by design: their security model is per-key scopes + per-key IP allowlist + per-key rate limits, all enforced elsewhere.

```bash
# Read current policy (admin+).
curl -s -H "Authorization: Bearer $CLAWMIND_KEY" \
  http://127.0.0.1:7410/v1/mfa-policy

# Turn enforcement on with a 7-day grace window (owner-only, MFA step-up).
curl -s -X PUT -H "Authorization: Bearer $CLAWMIND_KEY" \
  -H 'content-type: application/json' \
  -d '{"enforced":true,"graceDays":7}' \
  http://127.0.0.1:7410/v1/mfa-policy

# Turn enforcement off.
curl -s -X DELETE -H "Authorization: Bearer $CLAWMIND_KEY" \
  http://127.0.0.1:7410/v1/mfa-policy
```

Every enable, disable, and every blocked write is written to the hash-chained audit log (`mfa-policy.enable`, `mfa-policy.disable`, `mfa-policy.denied`) so a compliance reviewer can prove the property was in force for any time window. Gated by the new `mfa-policy:read` / `mfa-policy:admin` API key scopes.

### Workspace session lifetime policy

Every enterprise security questionnaire asks whether the workspace can cap how long a signed-in browser session stays valid and how long it can sit idle. Per-user sign-out is necessary but not sufficient: until the workspace itself guarantees the property for every member, the answer is "we hope so". An owner can now set two caps at <http://127.0.0.1:7412/settings/session-policy>:

- `maxLifetimeMinutes` is the absolute cap from session creation. Older sessions are revoked on the next request and the user has to sign in again.
- `idleTimeoutMinutes` is the cap from the session's last seen request. Idle laptops time out without depending on the cookie's natural expiry.
- `maxConcurrentSessions` caps how many active browser sessions one user can hold at the same time. When a user signs in past the cap, the oldest active session is evicted as a revoked tombstone so the displaced browser sees a clean `401 session revoked` instead of staying silently logged in. Set to `0` to disable the cap.

Either value at `0` means "unset" for that axis, matching the convention used by the other policy files in this repo. A session that has aged past the policy is permanently revoked the moment it tries to make a request, not just signed out for that one process, so the cookie cannot be replayed. The auth preHandler does the check on every request behind a 1 second cache, so flipping the switch in one tab is visible across the workspace within a second. API key callers are exempt by design; rotate or revoke keys instead.

Try it:

```sh
# read the current policy (admin+)
curl -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  http://127.0.0.1:7410/v1/session-policy

# 1 day max lifetime, 1 hour idle timeout, 3 concurrent sessions per user
curl -X PUT -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"maxLifetimeMinutes":1440,"idleTimeoutMinutes":60,"maxConcurrentSessions":3}' \
  http://127.0.0.1:7410/v1/session-policy
```

Every update writes a before/after diff to the hash-chained audit log under `session-policy.update`, every revocation triggered by the policy writes `session.policy.expired` with the reason (`lifetime-exceeded` or `idle-timeout`), the limit, and the request id, and every concurrent-cap eviction writes `session.evicted.concurrent-cap` with the displaced session id, user-agent, and IP, so a compliance reviewer can prove the property was in force for any time window. Gated by the new `session-policy:read` / `session-policy:admin` API key scopes.

### Workspace API key issuance policy

Enterprise security teams ask the same set of questions about machine credentials on every review: can the workspace cap the maximum TTL of any API key, can it forbid never-expire keys, can it limit how many active keys one user holds, can it forbid the wildcard scope, and can it surface keys that are overdue for rotation? Per-key revoke and per-key rate limits are necessary but not sufficient; until the workspace itself enforces these properties on the issue path, the answer is "we hope so". An owner can now set them all in one place at <http://127.0.0.1:7412/settings/api-key-policy>:

- `maxTtlMinutes` caps `ttlMs` at issuance. 0 disables the cap.
- `requireExpiry` rejects never-expire keys (needs a non-zero max TTL so callers always have a legal value).
- `maxActiveKeysPerUser` caps non-revoked, non-expired keys one user may hold.
- `maxScopesPerKey` caps the scope array length at issuance.
- `allowWildcardScope` when false rejects `*` and forces explicit scopes.
- `forcedRotationDays` flags keys older than this on the `/v1/keys` list as `needsRotation: true` so operators can rotate before an auditor flags them.

A fresh deployment defaults every knob to permissive so existing users see no change; owners opt in. The check runs before the secret is minted so a rejected request leaves no credential in the store, and every denial is written to the hash-chained audit log under `api_key.issue.denied` with the reason, the offending field, and the policy limit. Existing keys are never revoked retroactively; rotation is the mitigation, not the trap.

Try it:

```sh
# read the current policy (admin+)
curl -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  http://127.0.0.1:7410/v1/api-key-policy

# 90 day cap, require expiry, max 5 keys per user, no wildcard, 30 day rotation
curl -X PUT -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"maxTtlMinutes":129600,"requireExpiry":true,"maxActiveKeysPerUser":5,"allowWildcardScope":false,"forcedRotationDays":30}' \
  http://127.0.0.1:7410/v1/api-key-policy
```

Gated by the new `api-key-policy:read` / `api-key-policy:admin` API key scopes; mutations require owner + MFA step-up to match the rest of the workspace-security family.

### API key inactivity sweep

SOC2 CC6.1 and ISO 27001 A.9.2.5 both require that credentials not used for an extended period are reviewed and revoked. ClawMind ships this as an opt-in workspace policy with a manual or scheduled sweep:

- `idleDays`: revoke active keys whose last successful use is older than this. Anchor falls back from `lastUsedAt` to `rotatedAt` to `createdAt` so a freshly minted-but-unused key is never assumed eternally fresh.
- `warnDays`: surface keys this close to the threshold without revoking. Powers the at-risk preview in the admin UI.

Owner-only mutations are MFA-stepped. A `dry_run` preview returns the exact set the real sweep would revoke so an operator can sanity-check before pulling the trigger. Every sweep writes an audit-chain entry with the revoked key ids, and `lastSweepAt` / `lastSweepCount` are persisted on the policy so an auditor can prove the control is exercised.

The `/v1/keys` list annotates each key with its inactivity status (`fresh` / `warn` / `expired`) and the projected `willRevokeAt`, so the canonical admin view shows dormant credentials without a second fetch. UI at <http://127.0.0.1:7412/settings/api-key-inactivity>.

```bash
# Read the policy, limits, and at-risk counts (admin+).
curl -s -H "Authorization: Bearer $CLAWMIND_KEY" \
  http://127.0.0.1:7410/v1/api-key-inactivity

# Set a 90-day idle threshold with a 7-day warning window (owner + MFA).
curl -s -X PUT -H "Authorization: Bearer $CLAWMIND_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"idleDays":90,"warnDays":7}' \
  http://127.0.0.1:7410/v1/api-key-inactivity

# Preview which keys the next sweep would revoke (no mutation).
curl -s -X POST -H "Authorization: Bearer $CLAWMIND_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"dryRun":true}' \
  http://127.0.0.1:7410/v1/api-key-inactivity/sweep

# Actually revoke every key past the idle threshold (owner + MFA).
curl -s -X POST -H "Authorization: Bearer $CLAWMIND_KEY" \
  -H 'Content-Type: application/json' \
  -d '{}' \
  http://127.0.0.1:7410/v1/api-key-inactivity/sweep
```

Gated by the new `api-key-inactivity:read` / `api-key-inactivity:admin` scopes. Wire the sweep endpoint into a Helm CronJob or systemd timer for hands-off enforcement.

### Workspace policy acceptance (TOS / DPA / AUP)

Procurement and SOC2 reviewers consistently ask for proof that every user has been shown and has affirmatively accepted the current Terms of Service, Data Processing Addendum, and Acceptable Use Policy. ClawMind ships this as a first-class workflow: an owner publishes a versioned policy, and every authenticated request is gated until each user has accepted the latest required version. Refusing or skipping returns `HTTP 451 Unavailable For Legal Reasons` with the unmet policy ids so a UI or script can recover deterministically.

Policies are stored as `kind + title + body` with the body fully hashed (`bodyHash`) for tamper detection. Publishing a changed body produces a new version id; the prior version is preserved so historic acceptances remain verifiable. Acceptances are append-only and capture `userId`, `acceptedAt`, `ip`, and `userAgent` for the compliance record.

The UI lives at <http://127.0.0.1:7412/settings/policies>. Sample API calls:

```bash
# Read the currently-in-force policies (any authenticated caller).
curl -s -H "Authorization: Bearer $CLAWMIND_KEY" \
  http://127.0.0.1:7410/v1/policies

# Read my acceptance status and any unmet required policies.
curl -s -H "Authorization: Bearer $CLAWMIND_KEY" \
  http://127.0.0.1:7410/v1/policies/me

# Publish a new required version (owner role + MFA step-up).
curl -s -H "Authorization: Bearer $CLAWMIND_KEY" \
  -H 'content-type: application/json' \
  -d '{"kind":"dpa","title":"Acme DPA v3","body":"Full policy text...","required":true}' \
  http://127.0.0.1:7410/v1/policies

# Affirmatively accept a policy.
curl -s -X POST -H "Authorization: Bearer $CLAWMIND_KEY" \
  http://127.0.0.1:7410/v1/policies/<policy-id>/accept

# Admin-only: per-policy acceptance counts.
curl -s -H "Authorization: Bearer $CLAWMIND_KEY" \
  http://127.0.0.1:7410/v1/policies/summary
```

The gate is enforced by the `policy-gate` Fastify plugin on every route except a small allowlist (auth, MFA enrollment, sessions, GDPR self-service export and erase, the policy endpoints themselves, and health probes) so users always have a way to reach the accept screen and so a privacy request can never be blocked by an unaccepted policy. Publish and accept actions are written to the hash-chained audit log as `policy.publish` / `policy.accept`. Gated by the new `policies:read` / `policies:write` / `policies:admin` API key scopes.

### Admin console

One owner-only screen at <http://127.0.0.1:7412/admin> that aggregates SSO, MFA, sessions, API keys, webhook health, IP allowlist, retention windows, and the audit head hash so an enterprise security reviewer can sign off without clicking through every settings page. One round trip backs the whole UI:

```bash
# Aggregate tenant security posture in one call
curl -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  http://127.0.0.1:7410/v1/admin/overview
# {"user":{"id":"local","role":"owner"},
#  "mfa":{"enrolled":true,"confirmed":true,"recoveryCodes":10},
#  "sso":{"configured":true,"issuer":"https://accounts.google.com", ...},
#  "sessions":{"active":2,"lastSeenAt":1748...},
#  "apiKeys":{"total":4,"active":3,"revoked":1,"lastUsedAt":1748...},
#  "webhooks":{"configured":2,"deliveriesRecent":18,"failuresRecent":0, ...},
#  "ipAllowlist":{"enabled":true,"rules":3},
#  "retention":{"historyDays":90,"conversationDays":180, ...},
#  "audit":{"headHash":"7a6d...c1","verified":true,"recentEvents":42}}
```

Gated by owner role plus the new `admin:read` scope; the fetch itself writes an `admin.overview` row to the hash-chained audit log.

### Manage workspace members

Visit <http://127.0.0.1:7412/settings/members> as the owner to invite teammates and assign roles. Same model from the API:

```bash
# List members (admin+ required)
curl -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  http://127.0.0.1:7410/v1/members

# Pre-register a teammate by the user id their SSO provider issues
curl -X POST -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"userId":"oidc:google-oauth2|11234","role":"admin","email":"ada@example.com"}' \
  http://127.0.0.1:7410/v1/members

# Promote them later
curl -X PATCH -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"role":"owner"}' \
  http://127.0.0.1:7410/v1/members/oidc:google-oauth2%7C11234

# Or dry-run a removal to see what would happen without doing it
curl -X DELETE -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  'http://127.0.0.1:7410/v1/members/oidc:google-oauth2%7C11234?dry_run=true'
```

Gated by the `members:read` and `members:admin` scopes. Mutations require an MFA step-up. The last owner cannot be demoted or removed; admins cannot mint or demote owners; every change writes a before/after diff to the audit log.

### Offboarding cleanup

Visit <http://127.0.0.1:7412/settings/offboarding> as the owner. Removing a member already revokes every API key and active session that member owned in the same operation, so this page should normally be empty. It exists to catch historical orphans (keys minted before the sweep landed, or any key whose owning userId has since left the registry):

```bash
# List orphaned API keys (admin+, offboarding:read)
curl -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  http://127.0.0.1:7410/v1/offboarding/orphans

# Revoke a specific orphan (owner-only, MFA-stepped, offboarding:admin)
curl -X POST -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  http://127.0.0.1:7410/v1/offboarding/orphans/key_abc123/revoke
```

The response from `DELETE /v1/members/:userId` and `DELETE /scim/v2/Users/:id` now includes an `offboarding` block reporting how many keys and sessions were revoked, and a dedicated `members.offboarding.sweep` audit row records the revoked key ids so a reviewer can confirm the membership change and the credential cleanup happened atomically.

### Email-bound workspace invitations

For real onboarding the operator rarely knows the OIDC `sub` of the invitee. The `/settings/invitations` page (owner and admin only) mints a single-use, email-bound token that pre-binds the role; the invitee clicks the link, authenticates with that same email, and is added to the workspace.

```bash
# Mint an invite (returns the raw token exactly once)
curl -X POST -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","role":"admin","ttlMs":604800000}' \
  http://127.0.0.1:7410/v1/invitations
# => { "invitation": { ... }, "token": "<once-only>", "acceptUrl": "/invitations/accept?token=..." }

# List pending / accepted / revoked / expired invites
curl -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  http://127.0.0.1:7410/v1/invitations

# Revoke a pending invite
curl -X DELETE -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  http://127.0.0.1:7410/v1/invitations/inv_abc123
```

Gated by `invitations:read` and `invitations:admin` (plus MFA step-up for mutations). Tokens are stored as sha256 digests, never raw. Acceptance fails closed if the authenticated email does not match the invited address, so a forwarded link cannot be redeemed by someone else. Every create, revoke, and accept writes a before/after diff into the hash-chained audit log.

### Domain auto-join policies

For large rollouts the operator does not want to send one invite per seat. The owner-only `/settings/domains` page lists verified email domains and the default role to assign to any brand-new sign-in from that domain. Policies only ever assign `member` or `viewer`; promotion to `admin` or `owner` still requires an explicit invite, and existing accounts are never silently re-roled.

```bash
# Preview the change before committing (dry-run, no write)
curl -X PUT -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"dryRun":true,"policies":[{"domain":"acme.com","role":"member","enabled":true}]}' \
  http://127.0.0.1:7410/v1/domain-policies

# Atomic replace of the entire policy table
curl -X PUT -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"policies":[{"domain":"acme.com","role":"member","enabled":true},{"domain":"partners.io","role":"viewer","enabled":true}]}' \
  http://127.0.0.1:7410/v1/domain-policies

# List current policies
curl -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  http://127.0.0.1:7410/v1/domain-policies
```

The UI lives at <http://127.0.0.1:7412/settings/domains>. Gated by `domain-policies:read` and `domain-policies:admin` (plus MFA step-up on `PUT`). The list is capped at 50 entries, domains are case-insensitive, and every replace writes a before/after diff into the hash-chained audit log.

### SCIM 2.0 provisioning

Owner mints a workspace bearer token at <http://127.0.0.1:7412/settings/scim> (MFA stepped, plaintext shown once). Point your IdP at `http://127.0.0.1:7410/scim/v2`.

Try it:

```bash
# Discovery (no auth required, per SCIM 2.0)
curl http://127.0.0.1:7410/scim/v2/ServiceProviderConfig

# Provision a user (replace scim_... with the token from /settings/scim)
curl -X POST http://127.0.0.1:7410/scim/v2/Users \
  -H 'authorization: Bearer scim_xxx' \
  -H 'content-type: application/scim+json' \
  -d '{
    "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
    "userName": "alice@acme.com",
    "active": true,
    "emails": [{"value": "alice@acme.com", "primary": true}],
    "urn:ietf:params:scim:schemas:extension:clawmind:2.0:User": {"role": "member"}
  }'
```
