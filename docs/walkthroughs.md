# Walkthroughs

Guided tours of the web UI and the matching API calls, beyond the [Quick start](../README.md#quick-start).

Requirements: Node 20.10+, pnpm 9, Python 3.11+ (for the embed sidecar), and an OpenAI-compatible chat endpoint reachable at `CLAWMIND_LLM_PRIMARY_URL`.

```bash
git clone https://github.com/Sanjays2402/clawmind.git
cd clawmind
pnpm install
cp .env.example .env

# Start the MLX embed sidecar (port 7411)
cd packages/embed/python
pip install -r requirements.txt
python server.py &
cd -

# Start API (7410) + Web (7412) + CLI in watch mode
pnpm dev

# In another shell, index your workspace
pnpm clawmind ingest ~/.openclaw/workspace

# Ask something
pnpm clawmind ask "what did I decide about the embed model last week?"
```

The web UI is at <http://127.0.0.1:7412>. The API listens on <http://127.0.0.1:7410>. Data (LanceDB, BM25 index, manifest, audit log) is written to `CLAWMIND_DATA_DIR` (default `./data`).

The full CLI reference — all 18 commands with their subcommands and key flags — is in [docs/cli.md](cli.md).

Or check the live SSO configuration the API has loaded. Use this for a procurement / IT review when you need to prove that `CLAWMIND_AUTH_MODE=oidc` is enforced and that the deployment is pointed at the right issuer and allowed domains. The endpoint never returns the client secret:

```bash
curl http://127.0.0.1:7410/auth/sso/config
# {"enabled":true,"enforced":true,"issuer":"https://accounts.google.com",
#  "clientId":"...","redirectUri":"https://your-host/auth/oidc/callback",
#  "allowedDomains":["acme.com"],"scopes":"openid email profile","mode":"oidc"}
```

The same data is rendered at <http://127.0.0.1:7412/settings/sso>, which also offers a Continue-with-SSO button that round-trips through `/auth/oidc` to your IdP and back through `/auth/oidc/callback` so you can confirm the full flow before handing the URL to your security team.

### Try it in 30 seconds

Ingest the bundled sample knowledge pack and open the live demo page. It ships three preloaded sample questions you can click to see real retrieval, streaming answers, and inline citation chips against your local model. Each citation in the answer is clickable: it highlights the matching source card in the rail and scrolls it into view, and clicking a source card lights up every citation in the answer that points at it.

```bash
pnpm clawmind ingest ./samples
pnpm dev
open http://127.0.0.1:7412/demo
```

Or open the retrieval explain page at <http://127.0.0.1:7412/explain> to see why each chunk was picked: raw BM25, raw dense cosine, normalised values, hybrid blend, lexical rerank, and MMR rank are all rendered as side-by-side bars. Sliders let you tune alpha, lambda, and k and re-run the same pipeline /v1/ask uses, without spending an LLM call.

Or browse <http://127.0.0.1:7412/history> to search every past question, expand the full answer with its cited source excerpts, and click "Ask again" to re-run any of them in the chat. Free-text and namespace filters call the same `/v1/history` endpoint server-side so the page stays fast even with thousands of entries:

```bash
curl 'http://127.0.0.1:7410/v1/history?q=kernel&namespaces=memory&limit=20'
```

Tag a past question, then narrow History to just that tag (also surfaced as clickable chips at the top of <http://127.0.0.1:7412/history>):

```bash
curl -X PUT 'http://127.0.0.1:7410/v1/history/<id>/tags' \
  -H 'content-type: application/json' \
  -d '{"tags":["travel","research"]}'

curl 'http://127.0.0.1:7410/v1/history?tags=travel&limit=50'
```

Rename a noisy question to something you can scan in a list. Send an empty title to revert to the original query:

```bash
curl -X PATCH 'http://127.0.0.1:7410/v1/history/<id>' \
  -H 'authorization: Bearer <api-key-with-history:write>' \
  -H 'content-type: application/json' \
  -d '{"title":"Q3 launch plan"}'
```

Or open <http://127.0.0.1:7412/conversations> to find any past thread by title or by something you (or the assistant) said inside it. The search box is debounced, hits show a highlighted snippet of the matching turn, results paginate at 25 per page, and pressing `/` from anywhere on the page jumps focus into the search field. The same endpoint backs every query:

```bash
curl 'http://127.0.0.1:7410/v1/conversations?q=snip&limit=25&offset=0'
```

Or open <http://127.0.0.1:7412/welcome> on a fresh account for the three-step first-run guide. The page reads per-user progress from `/v1/onboarding`, marks each step done as you complete the underlying product action (ingest a source, ask a question, create an API key), and surfaces a one-click button to index the bundled sample pack so a brand new install can be useful in under a minute. The same endpoint powers a future home-page nudge, and progress survives logout:

```bash
# read current onboarding state
curl -s http://127.0.0.1:7410/v1/onboarding | jq '.progress'

# mark a step done manually (the API also auto-marks on real actions)
curl -s -X POST http://127.0.0.1:7410/v1/onboarding/complete \
  -H 'content-type: application/json' \
  -d '{"step":"ingest"}'
```

Or open <http://127.0.0.1:7412/settings> for the account control center: live usage meter, system health, shortcuts to API keys and webhooks, a one-click JSON export of every per-user record, and a type-to-confirm delete that wipes history, conversations, saved items, feedback, and keys for your account. Both lifecycle actions are audit-logged.

```bash
curl -OJ http://127.0.0.1:7410/v1/me/export
# Same bundle as a ZIP with per-table CSVs and a manifest, sized for BI imports and legal hold:
curl -OJ http://127.0.0.1:7410/v1/me/export.zip
curl -X DELETE http://127.0.0.1:7410/v1/me/data \
  -H 'content-type: application/json' \
  -d '{"confirm":"DELETE"}'

# Sandbox preview: append ?dry_run=true to any destructive endpoint to see
# exactly what would happen without touching storage. Procurement and SRE
# teams use this to rehearse a delete before signing off on it. The audit log
# records the preview under '<action>.dry_run' so previews never get confused
# with the real thing.
curl -s -X DELETE 'http://127.0.0.1:7410/v1/me/data?dry_run=true' \
  -H 'content-type: application/json' \
  -d '{"confirm":"DELETE"}' | jq
# {
#   "schema": "clawmind.user-deletion-preview.v1",
#   "dryRun": true,
#   "wouldRemove": { "historyItems": 47, "conversations": 12, "savedItems": 3,
#                    "feedbackVotes": 19, "apiKeys": 2 }
# }
# Supported on: DELETE /v1/me/data, DELETE /v1/history, DELETE /v1/notifications,
# DELETE /v1/notifications/:id, DELETE /v1/share/:id, DELETE /v1/webhooks/:id,
# DELETE /v1/keys/:id, DELETE /v1/sessions/:id, plus the existing members,
# invitations, domain-policies, retention, and maintenance previews.

# Read and update your profile (display name, IANA timezone, default model)
curl -s http://127.0.0.1:7410/v1/me | jq '.profile'
curl -s -X PATCH http://127.0.0.1:7410/v1/me \
  -H 'content-type: application/json' \
  -d '{"displayName":"Alice","timezone":"America/Los_Angeles","defaultModel":"gpt-4o-mini"}'
```

Or lock the account down to your trusted networks at <http://127.0.0.1:7412/settings/security>. Add your office egress IP, your VPN range, and any CI runner subnet, flip the switch on, and every request from anywhere else is rejected with a `403 ip_not_allowed`. The settings page itself is exempt so a bad rule can never lock you out, and every denial lands in the audit log:

```bash
# Read the current allowlist + limits
curl -s http://127.0.0.1:7410/v1/ip-allowlist | jq '.'

# Replace the allowlist atomically (PUT, not PATCH) and turn enforcement on
curl -s -X PUT http://127.0.0.1:7410/v1/ip-allowlist \
  -H 'content-type: application/json' \
  -d '{"enabled":true,"rules":[{"cidr":"10.0.0.0/24","label":"vpn"},{"cidr":"203.0.113.7","label":"office"}]}'
```

Or open <http://127.0.0.1:7412> on a phone or in a Chromium browser and use the in-app prompt to install ClawMind as a Progressive Web App. The manifest, icons, and a network-aware offline shell are served from the web app, so a built (`pnpm --filter @clawmind/web build`) deploy gets you home-screen launch, standalone window, and a graceful `/offline` page when the API is unreachable:

```bash
curl -s http://127.0.0.1:7412/manifest.webmanifest | jq '{name, start_url, display}'
```

Or run a batch of questions through `/v1/ask/batch` and get a CSV file back. Paste up to 100 questions into <http://127.0.0.1:7412/batch> or send them straight from the shell. Every row is recorded in history and counts against your monthly quota, so a single curl gives you a reusable spreadsheet of grounded answers.

```bash
printf 'q\nWhat is ClawMind?\nHow does retrieval work?\nWhich embedding model is used?\n' \
  | curl -s -X POST http://127.0.0.1:7410/v1/ask/batch \
      -H 'content-type: text/csv' \
      --data-binary @- \
      -o results.csv && head -1 results.csv
```

Or hit the streaming endpoint directly:

```bash
curl -N -X POST http://127.0.0.1:7410/v1/ask/stream \
  -H 'content-type: application/json' \
  -d '{"q":"Summarize the kernel panic incidents and how the machine was recovered","namespaces":["memory"]}'
```

Or inspect retrieval scoring without calling the LLM:

```bash
curl -s -X POST http://127.0.0.1:7410/v1/explain \
  -H 'content-type: application/json' \
  -d '{"q":"LanceDB hybrid retrieval with MMR","k":5,"hybridAlpha":0.5}' | jq '.candidates[0]'
```

Multi-turn chat at <http://127.0.0.1:7412/conversations> keeps a rolling thread on disk, rewrites follow-ups so retrieval stays on topic, and now streams tokens live so each turn feels responsive. Drive it from the CLI:

```bash
CID=$(curl -s -X POST http://127.0.0.1:7410/v1/conversations \
  -H 'content-type: application/json' -d '{"title":"recap"}' | jq -r .conversation.id)
curl -N -X POST http://127.0.0.1:7410/v1/conversations/$CID/ask/stream \
  -H 'content-type: application/json' \
  -d '{"q":"what changed in projects this week?","namespaces":["memory","projects"]}'
```

For Docker, see `infra/docker/docker-compose.dev.yml` which brings up `redis`, `embed`, `api`, and `web`.

### Export a conversation

Every conversation can be downloaded in three formats from the toolbar on `/conversations/<id>`, or fetched directly:

```sh
curl -OJ http://127.0.0.1:7410/v1/conversations/$CID/export.md
curl -OJ http://127.0.0.1:7410/v1/conversations/$CID/export.json
curl -OJ http://127.0.0.1:7410/v1/conversations/$CID/export.csv
```

Markdown is for humans, JSON keeps the full structured payload with sources and scores, and CSV is one row per turn for spreadsheet review.

### Delete a single history entry

Every row on the History page (`http://127.0.0.1:7412/history`) now has a Delete button next to Copy answer. It confirms once, then removes that single ask from your account log. The list updates immediately and reverts if the request fails, so you can purge a private question or a bad answer without wiping the rest of your history. Other users' entries are never touched, even if an id collides, and the deletion is recorded in the tamper-evident audit log.

The same thing from the shell, scoped to your own entries by the session cookie or an API key with `history:write`:

```bash
curl -X DELETE 'http://127.0.0.1:7410/v1/history/<id>'
```

### Export your history

The History page (`http://127.0.0.1:7412/history`) has an Export menu that downloads every past ask in `.json`, `.csv`, or `.md`. Filters from the search box and namespace pills are passed through, so you only get what you are looking at. The same endpoint is available over the API:

```sh
# Everything
curl -OJ 'http://127.0.0.1:7410/v1/history/export.json'

# Spreadsheet-friendly, only memory + projects, matching "kernel"
curl -OJ 'http://127.0.0.1:7410/v1/history/export.csv?q=kernel&namespaces=memory,projects&limit=500'

# Markdown digest of the last 50 answers
curl -OJ 'http://127.0.0.1:7410/v1/history/export.md?limit=50'
```

### Webhooks

Wire your own service into ClawMind without polling. Register a receiver at <http://127.0.0.1:7412/webhooks>, pick the events you care about, and copy the signing secret (shown once). Every event becomes a real HTTPS POST signed with `X-ClawMind-Signature: t=<unix-ms>,v1=<hex(hmac_sha256(secret, t + "." + body))>`. Failures on 5xx or network errors retry up to three times with exponential backoff, and every attempt lands in the delivery log table on the same page. When a delivery still ends up red after your receiver was fixed, hit the **Redeliver** button on that row to fire the exact same payload at the webhook again. Replayed attempts carry the `X-ClawMind-Redelivery-Of` header so your handler can tell organic events from manual replays.

**SSRF guard.** Receiver URLs are validated at registration AND re-resolved on every delivery attempt. Loopback, RFC1918 (10/8, 172.16/12, 192.168/16), CGNAT (100.64/10), link-local (169.254/16, fe80::/10), unique-local IPv6 (fc00::/7), multicast, reserved ranges, and cloud metadata hosts (169.254.169.254, metadata.google.internal) are all rejected. Re-checking on every attempt defeats DNS rebinding: an attacker cannot register `attacker.example` and later flip the A record to an internal IP. Schemes are restricted to http/https, ports to `CLAWMIND_WEBHOOK_ALLOWED_PORTS` (default 80, 443, 8080, 8443), and userinfo in URLs is refused. Set `CLAWMIND_WEBHOOK_ALLOW_PRIVATE=true` for local development only. Every rejection is written to the audit log as `webhook.blocked` so a security reviewer can see denial attempts.

**Workspace egress allowlist.** SSRF protection answers "can a tenant pivot a webhook into our internal network", which is necessary but not sufficient for enterprise procurement. The next question is "can we lock outbound deliveries to an approved set of receiver domains", and that lives at `/settings/webhook-allowlist`. Owners flip a single switch and declare exact hostnames (`hooks.acme.com`) or wildcard suffixes (`*.events.acme.com`) that webhook URLs are allowed to point at; with the switch on, mismatches are rejected at registration, when an existing webhook is edited, and again on every delivery attempt so tightening the rules immediately stops in-flight deliveries to a revoked receiver. Hosts are normalised (lower-cased, trailing dots stripped, RFC 1123 labels enforced, ports/paths/userinfo refused), duplicates are rejected, and every change is recorded to the hash-chained audit log as `webhook-allowlist.update` with the added / removed host diff. Backed by `GET` / `PUT /v1/webhook-allowlist` and the new `webhook-allowlist:read` / `webhook-allowlist:write` API key scopes, owner-only with MFA step-up on write.

**Workspace event-type allowlist.** The destination allowlist controls *where* webhooks may post; the event allowlist at `/settings/webhook-events-allowlist` controls *what subjects* may be subscribed to at all. The threat model is a compromised admin (or a stolen owner key) registering a sink for `ask.completed` and exfiltrating every answer, question, and cited source the moment they are generated. Owners pick the approved subset from the catalogue (`ask.completed`, `ingest.completed`, `audit.event`) and flip enforcement on; from that point a webhook that includes a denied event is rejected at `POST /v1/webhooks`, blocked on `PATCH /v1/webhooks/:id`, and silently dropped at delivery time so tightening the policy later immediately stops in-flight events from leaving the workspace. Disabled by default (no-op, all events subscribable), per-workspace storage with full cross-tenant isolation, audited as `webhook-events-allowlist.update` with the added / removed event diff. Backed by `GET` / `PUT /v1/webhook-events-allowlist` and the new `webhook-events-allowlist:read` / `webhook-events-allowlist:write` API key scopes, owner-only with MFA step-up on write.

**Zero-downtime secret rotation.** Hit **Rotate secret** on a webhook to mint a fresh signing key without losing a single event. The old secret stays valid for a 24-hour grace window (configurable per call up to 7 days via `graceMs`), and every delivery during the window carries BOTH `x-clawmind-signature` (new) and `x-clawmind-signature-prev` (old) so a receiver in the middle of a rolling deploy can validate either one. When the window closes the old secret is dropped automatically, so a leaked key has a bounded blast radius. The new value is shown exactly once in the UI and in the JSON response, never written back on subsequent list reads, and the rotation is recorded as `webhook.rotate_secret` in the hash-chained audit log. Owner-gated, MFA step-up required, scoped `webhooks:admin`.

Headless flow:

```bash
# Create a subscription; copy the returned `webhook.secret` once.
curl -s -X POST http://127.0.0.1:7410/v1/webhooks \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com/hooks/clawmind","events":["ask.completed"]}'

# Wire the audit log to your SIEM. Subscribe a single endpoint to
# `audit.event` and every record appended to the hash-chained audit log
# (key mints, role changes, GDPR deletes, MFA verifies, SSO logins, ...)
# is POSTed as a signed payload, with retries, in near real time.
curl -s -X POST http://127.0.0.1:7410/v1/webhooks \
  -H 'content-type: application/json' \
  -d '{"url":"https://siem.acme.com/hooks/clawmind-audit","events":["audit.event"]}'

# Fire a synthetic event to validate the receiver.
curl -s -X POST http://127.0.0.1:7410/v1/webhooks/<wh_id>/test

# Inspect recent deliveries (status, attempt, duration, error).
curl -s http://127.0.0.1:7410/v1/webhooks/deliveries | jq '.items[0]'

# Manually replay a past delivery (handy when your receiver was down).
curl -s -X POST http://127.0.0.1:7410/v1/webhooks/deliveries/<dlv_id>/redeliver | jq '.delivery'

# Rotate the signing secret with a 24-hour grace window. The returned
# `webhook.secret` is shown exactly once; deliveries during the grace
# carry both x-clawmind-signature (new) and x-clawmind-signature-prev (old).
curl -s -X POST http://127.0.0.1:7410/v1/webhooks/<wh_id>/rotate-secret \
  -H 'content-type: application/json' -d '{}' | jq

# Check your monthly usage and remaining free-tier quota.
curl -s http://127.0.0.1:7410/v1/usage | jq
```

Open <http://127.0.0.1:7412/usage> for the in-app quota meter with the next reset date.

Verify a delivery from your receiver in Node:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
function verify(secret: string, body: string, header: string) {
  const [t, v1] = header.split(',').map((kv) => kv.split('=')[1]);
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'))
    && Math.abs(Date.now() - Number(t)) < 5 * 60_000;
}
```

## Configuration

### Try the notifications inbox

Open `http://127.0.0.1:3000/notifications` once both apps are running. The badge in the top nav polls `/v1/notifications/unread-count` every 30 seconds. From the API:

```bash
# list notifications (auth required, scope: notifications:read)
curl -s http://127.0.0.1:7410/v1/notifications | jq

# mark everything read (scope: notifications:write)
curl -s -X POST http://127.0.0.1:7410/v1/notifications/read \
  -H 'content-type: application/json' \
  -d '{"all":true}'
```

Notifications are produced automatically when a public share is opened (one row per share, view count updated in place) and when a webhook is auto-paused after repeated delivery failures.

To silence a kind you no longer care about, open `http://127.0.0.1:7412/settings/notifications` and toggle it off, or hit the API directly:

```bash
# read current preferences (scope: notification-prefs:read)
curl -s http://127.0.0.1:7410/v1/notification-preferences | jq

# mute share-view notifications only (scope: notification-prefs:write)
curl -s -X PUT http://127.0.0.1:7410/v1/notification-preferences \
  -H 'content-type: application/json' \
  -d '{"prefs":{"share.viewed":false}}'
```

A muted kind is dropped at the producer (`shouldDeliver()` in `services/notification-prefs.ts`) before any row is written, so the inbox stays clean and existing notifications are untouched.

All env vars are loaded via `envalid` in `packages/config`. See `.env.example`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `CLAWMIND_DATA_DIR` | `./data` | Where LanceDB, BM25, manifest, and audit log live |
| `CLAWMIND_WORKSPACE` | `~/.openclaw/workspace` | Default root passed to `clawmind ingest` |
| `CLAWMIND_LOG_LEVEL` | `info` | pino level |
| `CLAWMIND_API_HOST` | `127.0.0.1` | API bind host |
| `CLAWMIND_API_PORT` | `7410` | API port |
| `CLAWMIND_API_CORS_ORIGIN` | `http://127.0.0.1:7412` | CORS allowlist |
| `CLAWMIND_EMBED_URL` | `http://127.0.0.1:7411` | MLX embed sidecar |
| `CLAWMIND_EMBED_MODEL` | `mlx-community/bge-small-en-v1.5-4bit` | Embedding model id |
| `CLAWMIND_EMBED_DIM` | `384` | Vector dimension; must match the model |
| `CLAWMIND_LLM_PRIMARY_URL` | `http://127.0.0.1:8642/v1` | OpenAI-compatible chat endpoint |
| `CLAWMIND_LLM_PRIMARY_MODEL` | `hermes-agent` | Primary chat model id |
| `CLAWMIND_LLM_FALLBACK_URL` | `http://127.0.0.1:4141/v1` | Fallback chat endpoint (also used for OpenAI embedding fallback) |
| `CLAWMIND_LLM_FALLBACK_MODEL` | `copilot-gpt-4o` | Fallback chat model id |
| `CLAWMIND_AUTH_MODE` | `single-user` | `single-user`, `github`, or `oidc` |
| `CLAWMIND_SESSION_SECRET` | (dev default) | Session cookie secret, 32 bytes in prod |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | empty | Required when `AUTH_MODE=github` |
| `CLAWMIND_ALLOWED_GITHUB_USERS` | empty | Comma list of GitHub logins permitted to log in |
| `CLAWMIND_OIDC_ISSUER` | empty | OIDC issuer URL (e.g. `https://accounts.google.com`); enables `/auth/oidc` |
| `CLAWMIND_OIDC_CLIENT_ID` / `CLAWMIND_OIDC_CLIENT_SECRET` | empty | Required when SSO is configured |
| `CLAWMIND_OIDC_REDIRECT_URI` | empty | e.g. `https://your-host/auth/oidc/callback` |
| `CLAWMIND_OIDC_ALLOWED_DOMAINS` | empty | Comma list of email domains permitted to sign in |
| `CLAWMIND_OIDC_SCOPES` | `openid email profile` | Override OIDC scopes if your IdP needs more |
| `NEXT_PUBLIC_API_URL` | `http://127.0.0.1:7410` | Used by the web app |
| `CLAWMIND_OTEL_ENABLED` | `false` | Enable OTLP traces |
| `CLAWMIND_OTEL_ENDPOINT` | `http://127.0.0.1:4318` | OTLP collector |
| `CLAWMIND_SENTRY_DSN` | empty | Sentry DSN; empty disables the SDK |
| `CLAWMIND_SENTRY_ENVIRONMENT` | `development` | Sentry environment tag |
| `CLAWMIND_SENTRY_RELEASE` | empty | Release tag, usually the git sha |
| `CLAWMIND_SENTRY_TRACES_SAMPLE_RATE` | `0` | Sentry performance trace sampling |
| `CLAWMIND_AUDIT_MAX_BYTES` | `33554432` | Rotate `audit.log` once it exceeds this many bytes; `0` disables in-process rotation |
| `CLAWMIND_AUDIT_KEEP_FILES` | `5` | Rotated audit log generations to retain (`audit.log.1` .. `audit.log.N`) |
