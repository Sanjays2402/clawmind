# Feature catalogue

Every ClawMind feature with its rationale and a copy-paste "try it" recipe. The [README](../README.md) has the short version. API on `http://localhost:7410`, web on `http://localhost:7412`.

- Procurement Security Posture (`/v1/posture`): enterprise procurement reviewers refuse to walk through ten settings panels to confirm a vendor's controls are actually on. ClawMind ships a single owner-gated, `posture:read`-scoped endpoint that returns a vendor-questionnaire-shaped scorecard derived from the live state of every workspace control (SSO, workspace MFA enforcement, workspace IP allowlist, audit chain integrity + SIEM drain, API-key issuance policy, session lifetime policy, share policy hardening, data residency, public Trust Center, workspace freeze). Every row maps to a SOC2 / ISO 27001 control family (CC6.1, CC6.6, CC7.1, CC7.2, CC9.2, etc.), is labelled `pass` / `warn` / `fail`, and carries a remediation pointer (the exact endpoint + payload that flips it to pass). A weighted score (0..100) and `ready` boolean (no fails, <= 2 warns) collapse the report into a single number a buyer can paste into their risk register. The web surface at `/posture` adds a one-click `Export JSON` so procurement automation can ingest the same payload without holding an API key. Distinct from `/v1/admin/overview` (operator counters) and `/v1/trust` (editable marketing): every posture row is computed from the live service state and cannot be over-stated. The fetch is self-audited (`posture.read` row with the score and pass/warn/fail breakdown) so a regulator can prove who pulled the report and when. Four route tests pin auth requirement, reader-role refusal, scoped-key refusal, and a fresh-install report shape (totals add up, SSO fails on a no-OIDC install, audit row is written).

  Try it locally (API on `http://localhost:7410`, web on `http://localhost:7412`):

  ```bash
  # 1. Pull the live posture report (owner + posture:read).
  curl -sS http://localhost:7410/v1/posture \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" | jq

  # 2. Just the score + ready flag for a procurement dashboard widget.
  curl -sS http://localhost:7410/v1/posture \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" | jq '{score, ready, counts}'

  # 3. List every failing control with its remediation hint.
  curl -sS http://localhost:7410/v1/posture \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    | jq '.controls[] | select(.status=="fail") | {id, title, family, remediation}'
  ```

  Or open `http://localhost:7412/posture` to see the scorecard with a one-click JSON export for vendor questionnaires.

- Personal Data Breach Notification Register (GDPR Art. 33 / 34): every EU enterprise procurement DPA in 2024+ either asks "have you ever had a notifiable personal data breach" or asks for a link to your register; ClawMind ships a per-workspace, regulator-grade register backing a public timeline at `/breach-register` and a CSV export at `/v1/breach-register.csv`. Each entry captures the reference id, severity, status, when the breach was discovered, occurred, contained, and closed, the categories of personal data and data subjects involved, approximate record and subject counts, likely consequences, mitigations, and a published DPO contact. Notification status to the supervisory authority and to data subjects is tracked separately as required by Articles 33 and 34 respectively, with the authority's name, the notification timestamp, and (mandatory whenever the controller notified later than 72 hours after discovery, or marked the notification `delayed`) a written delay justification the regulator will ask for. Cross-field validation rejects `contained`/`closed` timestamps earlier than discovery, `closed` status without a `closedAt`, duplicate references, missing notification timestamps when status is `notified`, and missing justification when the 72 h window was missed. The public projection derives a `withinArt33Window` flag from `authorityNotifiedAt - discoveredAt <= 72h` and ships counters for total / open / overdue entries that the buyer's procurement tooling reads first. All mutations are owner-only, MFA-gated, scoped to `breach-register:admin`, support `?dry_run=true`, and write a `breach-register.create|update|delete` audit row with the reference, severity, status, and both notification states so a SIEM drain or webhook subscriber sees every change in real time. The operator GET at `/v1/breach-register/admin` surfaces operator-only fields (`internalNotes`, `updatedBy`) under `breach-register:read`. Fifteen tests pin validation of every required field and enum, the 72 h delay-justification rule, both notification-status invariants, `containedAt < discoveredAt` refusal, persistence across reads, duplicate-reference rejection on create and update, `createdAt` preservation through updates, the public projection stripping `internalNotes`/`updatedBy` and deriving the Art. 33 window flag, reverse-chronological ordering with correct overdue counters, and CSV escaping of values containing commas.

  Try it locally (API on `http://localhost:7410`, web on `http://localhost:7412`):

  ```bash
  # 1. Read the public register (no auth, the URL a buyer's DPO will hit).
  curl -s http://localhost:7410/v1/breach-register | jq

  # 2. Download the regulator-ready CSV export.
  curl -s -o breach-register.csv \
    http://localhost:7410/v1/breach-register.csv

  # 3. File a notifiable breach (owner + MFA + breach-register:admin).
  curl -s -X POST http://localhost:7410/v1/breach-register \
    -H 'authorization: Bearer $OWNER_KEY' \
    -H 'x-mfa-token: 123456' \
    -H 'content-type: application/json' \
    -d '{
      "reference":"BR-2026-001",
      "title":"Misconfigured object storage exposed support attachments",
      "summary":"A public-read ACL on the support-attachments bucket exposed redacted ticket files.",
      "severity":"high",
      "status":"contained",
      "discoveredAt":1769817600000,
      "dataCategories":"support ticket attachments, contact details",
      "dataSubjects":"customer admins, end-users referenced in tickets",
      "approxRecords":1234,
      "approxSubjects":412,
      "likelyConsequences":"limited reputational risk; no credentials exposed",
      "mitigations":"revoked ACL, rotated bucket, forced re-auth of affected support agents",
      "authorityNotification":"notified",
      "authorityName":"IE DPC (lead supervisory authority)",
      "authorityNotifiedAt":1770076800000,
      "subjectNotification":"notified",
      "subjectNotifiedAt":1769904000000,
      "contact":"dpo@example.com"
    }' | jq

  # 4. Browse the public page in a browser:
  #    http://localhost:7412/breach-register
  ```

- Per-API-key scheduled activation (`notBefore`): enterprise change-management workflows mint credentials ahead of a planned cutover (vendor go-live, scheduled maintenance, contract start date) and need them to refuse to transact until the chosen moment. ClawMind adds an optional `notBefore` timestamp to every API key, accepted at issuance (`POST /v1/keys` with `{ notBefore }`, owner + MFA + `keys:manage`) or set later via `PUT /v1/keys/:id/activates-at` (same guards). Values are validated to be finite, no more than 365 days ahead, and strictly less than the key's `expiresAt` (a window where the key would expire before it activated is rejected with `409 activation conflict` so a typo cannot mint a permanently dead credential). The auth layer evaluates `notBefore` before usage credit, scope mapping, or per-key rate limits: a pre-activation key is rejected with `401 api key not yet active`, a structured `{ reason: 'not_yet_active', notBefore, waitSeconds }` body, and `X-API-Key-Not-Before` plus `Retry-After` response headers so SDKs can surface a clean error or schedule a retry without polling. Every denial writes an `api_key.not_yet_active.denied` row to the hash-chained audit log with the actor, the route, the request id, and the configured activation timestamp, and the issue + schedule + clear actions all emit audit rows of their own. The `/keys` console surfaces an `activates <date>` badge on any pending key so admins can see at a glance which credentials are scheduled and when. Ten tests pin normalisation (null, past-coerced-to-null, NaN, year-cap), issuance persistence, the `notBefore >= expiresAt` refusal, owner-scoping of the update endpoint, and end-to-end auth-plugin behaviour (denied before activation with the documented headers, authenticates once the moment passes).

  Try it locally (API on `http://localhost:7410`, web on `http://localhost:7412`):

  ```bash
  # 1. Mint a key that goes live in one hour (owner + MFA + keys:manage).
  curl -sS -X POST http://localhost:7410/v1/keys \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -H 'content-type: application/json' \
    -d "{\"label\":\"vendor-cutover\",\"notBefore\":$(($(date +%s%3N)+3600000))}" | jq

  # 2. Using it before activation fails fast with structured headers.
  curl -sS -i -H "Authorization: Bearer $SCHEDULED_KEY" http://localhost:7410/v1/whoami | head -20
  # -> HTTP/1.1 401, X-API-Key-Not-Before: ..., Retry-After: <seconds>

  # 3. Reschedule (or clear with notBefore=null) without re-minting.
  curl -sS -X PUT http://localhost:7410/v1/keys/$KEY_ID/activates-at \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -H 'content-type: application/json' \
    -d '{"notBefore":null}' | jq
  ```

  Or open `http://localhost:7412/keys` to see the `activates <date>` badge on any pending key.

- Per-API-key HTTP method allowlist: enterprise reviewers regularly demand a credential that is provably read-only at the wire, independent of scopes. ClawMind adds an `allowedMethods` policy to every API key, set through `PUT /v1/keys/:id/method-allowlist` (owner + MFA + `keys:manage`) with `{ allowedMethods: ['GET','HEAD'] }` (any subset of GET, HEAD, OPTIONS, POST, PUT, PATCH, DELETE; max 8; deduped and upper-cased server-side). The auth layer enforces the allowlist before scope mapping, per-key rate limits, or route handlers run: a disallowed verb returns `405 method not allowed for this key` with an `Allow:` header listing the permitted methods and a structured body `{ error, method, allowedMethods }`, and writes an `api_key.method.denied` row to the hash-chained audit log with the actor, the route, and the configured list. Distinct from scopes: a key with `search:read` and `ingest:write` but `allowedMethods=['GET']` still cannot mutate, so a stolen credential cannot escalate even if the resource scope would permit it. The `/keys` console exposes the control as a method-toggle row with a one-click "Read-only preset" (GET + HEAD); the redacted key list surfaces the active set as `methods GET/HEAD` so admins can audit at a glance.

  Try it locally (API on `http://localhost:7410`, web on `http://localhost:7412`):

  ```bash
  # 1. Pin a CI key to read-only verbs (owner + MFA + keys:manage).
  curl -sS -X PUT http://localhost:7410/v1/keys/$KEY_ID/method-allowlist \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -H 'content-type: application/json' \
    -d '{"allowedMethods":["GET","HEAD"]}' | jq

  # 2. The same key can still read.
  curl -sS -H "Authorization: Bearer $RO_KEY" http://localhost:7410/v1/whoami | jq

  # 3. Any mutation is rejected at the auth boundary with 405 + Allow: GET, HEAD.
  curl -sS -i -X POST http://localhost:7410/v1/ingest \
    -H "Authorization: Bearer $RO_KEY" -H 'content-type: application/json' -d '{}' | head -20
  ```

  Or open `http://localhost:7412/keys` and click "Restrict methods" on the key to manage it from the dashboard.

- Audit inclusion proofs: external auditors and procurement reviewers routinely ask the narrow question "prove this specific event was in your log on this date," which a full chain export does not answer cleanly. ClawMind owners now mint a single-event certificate at `GET /v1/admin/audit/:id/proof` (owner + `audit:read`). The proof embeds the full event, its 1-indexed chronological position across rotated chain files, a snapshot of the chain head hash and length at the moment of issuance, an issuance timestamp, and an HMAC-SHA256 signature over the canonical body. Verification is stateless and offline: any holder of the HMAC secret recomputes SHA-256 over the embedded event (catches tamper of any field) and the HMAC over the certificate body (catches tamper of position, chain head, or issuance time). The verifier lives at `POST /v1/admin/audit/proofs/verify` for in-product use and is fully described in `packages/store/src/audit-proofs.ts` so an auditor with their own toolchain can reimplement it from the schema. Both endpoints write their action to the hash-chained audit log (`audit.proof.issue`, `audit.proof.verify`) with the proof id and event id captured so the act of minting or verifying a certificate is itself part of the tamper-evident trail. The chain is verified before a proof is issued and the route returns `409 chain_not_verified` if the on-disk chain is broken, refusing to anchor a certificate to an inconsistent state. The `/settings/audit-proofs` console exposes both flows: paste an event id to mint and download a certificate, or paste a certificate JSON to get a structured verdict (event hash valid, signature valid, reason on failure, recomputed hash for side-by-side comparison). Six store-package tests pin issuance, offline verification, event-body tamper detection, wrong-secret rejection, position-rewrite rejection, and not-found behaviour; four API-route tests pin the end-to-end issue + verify round-trip, tamper rejection, 404 on unknown ids, and that `audit:read` scope is required.

  Try it locally (API on `http://localhost:7410`, web on `http://localhost:7412`):

  ```sh
  # 1. Find an event id from the audit log (the export route is already documented elsewhere).
  curl -s -H "x-clawmind-key: $KEY" 'http://localhost:7410/v1/admin/audit?limit=1' | jq '.events[0].id'

  # 2. Mint an inclusion proof for that event. Save the JSON; this is the certificate.
  curl -s -H "x-clawmind-key: $KEY" "http://localhost:7410/v1/admin/audit/<event-id>/proof" > proof.json

  # 3. Verify it server-side. Returns { ok, eventHashValid, signatureValid, reason, recomputedEventHash }.
  jq '{proof: .proof}' proof.json | curl -s -X POST -H 'content-type: application/json' -H "x-clawmind-key: $KEY" \
    --data @- http://localhost:7410/v1/admin/audit/proofs/verify
  ```

  Or open `http://localhost:7412/settings/audit-proofs` to mint, download, and verify certificates in the dashboard.

- Indirect prompt-injection policy: every retrieved RAG chunk is scanned BEFORE it is surfaced to the user or the LLM stream emits tokens, so an attacker who poisoned an ingested document (a webpage, a PR description, a shared note) cannot use that chunk to override the system prompt, exfiltrate keys, or trigger DAN-style jailbreaks. The policy ships with seven curated built-in rules covering the OWASP LLM Top 10 indirect-injection class (instruction override, system prompt disclosure, role override, image-tag exfiltration, zero-width payloads, embedded `<system>` tags, exfil keywords). Workspace owners (with MFA step-up) add their own regexes via `POST /v1/prompt-injection-policy/rules` and flip the global mode at `PUT /v1/prompt-injection-policy/mode` between `off`, `monitor` (audit only), `flag` (annotate each affected source with `injectionFlags: [{ruleId, severity, label}]` so the client can render a warning chip), and `block` (refuse `/v1/ask`, `/v1/ask/stream`, `/v1/search` with `422 injection-detected` listing the offending source ids). Every detection writes one audit row per call with `{ mode, sourceCount, sources: [{id, ruleIds, severity}] }` — never the matched excerpt text, so the tamper-evident chain never echoes the rotating jailbreak strings security teams add daily. Built-in rules can be individually disabled per workspace via `DELETE /v1/prompt-injection-policy/rules/:id` without removing the seed for fresh deployments. Backed by new `prompt-injection:read` and `prompt-injection:admin` scopes; admins can list active rules but cannot edit them.

  Try it locally (API on `http://localhost:7410`):

  ```bash
  # 1. Flip the workspace into block mode (owner key with MFA step-up)
  curl -X PUT http://localhost:7410/v1/prompt-injection-policy/mode \
    -H "authorization: Bearer $OWNER_KEY" -H "content-type: application/json" \
    -d '{"mode":"block"}'

  # 2. List the active rule set (seven built-ins seeded on first read)
  curl http://localhost:7410/v1/prompt-injection-policy -H "authorization: Bearer $ADMIN_KEY"

  # 3. Add a workspace-specific rule for a rotated credential prefix
  curl -X POST http://localhost:7410/v1/prompt-injection-policy/rules \
    -H "authorization: Bearer $OWNER_KEY" -H "content-type: application/json" \
    -d '{"pattern":"sk-live-ACME-[A-Z0-9]{16,}","severity":"high","label":"rotated ACME key"}'

  # 4. Any /v1/ask whose retrieved context matches now returns 422 injection-detected
  #    with sourceIds, and a prompt-injection.detected row lands in the audit chain.
  ```

- Dual-control approvals (four-eyes / NIST AC-3(2) two-person integrity): the most destructive admin actions can no longer be executed by a single human, even one with owner + MFA. ClawMind ships a tenant-scoped approval ledger at `GET/POST /v1/dual-control` and per-id `approve`/`reject` endpoints, all owner-gated and MFA-stepped. The first guarded action is `POST /v1/workspace/deletion` (workspace scheduled wipe): on a call without an `X-DualControl-Approval` header the API mints a pending approval and returns `412 Precondition Required` with the id; a second owner approves it in the `/admin/approvals` console; the original caller retries with the header set and the API consumes the approval and runs the action. The service enforces the cross-actor isolation rule in three places — requester != approver, approver != executor, and approvals are bound to a specific (action, resource) pair — so a compromised single owner credential cannot schedule a destructive action even with MFA. Every transition (request, approve, reject, consume, expire) lands in the hash-chained audit log with both human ids so a SOC2 reviewer can reconstruct who asked, who signed, and who pressed go. Approvals carry a TTL clamped to [5 min, 24 h], default 1 h, and are stored at `<dataDir>/dual-control.json` with atomic tmp+rename and the same on-disk shape conventions as `workspace-deletion.json`. Backed by new `dual-control:read` and `dual-control:admin` scopes.

  Try it locally (API on `http://localhost:7410`, web on `http://localhost:7412`):

  ```bash
  # 1. Owner A tries to schedule workspace deletion. Refused, gets approval id.
  curl -sS -X POST http://localhost:7410/v1/workspace/deletion \
    -H "Authorization: Bearer $OWNER_A_KEY" \
    -H 'content-type: application/json' \
    -d '{"reason":"contract exit","ticket":"CS-9"}' | jq
  # => { error: 'dual-control-required', approvalId: 'dca_...', expiresAt: ... }

  # 2. Owner B opens the console and approves (or curl):
  curl -sS -X POST http://localhost:7410/v1/dual-control/$APPROVAL_ID/approve \
    -H "Authorization: Bearer $OWNER_B_KEY" | jq
  open http://localhost:7412/admin/approvals

  # 3. Owner A retries with the approval header. Now it runs.
  curl -sS -X POST http://localhost:7410/v1/workspace/deletion \
    -H "Authorization: Bearer $OWNER_A_KEY" \
    -H "X-DualControl-Approval: $APPROVAL_ID" \
    -H 'content-type: application/json' \
    -d '{"reason":"contract exit","ticket":"CS-9"}' | jq
  ```

- Per-API-key time-of-day window (allowed hours): enterprise security teams routinely require that automation credentials only work during business hours, so a stolen CI key cannot be replayed by an attacker overnight. ClawMind adds an `allowedHours` policy to every API key, set through `PUT /v1/keys/:id/allowed-hours` (owner + MFA + `keys:manage`) with `{ tz, windows:[{ days, startMin, endMin }] }` where `tz` is any IANA timezone, `days` is a list of 0..6 (Sun..Sat), and `startMin` / `endMin` are minutes since midnight. The auth layer evaluates the current wall-clock time in the configured tz on every request: if no window matches, the key is rejected with `403 request outside allowed-hours window for this key` before usage credit, scope mapping, or per-key rate limit decisions run, and an `api_key.hours.denied` row lands in the hash-chained audit log. Unknown timezones at evaluation time fail closed so a corrupted record cannot silently widen access; the validator also rejects overnight windows where end <= start (the buyer splits them into two adjacent windows so the model stays trivially auditable) and dedupes/sorts the `days` array for clean diffs. The `/keys` console exposes the same control as a compact panel with a timezone field, start/end pickers, and a day-of-week toggle row; the redacted key list surfaces the active window so admins can see at a glance which credentials are scheduled.

  Try it locally (API on `http://localhost:7410`, web on `http://localhost:7412`):

  ```bash
  # 1. Bind a CI key to Mon-Fri 09:00..18:00 America/Los_Angeles.
  curl -sS -X PUT http://localhost:7410/v1/keys/$KEY_ID/allowed-hours \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -H 'content-type: application/json' \
    -d '{"allowedHours":{"tz":"America/Los_Angeles","windows":[{"days":[1,2,3,4,5],"startMin":540,"endMin":1080}]}}' | jq

  # 2. A request outside the window is rejected at the auth boundary.
  curl -sSi -H "Authorization: Bearer $CLAWMIND_CI_KEY" \
    http://localhost:7410/v1/whoami | head -1

  # 3. Clear the schedule.
  curl -sS -X PUT http://localhost:7410/v1/keys/$KEY_ID/allowed-hours \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -H 'content-type: application/json' \
    -d '{"allowedHours":null}' | jq

  # Web console.
  open http://localhost:7412/keys
  ```

- Software Bill of Materials (CycloneDX 1.5): every enterprise buyer's vulnerability-management team (Anchore, Snyk, Dependency-Track) needs a stable, machine-readable inventory of what runs in the deployment to reconcile against CISA's KEV catalog (US Executive Order 14028, EU CRA). ClawMind exposes one at `GET /v1/sbom.json` with no authentication so a procurement reviewer can pin the URL in their own record. The component graph is generated at request time from the on-disk `package.json` files across the monorepo (root + `apps/*` + `packages/*`), so a malicious admin cannot quietly drop a vulnerable library from the published SBOM. A small owner-managed attestation overlay (vendor identity, source repository, build commit, notes) layers on top and is stored separately; `POST /v1/admin/sbom/attestation/sign` pins a SHA-256 over the canonical document (timestamp and signature-derived properties stripped, so the signature is reproducible from the published SBOM) and records `signedBy` + component count. Editing the overlay automatically clears any prior signature so a buyer never sees a stale signed-by alongside fresh content. The public `/sbom` web page mirrors the trust-center surface with component counts, the signed attestation, and a one-click download. Backed by the new `sbom:read` (admin+) / `sbom:admin` (owner-only, MFA-stepped) scopes, every mutation lands in the hash-chained audit log with the commit and repository captured so a reviewer can reconstruct the public surface at any point.

- Identity introspection (`/v1/whoami`): SDK and integrator debug endpoint that returns the server's view of the current request as `{ authenticated, via, user, apiKey:{ id, scopes }, elevation, request:{ id, ip, forwardedFor, userAgent, method, url, serverTime } }`. Safe to call anonymously: unauthenticated callers get a 200 with `authenticated:false` instead of a 401 so SDKs can tell apart "no creds" from "bad creds" without special-case error handling. Bearer tokens and cookies are never echoed back in the response. The companion `/settings/whoami` page renders the same envelope as a token / session debugger so a customer integrator can confirm role, scopes, source IP, and the request id the audit log will key on before they open a support ticket. Kubernetes-convention probe aliases `/healthz`, `/livez`, and `/readyz` are exposed alongside the existing `/live`, `/ready`, and `/health` so standard ingress controllers and security scanners work without operator overrides.

  Try it locally (API on `http://localhost:7410`, web on `http://localhost:7412`):

  ```bash
  # Anonymous probe. Returns 200 with authenticated:false.
  curl -sS http://localhost:7410/v1/whoami | jq

  # Confirm what an API key can actually do.
  curl -sS -H "Authorization: Bearer $CLAWMIND_API_KEY" \
    http://localhost:7410/v1/whoami | jq '.apiKey'

  # Web debugger.
  open http://localhost:7412/settings/whoami
  ```

- Data Processing Agreement (DPA) acceptance ledger: enterprise procurement and the buyer's legal team cannot countersign a master services agreement without a Data Processing Agreement that names a specific document version and a signatory of record at the vendor. Hand-signed PDFs in someone's inbox are not auditable; ClawMind ships the canonical DPA text in the codebase under `apps/api/src/services/dpa.ts`, exposes the published versions at the unauthenticated `GET /v1/dpa/versions` (and the full body at `GET /v1/dpa/versions/:id`) so a buyer can diff exact bytes before they sign, and surfaces a public `GET /v1/dpa/status` that procurement reviewers can hit before they have workspace credentials to confirm a DPA is on file and which version. The owner records acceptance through `POST /v1/dpa/accept` with `{ versionId?, signatoryName, signatoryTitle, signatoryEmail, notes? }`; the route is owner-only with MFA step-up at the API and supports `?dry_run=true`. Each acceptance captures the actor user id, the source IP, and the timestamp, embeds the SHA-256 fingerprint of the exact DPA bytes that were accepted so a later text edit cannot silently mutate prior acceptance, and HMAC-SHA256 signs the canonical receipt with a per-install secret persisted next to the ledger (the same scheme the erasure certificates use). Admins read the ledger at `GET /v1/dpa/acceptances`, fetch an exportable portable receipt at `GET /v1/dpa/acceptances/:id/receipt` (returned as an `attachment` JSON download so the buyer's legal team can archive it alongside the countersigned MSA), and re-verify a row server-side via `POST /v1/dpa/acceptances/:id/verify`. Every acceptance writes a structured row to the hash-chained audit log including the version fingerprint, the signatory identity, and the source IP. The `/settings/dpa` console renders the on-file status, the published version history with full body diff, the binding sign form, and the admin ledger with inline verify and one-click receipt download. The regression test suite proves the shipped version fingerprints are stable, validates the binding inputs (required fields, email format, unknown version id), records a real acceptance and proves the signature reverifies, and pins that tampering with the on-disk signature or swapping the signatory email after the fact causes signature verification to fail.

  Try it locally (API on `http://localhost:7410`, web on `http://localhost:7412`):

  ```bash
  # 1. Public discovery. No auth. Procurement reviewers run this before they have credentials.
  curl -sS http://localhost:7410/v1/dpa/versions | jq
  curl -sS http://localhost:7410/v1/dpa/status | jq

  # 2. Pull the full canonical DPA body for the published version.
  VID=$(curl -sS http://localhost:7410/v1/dpa/versions | jq -r '.versions[0].id')
  curl -sS http://localhost:7410/v1/dpa/versions/$VID | jq

  # 3. Owner records acceptance. Owner role + MFA step-up required.
  curl -sS -X POST -H "content-type: application/json" \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -d '{"signatoryName":"Jane Doe","signatoryTitle":"General Counsel","signatoryEmail":"jane@buyer.example"}' \
    http://localhost:7410/v1/dpa/accept | jq

  # 4. Admin downloads the signed receipt for the buyer's legal archive.
  AID=$(curl -sS -H "Authorization: Bearer $CLAWMIND_ADMIN_KEY" \
    http://localhost:7410/v1/dpa/acceptances | jq -r '.acceptances[0].id')
  curl -sS -H "Authorization: Bearer $CLAWMIND_ADMIN_KEY" \
    http://localhost:7410/v1/dpa/acceptances/$AID/receipt -o dpa-receipt.json

  # 5. Re-verify the receipt signature server-side.
  curl -sS -X POST -H "Authorization: Bearer $CLAWMIND_ADMIN_KEY" \
    http://localhost:7410/v1/dpa/acceptances/$AID/verify | jq

  # Web console.
  open http://localhost:7412/settings/dpa
  ```

- Erasure certificates (GDPR Article 17 destruction receipts): every fulfilled DSR erasure request mints a signed, externally-verifiable destruction receipt at `GET /v1/erasure-certificates/:id`. Procurement reviewers at regulated buyers explicitly ask whether the platform can issue a machine-verifiable Article 17 attestation; until now ClawMind tracked the workflow internally but produced no portable artefact. The certificate records the DSR id, workspace id, fulfilling admin, fulfilled-at and issued-at timestamps, the admin scope note describing what was destroyed, a SHA-256 content fingerprint, and an HMAC-SHA256 signature over the canonical payload using a per-workspace secret persisted next to the certificate store. The subject email is never stored in plaintext; only the SHA-256 fingerprint of the lowercased address lands on disk, so the public projection cannot be used to harvest the email of a deletion requester. A subject proves ownership by replaying their email through `POST /v1/erasure-certificates/:id/verify`, which constant-time-compares against the stored fingerprint and returns `{ verified, signatureValid, subjectMatches, revokedAt }`. Storage is append-only: revocation writes a `revokedAt` / `revokedBy` / `revokedReason` triple alongside the original record but never alters the signed payload, and a regression test pins that the signature still verifies after revocation. Issuance is idempotent per DSR id so retrying a fulfilment never produces a duplicate receipt; the admin list at `GET /v1/erasure-certificates` is gated by the new `erasure-certificates:read` scope and admin+ role, and the `/settings/erasure-certificates` console renders every receipt with an inline signature recheck and a one-click JSON download. The full test suite proves tamper detection across every signed field, signature mismatch on a swapped on-disk row, constant-time email matching across case folding, and that the public projection never carries the subject email.

  Try it locally (API on `http://localhost:7410`, web on `http://localhost:7412`):

  ```bash
  # 1. Fulfil an erasure DSR (owner + MFA). Response now includes certificateId.
  curl -sS -X PATCH http://localhost:7410/v1/dsr/$DSR_ID \
    -H "Authorization: Bearer $CLAWMIND_API_KEY" \
    -H 'content-type: application/json' \
    -d '{"status":"fulfilled","note":"All ingested chunks and history rows attributable to the subject have been destroyed."}' | jq

  # 2. Fetch the signed receipt (unauthenticated, the subject only needs the id).
  curl -sS http://localhost:7410/v1/erasure-certificates/$CERT_ID | jq

  # 3. Subject proves ownership without leaking the email in any access log.
  curl -sS -X POST http://localhost:7410/v1/erasure-certificates/$CERT_ID/verify \
    -H 'content-type: application/json' \
    -d '{"subjectEmail":"alice@example.com"}' | jq

  # Admin console.
  open http://localhost:7412/settings/erasure-certificates
  ```

- Warrant canary: every workspace can publish a recurring public attestation at the unauthenticated `GET /v1/warrant-canary` stating that no undisclosed legal process (NSL, gag order, sealed subpoena) has been received since the previous signing. The presence of a fresh attestation is meaningful; the absence (or `stale` / `withdrawn` status) is the signal that something has changed, and procurement reviewers at regulated buyers routinely pin this URL in their own vendor file during security review. Owners configure the cadence (1 to 365 days), a public preamble, and sign each attestation from `/settings/warrant-canary`; every signing records a SHA-256 fingerprint over `statement|attestedAt|cadenceDays` so a buyer can detect a silent edit to a historical record. The current status (`unconfigured` / `active` / `stale` / `withdrawn`) is derived deterministically from `expiresAt` and the optional withdrawal flag so the public surface always agrees with the admin view. Mutations are owner-only with MFA step-up at the route, support `?dry_run=true`, and every signing or withdrawal writes a structured row to the hash-chained audit log. The public projection strips operator-only metadata (`attestedBy`, `withdrawnBy`, `updatedBy`) so an internet-exposed instance cannot leak the user id of the operator who signed; withdrawn entries are preserved in `history` rather than deleted because tampering with a canary timeline is exactly what an attacker would do. A regression test pins that the public view never serialises the attester id, the fingerprint is recomputable from public data, status flips correctly through enable / sign / expire / withdraw, and a withdrawn record is preserved in history.
- Record of Processing Activities (GDPR Article 30): every workspace publishes a register of processing activities at the unauthenticated `GET /v1/ropa` so a buyer's Data Protection Officer can cite a stable URL from their own Article 30 register during their review of the Data Processing Agreement instead of waiting on a manual PDF exchange. Each entry records the activity name, purpose, legal basis (one of the six Article 6(1) bases), data categories, data subjects, storage region, retention, recipients, and any non-EEA transfer mechanism such as SCCs. The public projection deliberately strips operator-only fields (internal notes, `updatedBy`) so an unauthenticated reader can never see private detail; a regression test pins that `publicView` removes notes. Admins read the operator view at `GET /v1/ropa/admin`; owners with MFA step-up add, update, retire, or restore entries via `POST/PATCH/DELETE /v1/ropa/:id`, and tune the public intro, controller contact, and DPO name via `PUT /v1/ropa/settings`. Every mutation writes a structured audit row with before/after diff and fans out a `ropa.changed` in-app notification to every workspace member, satisfying the "advance notice of material changes to processing" clause most enterprise master agreements require; broadcasts are best-effort so a notification failure cannot roll back the register write. Duplicate active names are rejected case-insensitively but a name becomes available again once retired so a renamed activity can be re-disclosed cleanly. The `/settings/ropa` page surfaces the active and retired registers, lets owners disclose, retire, and restore activities, and supports the `dry_run=1` query param on every mutation so an operator can preview a change before committing it.

  Try it locally (API on `http://localhost:7410`, web on `http://localhost:7412`):

  ```bash
  # Public register. No auth. Safe to cite from a buyer's DPA.
  curl -sS http://localhost:7410/v1/ropa | jq

  # Owner discloses a processing activity. Owner role + MFA required.
  curl -sS -X POST -H "content-type: application/json" \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -d '{"name":"Notes ingest","purpose":"Index notes for retrieval","legalBasis":"contract","dataCategories":"note text, embeddings","dataSubjects":"workspace members","storageRegion":"us-east-1","retention":"90 days then erased"}' \
    http://localhost:7410/v1/ropa | jq

  # Admin sees the operator view including internal notes and updatedBy.
  curl -sS -H "Authorization: Bearer $CLAWMIND_ADMIN_KEY" \
    http://localhost:7410/v1/ropa/admin | jq

  # Web UI for the register.
  open http://localhost:7412/settings/ropa
  ```

- API key expiry warnings (SOC2 CC6.1 / ISO 27001 A.9.2.6): every workspace publishes a rotation window so customers integrating against the API see TTL based key expiry coming before it breaks production. The auth layer reads the workspace policy on every successful API key authentication and, when the key is inside the warning window, attaches `X-ClawMind-Api-Key-Expires-At` (ISO timestamp), `X-ClawMind-Api-Key-Expires-In-Days` (integer), and a standard RFC 7234 `Warning: 299 - "API key expires in N days"` header to the response so any SDK can detect the warning without parsing a custom field. The first request that crosses into the window writes exactly one `api-key.expiry_warned` audit row, dedup keyed on the key id and the current `expiresAt` so a rotation that extends the TTL naturally resets the anchor and a future warning fires again. Admins read the policy and the upcoming list at `GET /v1/api-key-expiry` and `GET /v1/api-key-expiry/upcoming`; owners with MFA step up change the window via `PUT /v1/api-key-expiry`, each mutation audited with a before/after diff. The `/settings/api-key-expiry` page surfaces counts (active keys, keys with a TTL, keys expiring soon) and a soonest first list of the upcoming expirations with urgency coloring (red within one day, amber within seven). A regression test pins that the policy defaults to 14 days, that out of range warn days values are rejected, that `classifyKey` returns `off` for never expiring or already revoked or already expired keys and `expiring` only inside the window, that `findUpcomingKeys` ignores keys without a TTL and sorts soonest first, and that `touchExpiryWarning` dedupes per (key, expiresAt) so the audit fires exactly once per crossing and resets when a rotation lifts the expiry.

  Try it locally (API on `http://localhost:7410`, web on `http://localhost:7412`):

  ```bash
  # Owner sets a 14 day warning window. Owner role + MFA required.
  curl -sS -X PUT -H "content-type: application/json" \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -d '{"warnDays":14}' \
    http://localhost:7410/v1/api-key-expiry

  # Admin previews policy + counts.
  curl -sS -H "Authorization: Bearer $CLAWMIND_ADMIN_KEY" \
    http://localhost:7410/v1/api-key-expiry | jq

  # Admin lists every key expiring inside the window, soonest first.
  curl -sS -H "Authorization: Bearer $CLAWMIND_ADMIN_KEY" \
    http://localhost:7410/v1/api-key-expiry/upcoming | jq

  # Any request with a near expiry key returns Warning + expires-in-days headers.
  curl -sSI -H "Authorization: Bearer cm_<a-key-expiring-soon>" \
    http://localhost:7410/v1/health | grep -i 'warning\|expires'

  # Web UI for the policy + upcoming list.
  open http://localhost:7412/settings/api-key-expiry
  ```

- Honeytoken (canary) API keys: mint a key that is never handed to a real caller, plant the secret somewhere an attacker is likely to find it (committed config, CI variable, wrapped device image), and the first request that presents it is rejected as a 401 invalid-api-key while a forensic incident is written with the source IP, route, method, user agent, request id, and timestamp. Canaries never grant access (they are flagged `isCanary` at storage so the auth layer rips the request before any tenant data is touched) and are deliberately hidden from the regular `GET /v1/keys` list so an operator cannot accidentally hand a trap to a developer and burn it. The 401 response shape is identical to the unknown-secret case so an attacker sees no signal that they tripped a trap, but the incident is written synchronously and an `api_key.honeytoken.tripped` audit row is emitted, so any SIEM drain or webhook subscriber picks it up in real time. Owners manage canaries from `/settings/honeytokens`: mint with an optional planter note, see armed vs tripped vs revoked, drill into the per-incident log, and clear after triage. Issuance and revocation require owner role plus MFA step-up; the incident log is admin+. Incidents are ring-buffered at 500 so a flood of probes cannot grow the file unbounded. A regression test pins that canary keys verify positively at the secret layer (so the auth plugin sees them and can record the trip), that canary keys are hidden from `listKeys`, that incidents are stored newest-first, that user-agent strings are truncated to 256 chars, that the ring buffer drops the oldest entries on overflow, and that `clearIncidents` returns the removed count.

  Try it locally (API on `http://localhost:7410`, web on `http://localhost:7412`):

  ```bash
  # Owner mints a canary. Owner role + MFA required. Secret returned once.
  curl -sS -X POST -H "content-type: application/json" \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -d '{"label":"legacy-mobile-build","note":"embedded in the 2021 Android wrapper"}' \
    http://localhost:7410/v1/keys/canary

  # Simulate an attacker presenting the canary. Returns 401, writes an incident.
  curl -sS -H "Authorization: Bearer cm_<the-canary-secret>" \
    http://localhost:7410/v1/ask

  # Read the forensic incident log. Admin+.
  curl -sS -H "Authorization: Bearer $CLAWMIND_ADMIN_KEY" \
    http://localhost:7410/v1/keys/canary/incidents | jq

  # Web UI for armed traps and the incident log.
  open http://localhost:7412/settings/honeytokens
  ```

- Recovery contacts registry (SOC2 CC7.4 / ISO 22301 BCP): every workspace publishes a named escalation list at `GET /v1/recovery-contacts` so a buyer's incident-response runbook always has a routable answer to "who do we call if the workspace owner is unreachable?". Owners manage entries from `/settings/recovery-contacts`: name, role (DPO, Security Lead, on-call SRE, ...), email, optional phone, priority (lower is escalated first), an explicit `publicListed` flag, and operator-only notes that never leave the box. The unauthenticated public projection only surfaces entries marked `publicListed: true` and currently `active`, sorted by priority then name, with operator metadata (notes, id, disclosedAt, updatedBy) stripped, so an org can keep an internal escalation tier private without losing the public surface. Mutations are owner-only with MFA step-up at the route, dry-run via `?dry_run=true`, and every add / update / retire / restore writes a structured row to the hash-chained audit log with a per-field before/after diff (notes excluded so an after-hours Signal number cannot leak through the audit trail). Duplicate active emails are rejected at validation time so a buyer's runbook never resolves to two distinct people behind the same address; retired entries free their email for reuse and remain on the operator view as historical disclosure. A regression test pins the publicListed gate (private entries never surface), the retired-entry gate (a retired public entry disappears from the public view), the priority-then-name sort, the duplicate-email rejection, and the retired-then-restored transition kinds.

  Try it locally (API on `http://localhost:7410`, web on `http://localhost:7412`):

  ```bash
  # Public projection. No auth. Buyer's IR runbook cites this URL.
  curl -sS http://localhost:7410/v1/recovery-contacts | jq

  # Owner adds a DPO and publishes them. Owner role + MFA required.
  curl -sS -X POST -H "content-type: application/json" \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -d '{"name":"Alice Chen","role":"DPO","email":"dpo@example.com","priority":1,"publicListed":true}' \
    http://localhost:7410/v1/recovery-contacts

  # Owner sets the public-page intro + a fallback mailbox.
  curl -sS -X PUT -H "content-type: application/json" \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -d '{"intro":"Escalation list for BCP events.","fallbackEmail":"security@example.com"}' \
    http://localhost:7410/v1/recovery-contacts/settings

  # Admin sees the operator view (private notes, retired entries, updatedBy).
  curl -sS -H "Authorization: Bearer $CLAWMIND_ADMIN_KEY" \
    http://localhost:7410/v1/recovery-contacts/admin | jq
  ```

- Warrant canary (transparency / vendor due-diligence): every workspace can publish a signed, periodically-renewed attestation at `GET /v1/warrant-canary` so a buyer's vendor-review tool can pin one URL and watch for silence. The public projection is unauthenticated (an instance whose canary 401s ends procurement on the spot), exposes the workspace preamble plus the current `statement`, `attestedAt`, `expiresAt`, `cadenceDays`, and a SHA-256 `fingerprint` of the canonicalised statement (operator name, instance domain, attested timestamp, statement body) so the wording cannot be silently rewritten without the fingerprint changing, and strips `attestedBy` / `withdrawnBy` / `updatedBy` from both the current record and the full history list. Status derives from server time: `unconfigured` before first signing, `active` while within cadence, `stale` once `expiresAt` has passed, and `withdrawn` once the current record has been explicitly revoked, so the absence-as-signal is computable by any downstream poller without trusting the operator. Settings (`enabled`, `defaultCadenceDays` 1-365, `preamble` up to 4 KB), new attestations (`statement` up to 8 KB, optional per-signing `cadenceDays` override), and withdrawals (`reason`, audited verbatim) are all owner-only with MFA step-up at the route, support `?dry_run=true`, and every mutation writes a structured row to the hash-chained audit log capturing the attestation id, fingerprint, cadence, and (for withdrawals) the reason. The service refuses to sign while disabled, refuses to double-withdraw, and preserves the full history after a revocation so an operator-side admin GET (`/v1/warrant-canary/admin`) can reconstruct the chain. Eleven regression tests pin the unconfigured-on-fresh-install state, the cadence range, the disabled-signing guard, the stale-after-expiry transition, the withdrawal reason requirement and double-withdraw refusal, the history preservation, the no-`attestedBy`-leak invariant in the public projection, and the recomputable-fingerprint contract.

  Try it locally (API on `http://localhost:7410`):

  ```bash
  # Public projection. No auth. Vendor-review tools pin this URL.
  curl -sS http://localhost:7410/v1/warrant-canary | jq

  # Owner enables the canary, picks a 30-day cadence, sets the preamble.
  curl -sS -X PUT -H "content-type: application/json" \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -d '{"enabled":true,"defaultCadenceDays":30,"preamble":"Signed by the workspace owner."}' \
    http://localhost:7410/v1/warrant-canary/settings

  # Owner signs a fresh attestation. Returns id + fingerprint + expiresAt.
  curl -sS -X POST -H "content-type: application/json" \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -d '{"statement":"No undisclosed legal process has been received since the previous attestation."}' \
    http://localhost:7410/v1/warrant-canary/attestations

  # Owner withdraws the current attestation with an audited reason.
  curl -sS -X POST -H "content-type: application/json" \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -d '{"reason":"Received order under seal; canary withdrawn pending review."}' \
    http://localhost:7410/v1/warrant-canary/withdraw

  # Admin operator view (incl. attestedBy / withdrawnBy / updatedBy).
  curl -sS -H "Authorization: Bearer $CLAWMIND_ADMIN_KEY" \
    http://localhost:7410/v1/warrant-canary/admin | jq
  ```

- Public Ed25519 signing keys (offline verification of canary attestations): every workspace generates a per-instance Ed25519 keypair on first boot (RFC 8032 / RFC 8037), persists the private key as PKCS#8 PEM at `0600` under the data directory, and publishes the public half at the unauthenticated `GET /.well-known/clawmind-signing.json` (JWKS, RFC 7517) and `GET /.well-known/clawmind-signing.pem` (SPKI PEM for `openssl pkeyutl` users). The kid is a 16-byte truncated SHA-256 over the canonical JWK so a procurement reviewer can pin one short string in their vendor file and detect a silent key rotation. Every new warrant canary attestation is now co-signed at issuance: a detached Ed25519 signature is computed over a canonical JSON serialisation of `{id, statement, attestedAt, cadenceDays, expiresAt, fingerprint}` (the signed fields exclude withdrawal so a later revocation does not invalidate the original proof) and the resulting `{signature, kid, alg, digest}` is embedded into the attestation record itself, surfaced on both the public projection and the admin view, and persisted through reload. Pre-signing legacy records load with `proof: null` so verifiers can flag them as legacy-unsigned rather than crash; new records always carry a verifiable proof. Reference verifiers live at `POST /v1/signing/verify` for arbitrary canonical payloads, `POST /v1/warrant-canary/verify` for a full attestation record (the server re-derives the canonical bytes and returns them in the response so an auditor can diff against their own serialiser), `GET /v1/warrant-canary/attestations/:id/verify` for a stored attestation, and `GET /v1/warrant-canary/key-fingerprint` for a tiny pinning helper. The trust center page renders the algorithm, kid, and issue date alongside links to both well-known surfaces. Nine regression tests pin the kid stability across reload, the JWKS shape, sign/verify round-trip, kid-mismatch rejection, and the procurement-relevant invariant that a signature produced by the service verifies against the published PEM using stock `crypto.verify` with no ClawMind code in the loop; integration tests confirm tampering the statement invalidates the proof and that round-tripping through disk preserves both the canonical bytes and verification.

  Try it locally (API on `http://localhost:7410`):

  ```bash
  # Pull the public JWKS. Cache it; the kid is what you pin in your vendor file.
  curl -sS http://localhost:7410/.well-known/clawmind-signing.json | jq

  # Or the PEM, for openssl-based verifiers.
  curl -sS http://localhost:7410/.well-known/clawmind-signing.pem

  # Fetch the current warrant canary; the latest attestation carries a `proof`.
  curl -sS http://localhost:7410/v1/warrant-canary | jq '.current'

  # Ask the server to verify a stored attestation by id.
  curl -sS http://localhost:7410/v1/warrant-canary/attestations/wc_000001/verify | jq
  ```

- Data classification with share-time enforcement (SOC2 CC6.7 / ISO 27001 A.8.2): every cited source path can carry exactly one sensitivity label from a fixed four-level scale (`public`, `internal`, `confidential`, `restricted`) and the workspace owner sets `allowPublicShareUpTo` to cap which labels are permitted in a public `/s/<id>` link. Unlabelled paths fall back to the workspace `defaultLabel` (initially `internal`) so existing content is not silently downgraded the moment the policy is enabled, and an owner can flip the default to `confidential` to quarantine new documents from share-by-default until they are reviewed. The gate lives in `POST /v1/share` after the share-policy check: the route walks every source path in the body, looks up its effective label, and refuses the mint with `403 classification policy denied` the first time a label exceeds the cap. The 403 body and the audit row both name the offending path and label, so a security operator can answer "which document blocked the share" without grepping the source list. Owners manage policy and labels from `/settings/classification`: a single page covers the cap, the default, and a per-path label list with inline relabel and clear. Policy and label mutations require owner role plus MFA step-up and write before/after diffs to the hash-chained audit log; reads are admin+. A regression test pins the four-level rank order, proves an unlabelled path is blocked when the default exceeds the cap, proves an explicit `public` label permits the share, and proves the first violation in a multi-source citation is the one reported back.

  Try it locally (API on `http://localhost:7410`, web on `http://localhost:7412`):

  ```bash
  # Owner sets the cap to "public": only paths explicitly labelled public can be shared.
  curl -sS -X PUT -H "content-type: application/json" \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -d '{"allowPublicShareUpTo":"public","defaultLabel":"internal"}' \
    http://localhost:7410/v1/classification/policy

  # Owner labels one document public so members can share it.
  curl -sS -X PUT -H "content-type: application/json" \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -d '{"label":"public"}' \
    http://localhost:7410/v1/classification/labels/docs%2Fhandbook.md

  # Admin lists every labelled path.
  curl -sS -H "Authorization: Bearer $CLAWMIND_ADMIN_KEY" \
    http://localhost:7410/v1/classification/labels | jq
  ```

- Audit log SIEM drains (SOC2 CC7.2 / ISO 27001 A.12.4.1): workspace owners point the hash-chained audit log at one or more HTTPS sinks from `/audit/drains` and a background worker pushes new events every `CLAWMIND_AUDIT_DRAIN_INTERVAL_MS` (default 30s) without blocking the request that wrote them. Three sink kinds ship out of the box: a generic HMAC-signed POST, `splunk-hec` (sets `Authorization: Splunk <secret>`), and `datadog` (sets `DD-API-KEY`). Every batch is newline-delimited JSON prefixed with a `__clawmind_drain__` envelope (drain id, monotonic sequence, batch timestamp, cursor before/after) and signed with HMAC-SHA256 over the raw body in `X-ClawMind-Signature: sha256=<hex>` so the receiver can authenticate the sender and reject replays. A per-drain cursor (last delivered `ts` + `id`) is persisted to disk, so a restart resumes exactly where it left off and never replays the whole chain. Failed deliveries back off exponentially (capped at one hour) and after six consecutive failures the batch is moved to a bounded dead-letter list, the cursor advances, and the next batch is attempted; the dead-letter list is visible at `GET /v1/audit/drains/:id/dead` so an operator sees a stuck receiver instead of silently dropping audit traffic. All mutations (create, update, rotate-secret, delete, flush) require owner role plus MFA step-up and themselves write an audit row, which then streams back through the drain, giving a regulator a closed loop on "who pointed the audit feed where". Secrets are shown exactly once at create time and on explicit rotation; subsequent reads only surface a 12-hex `secretFingerprint`. The URL guard rejects unsupported schemes, embedded credentials, and loopback/link-local hosts unless `CLAWMIND_ALLOW_LOOPBACK_DRAINS=1`. A regression test posts a real batch through the worker against a fake fetch, recomputes the signature with the secret, and proves the receiver can verify it; a second test runs six failures and asserts the batch is dead-lettered and the cursor advances past it.

  Try it locally (API on `http://localhost:7410`, web on `http://localhost:7412`):

  ```bash
  # Owner creates a drain (MFA step-up required). Secret is returned ONCE.
  curl -sS -X POST -H "content-type: application/json" \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -d '{"kind":"splunk-hec","url":"https://splunk.example.com/services/collector"}' \
    http://localhost:7410/v1/audit/drains
  # -> { "drain": { "id": "drn_...", ... }, "secret": "<64-hex>" }

  # Admin lists drains; secret is replaced by a fingerprint.
  curl -sS -H "Authorization: Bearer $CLAWMIND_ADMIN_KEY" \
    http://localhost:7410/v1/audit/drains | jq '.drains[] | {id, kind, enabled, delivered, dropped, secretFingerprint}'

  # Force a one-shot push for a single drain.
  curl -sS -X POST -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    http://localhost:7410/v1/audit/drains/drn_xxx/flush | jq

  # Receiver-side verification (Node 20+):
  #   const sig = req.headers['x-clawmind-signature'].replace(/^sha256=/, '');
  #   const expected = crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
  #   if (!crypto.timingSafeEqual(Buffer.from(sig,'hex'), Buffer.from(expected,'hex'))) reject();
  ```

- Pre-auth system use notification banner (NIST 800-53 AC-8): workspace owners publish a short banner from `/settings/login-banner` with a title, markdown body, severity, and a `requireAck` toggle. The login page reads it unauthenticated from `GET /v1/login-banner` and renders it before credentials are entered, satisfying FedRAMP, FISMA, and FFIEC requirements that the notice precede authentication. When `requireAck` is on, an auth plugin gates every mutating session request: after sign-in the user must call `POST /v1/login-banner/ack` with the current SHA-256 `bodyHash` once per browser session before any write is accepted. Mutations from a session without a matching ack return `HTTP 412 login-banner-ack-required` with `X-Login-Banner-Ack-Required: 1` and `X-Login-Banner-Hash: <hash>` so the dashboard can redirect to the ack screen, and a `login-banner.denied` row is appended to the hash-chained audit log with actor, route, and request id. Acks are bound to the session id hash and body hash, so changing the banner body invalidates every prior ack and forces a re-acknowledgment on the next request; switching browsers also requires a fresh ack. Reads, the banner and ack endpoints themselves, auth/MFA/sessions flows, and API key callers (a service-account contract, not a per-user consent surface) are exempt. Admins can audit every recorded ack from `GET /v1/login-banner/acks` and the same screen, which lists userId, session id prefix, IP, and timestamp. Disk read errors fail open so a corrupt banner file cannot brick the API. Cross-session isolation is covered by a regression test that proves an ack recorded by session A does not satisfy the gate for session B even when both belong to the same user.

  Try it locally (API on `http://localhost:8787`, web on `http://localhost:3000`):

  ```bash
  # Owner publishes a banner (requires MFA step-up)
  curl -sS -X PUT -H "content-type: application/json" \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -d '{"enabled":true,"title":"System Use Notice","body":"WARNING: Authorized use only. Activity may be monitored.","severity":"warning","requireAck":true}' \
    http://localhost:8787/v1/login-banner

  # The login page reads it without authentication
  curl -sS http://localhost:8787/v1/login-banner | jq

  # Session user attempts a write before acknowledging
  curl -sSi -b cookies.txt -X POST http://localhost:8787/v1/ingest -d '{}' | head -10
  # -> HTTP/1.1 412 Precondition Failed, X-Login-Banner-Ack-Required: 1

  # User acknowledges (the dashboard does this with the bodyHash from /v1/login-banner)
  BODY_HASH=$(curl -sS http://localhost:8787/v1/login-banner | jq -r '.banner.bodyHash')
  curl -sS -b cookies.txt -X POST -H "content-type: application/json" \
    -d "{\"bodyHash\":\"$BODY_HASH\"}" \
    http://localhost:8787/v1/login-banner/ack

  # Admin reads the ack ledger
  curl -sS -H "Authorization: Bearer $CLAWMIND_ADMIN_KEY" \
    http://localhost:8787/v1/login-banner/acks | jq '.totalAcks'
  ```

  Console: <http://localhost:3000/settings/login-banner>.

- API key forced-rotation enforcement at the auth boundary: workspace owners have long been able to set `forcedRotationDays` in the API key policy, but until now the cap was only surfaced as a hint on the `/v1/keys` list view. Over-age keys still authenticated, so a procurement auditor's question ("prove that a credential past the rotation cap cannot transact") had no honest answer. The cap is now enforced inside the auth plugin: after `verifySecret` matches, the workspace policy is consulted and any key whose age (since creation or the last successful rotate) is at or past `forcedRotationDays` is rejected with `401 rotation-required`. The response carries `X-API-Key-Rotation-Required: 1`, `X-API-Key-Age-Days`, and `X-API-Key-Max-Age-Days` so SDKs and CI scripts can detect the case without re-reading the policy endpoint, and a `api_key.rotation.denied` row is appended to the hash-chained audit log with actor, route, IP, age, and the cap. Existing per-key behaviours (IP allowlist, origin allowlist, scope check, custom rate limit) are unaffected because the rotation gate runs before any of them. Setting `forcedRotationDays = 0` (the default for fresh deployments) disables the check, preserving backwards compatibility. The console at `/settings/keys` surfaces a workspace-wide banner stating the current rotation cap and the count of overdue keys, and stamps a red `rotation required` badge on each individual row so an owner can act before the auditor calls. A transient policy-store read error fails open so a corrupt file cannot lock every automation out; the doctor route surfaces the broken file separately.

  Try it locally (API on `http://localhost:8787`, web on `http://localhost:3000`):

  ```bash
  # Owner sets a 90-day rotation cap (requires MFA step-up)
  curl -sS -X PUT -H "content-type: application/json" \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -d '{"forcedRotationDays":90}' \
    http://localhost:8787/v1/api-key-policy

  # Any over-age key now fails with 401 rotation-required and the X-API-Key-* headers
  curl -sSi -H "Authorization: Bearer $STALE_KEY" \
    http://localhost:8787/v1/keys | head -20

  # Owner reads the annotated list to see which keys need rotation
  curl -sS -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    http://localhost:8787/v1/keys | jq '.items[] | select(.needsRotation)'
  ```

  Console: <http://localhost:3000/keys>.

- Sign-in anomaly detection (impossible travel): every successful sign-in (GitHub OAuth and OIDC) is compared against the actor's previous successful sign-in. When the two countries imply travel faster than `IMPOSSIBLE_SPEED_KMH` (default 900 km/h, faster than any commercial flight including layovers) an anomaly row is written to `sign-in-anomalies.json`, an audit row `sign-in.anomaly.detected` is appended to the hash-chained log, and the record surfaces in the console at `/settings/sign-in-anomalies`. Detection is best-effort and never blocks a login: a missing country header or an unknown centroid falls through silently, which avoids locking users out behind a misconfigured reverse proxy. Country resolution reuses the same trusted upstream headers as the geofence (`cf-ipcountry`, `cloudfront-viewer-country`, `x-vercel-ip-country`, `x-country`, `x-geo-country`); distance is computed against an embedded country-centroid table so no external GeoIP database is required. `GET /v1/sign-in-anomalies` returns the calling user's anomalies (scope `sign-in-anomalies:read`); `GET /v1/sign-in-anomalies/all` is admin+ (`sign-in-anomalies:admin`) and exposes the full workspace queue for SOC triage; `POST /v1/sign-in-anomalies/:id/ack` flips a row to acknowledged and writes a `sign-in.anomaly.acknowledged` audit row. Cross-tenant isolation is enforced in the service layer: a non-admin can only see and acknowledge their own anomalies even though every row lives in the same on-disk file. The ring is capped at `MAX_RECORDS` (2000) so a noisy account cannot grow the file unbounded.

  Try it locally (API on `http://localhost:8787`, web on `http://localhost:3000`):

  ```bash
  # Your own anomalies (any authenticated user with sign-in-anomalies:read)
  curl -sS -H "Authorization: Bearer $CLAWMIND_KEY" \
    http://localhost:8787/v1/sign-in-anomalies

  # Workspace-wide queue, admin or higher
  curl -sS -H "Authorization: Bearer $CLAWMIND_ADMIN_KEY" \
    'http://localhost:8787/v1/sign-in-anomalies/all?acknowledged=false&limit=50'

  # Acknowledge a specific anomaly (audits the actor)
  curl -sS -X POST -H "Authorization: Bearer $CLAWMIND_KEY" \
    http://localhost:8787/v1/sign-in-anomalies/$ID/ack
  ```

  Console: <http://localhost:3000/settings/sign-in-anomalies>.

- Vendor support access lockbox: enterprise procurement reviewers require proof that vendor support engineers cannot read a customer workspace unless the customer has explicitly and recently opened a time-bound door. The lockbox is closed by default; while closed, any request bearing `X-Vendor-Support-Token` is rejected with `403 vendor-access-denied` before auth runs, and every API response (every endpoint, including unauthenticated `/healthz`) carries `X-Vendor-Access-Lockbox: closed` so a customer's SIEM can alert on the literal header value. `GET /v1/workspace/vendor-access` (admin+) returns the policy, current grant, and capped history; `PUT /v1/workspace/vendor-access/policy` (owner + MFA) sets `enabled`, `maxDurationSec` (hard ceiling 24h), `requireJustification`, and `requireTicket`; `POST /v1/workspace/vendor-access/grants` (owner + MFA) mints a single time-bounded grant returning the raw token exactly once (only an sha256 hash is persisted, identical contract to API keys) and writes a `vendor-access.grant.create` row with actor, reason, ticket, and expiry to the hash-chained audit log; `DELETE /v1/workspace/vendor-access/grants/current` revokes it. While a grant is active the response header flips to `X-Vendor-Access-Lockbox: open; expires-at=<iso>` and successful uses bump `lastUsedAt` and `useCount` on the grant so an owner can audit usage in real time. Disabling the policy immediately revokes any active grant, the lockbox state is cached for one second to keep the hot-path off disk, and token comparison is constant-time. The console at `/settings/vendor-access` exposes the policy toggle, mint/revoke flow, a live countdown, and the past 25 grants with reason and ticket inline. Read is gated by `vendor-access:read` (admin), writes by `vendor-access:admin` (owner + MFA).

  Try it locally (API on `http://localhost:8787`, web on `http://localhost:3000`):

  ```bash
  # Verify the lockbox is closed on any endpoint, even /healthz
  curl -sSI http://localhost:8787/healthz | grep -i 'x-vendor-access-lockbox'

  # Read current state (admin or higher)
  curl -sS -H "Authorization: Bearer $CLAWMIND_ADMIN_KEY" \
    http://localhost:8787/v1/workspace/vendor-access

  # Open the lockbox with a 1-hour ceiling, require a written reason (owner + MFA)
  curl -sS -X PUT -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -H 'content-type: application/json' \
    -d '{"enabled":true,"maxDurationSec":3600,"requireJustification":true,"requireTicket":false}' \
    http://localhost:8787/v1/workspace/vendor-access/policy

  # Mint a 15-minute grant tied to incident INC-42
  curl -sS -X POST -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -H 'content-type: application/json' \
    -d '{"durationSec":900,"reason":"INC-42 root cause analysis","ticket":"INC-42"}' \
    http://localhost:8787/v1/workspace/vendor-access/grants
  # response: {"grant": {...}, "token": "cmv_..."}   # save this, it is shown once

  # Revoke immediately when support is done
  curl -sS -X DELETE -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    http://localhost:8787/v1/workspace/vendor-access/grants/current
  ```

- Model allowlist: enterprise procurement teams need a contractual guarantee that only approved LLM models ever serve answers in their workspace, even when the router has a fallback chain that could silently switch providers under load. `GET /v1/model-allowlist` (admin+) returns the current policy (`disabled`, `allow`, or `block`) with the configured model ids; `PUT /v1/model-allowlist/mode`, `POST /v1/model-allowlist`, and `DELETE /v1/model-allowlist/:id` are owner-only with MFA step-up. Enforcement runs on `/v1/ask` AFTER the LLM returns its model tag (so a fallback to a non-approved model is caught before the answer is written to history or fanned out to webhooks) and on `/v1/ask/stream` BEFORE the SSE stream opens (so a denied model never produces partial tokens). A non-approved model is rejected with `422 model-not-allowed` and every block writes a `model-allowlist.blocked` row to the hash-chained audit log with the model id, route, and policy mode. `allow` mode with an empty list is fail-closed by design: the console flags it explicitly so an owner cannot accidentally enable a policy that rejects every request. Read is gated by `model-allowlist:read` (admin), writes by `model-allowlist:admin` (owner + MFA). The settings console at `/settings/model-allowlist` exposes the mode toggle, an add/remove form, and the current rule list.

  Try it locally (API on `http://localhost:8787`, web on `http://localhost:3000`):

  ```bash
  # Read the current policy (admin or higher)
  curl -sS -H "Authorization: Bearer $CLAWMIND_ADMIN_KEY" \
    http://localhost:8787/v1/model-allowlist

  # Switch to allow-mode and pin an approved model (owner + MFA)
  curl -sS -X PUT -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -H 'content-type: application/json' \
    -d '{"mode":"allow"}' \
    http://localhost:8787/v1/model-allowlist/mode

  curl -sS -X POST -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -H 'content-type: application/json' \
    -d '{"model":"gpt-4o-mini","label":"prod"}' \
    http://localhost:8787/v1/model-allowlist
  ```

- Sign-in geofence: enterprise security teams routinely require that human sign-ins originate from a known set of countries (HR is in the EU, contractors are in two named LATAM markets, nobody should be completing OAuth from a sanctioned region). `GET /v1/sign-in-geofence` (owner) returns the active policy with limits and the default trusted-header list; `PUT /v1/sign-in-geofence` (owner + MFA) replaces it atomically with an `allow` or `block` list of ISO 3166-1 alpha-2 codes, a `requireCountry` fail-closed flag, and an optional `trustedHeaders` override for non-default reverse proxies. The country is resolved at the GitHub and OIDC callbacks from a trusted upstream header (`cf-ipcountry`, `cloudfront-viewer-country`, `x-vercel-ip-country`, `x-country`, `x-geo-country` by default), evaluated only at sign-in so an existing session is not killed when a member travels, and every block writes a `sign-in.geofence.blocked` row to the hash-chained audit log plus a failure row to the sign-in activity log with the resolved country and reason. The PUT path refuses to enable a policy that would block the caller's own current request unless `confirmSelfLockoutAccepted=true` is passed, so a typo in the policy editor cannot lock the whole workspace out. The console at `/settings/sign-in-geofence` exposes the allow/block toggle, a country chip list with comma-paste support, the fail-closed switch, and a live `What the server sees` probe at `GET /v1/sign-in-geofence/probe` that shows the country, source header, and current decision for the admin's browser before they save. Read is gated by `sign-in-geofence:read` (owner), writes by `sign-in-geofence:admin` (owner + MFA). The management endpoints are deliberately never gated by the policy itself so an owner whose region was just blocked can still recover via an alternate path.

  Try it locally (API on `http://localhost:8787`, web on `http://localhost:3000`):

  ```bash
  # Read current policy (owner key required)
  curl -sS -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    http://localhost:8787/v1/sign-in-geofence

  # Probe what country your reverse proxy is telling us this request came from
  curl -sS -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -H 'cf-ipcountry: US' \
    http://localhost:8787/v1/sign-in-geofence/probe

  # Allow only US and CA sign-ins (owner + MFA)
  curl -sS -X PUT http://localhost:8787/v1/sign-in-geofence \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -H 'content-type: application/json' \
    -d '{"enabled": true, "mode": "allow", "countries": ["US", "CA"], "requireCountry": true}'

  # Or block sanctioned regions while leaving the rest of the world open
  curl -sS -X PUT http://localhost:8787/v1/sign-in-geofence \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -H 'content-type: application/json' \
    -d '{"enabled": true, "mode": "block", "countries": ["CU", "IR", "KP", "SY"]}'

  # Open the geofence console in a browser
  open http://localhost:3000/settings/sign-in-geofence
  ```

- Workspace public share policy: enterprise leak reviews routinely ask "can a workspace owner stop members from minting a public share link, force every link to expire, or cap the maximum link lifetime?" `GET /v1/share-policy` (admin+) returns the active `disableShares`, `requireExpiry`, and `maxTtlDays` knobs; `PUT /v1/share-policy` (owner + MFA) updates them with partial-update semantics and writes a `share-policy.update` row with the full before/after to the hash-chained audit log. The policy is consulted on every `POST /v1/share` through a 1-second hot cache, so flipping the switch in one tab takes effect on the very next mint in another. Denied mints return 403 with a structured `reason` (`shares-disabled`, `expiry-required`, or `ttl-exceeds-cap`) and write a `share.create.denied` audit row that captures the requested TTL and the policy snapshot. The web console at `/settings/share-policy` exposes the three knobs with inline help, disabled-state cascading, and a save button that surfaces validation errors from the API. Read is gated by `share-policy:read` (admin+), writes by `share-policy:admin` (owner + MFA).

  Try it locally (API on `http://localhost:8787`, web on `http://localhost:3000`):

  ```bash
  # Read current policy (admin+ key)
  curl -sS -H "Authorization: Bearer $CLAWMIND_ADMIN_KEY" \
    http://localhost:8787/v1/share-policy

  # Lock sharing down: must expire, max 7 days (owner + MFA required)
  curl -sS -X PUT http://localhost:8787/v1/share-policy \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -H 'content-type: application/json' \
    -d '{"requireExpiry": true, "maxTtlDays": 7}'

  # Kill switch: disable public sharing entirely
  curl -sS -X PUT http://localhost:8787/v1/share-policy \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -H 'content-type: application/json' \
    -d '{"disableShares": true}'

  # Open the policy console in a browser
  open http://localhost:3000/settings/share-policy
  ```

- Customer-managed encryption keys (CMEK / BYOK): an owner-only `/settings/encryption` console that lets a tenant bring their own 32-byte key encryption key (base64 or hex), rotate the workspace data encryption key, and audit every key transition without the server ever logging key material. `GET /v1/encryption` returns the active KEK kind (`internal` or `customer`), a short SHA-256 fingerprint, the active DEK id, and the small roll of archived DEKs so wrapped artifacts stay decryptable across rotations; `POST /v1/encryption/kek` adopts a customer KEK and rewraps every DEK, `DELETE /v1/encryption/kek` returns the workspace to the internal KEK (requires the same KEK material so a rotation can never be done blind), and `POST /v1/encryption/rotate` mints a fresh DEK and archives the previous one. Read is gated by `encryption:read` (admin+) so a compliance operator can quote the active fingerprint in a DPA without being able to rotate; every mutation is `encryption:admin`, owner-only, and MFA-stepped, and writes an `encryption.kek.upload`, `encryption.kek.remove`, or `encryption.dek.rotate` row to the hash-chained audit log with the resulting key id and short fingerprint so a SIEM gets a tamper-evident trail of every key transition.

- Workspace scheduled deletion: enterprise exit clauses (GDPR Article 17 "right to erasure" at the tenant level) require that a customer can put a documented, cancelable timer on the destruction of their entire workspace, see the countdown, and still pull a final export bundle while the clock runs. `POST /v1/workspace/deletion` (owner + MFA) schedules a wipe with a grace window clamped to `[1 hour, 90 days]` (default 7 days), persists `scheduledFor`, `scheduledBy`, the reason, and a ticket reference, and immediately flips the workspace into a pending state where every mutating endpoint outside the allowlist returns HTTP 423. The allowlist keeps reads, MFA step-up, sign-out, the workspace export download, and the deletion endpoint itself open so the customer can pull data and the owner can change their mind. `DELETE /v1/workspace/deletion` cancels and restores writes. After `scheduledFor` passes, an out-of-band operator script runs the actual wipe and posts to `/v1/workspace/deletion/complete` to anchor the completion in the hash-chained audit log. The web console at `/settings/workspace-deletion` shows a live countdown, a cancel button, and a `Mark wipe complete` action that only appears once the window has elapsed. Read is gated by `workspace-deletion:read` (admin+), and every mutation by `workspace-deletion:admin` (owner + MFA).

  Try it locally (API on `http://localhost:8787`, web on `http://localhost:3000`):

  ```bash
  # See current state (admin+ key)
  curl -sS -H "Authorization: Bearer $CLAWMIND_ADMIN_KEY" \
    http://localhost:8787/v1/workspace/deletion

  # Schedule a 24h deletion (owner + MFA required)
  curl -sS -X POST http://localhost:8787/v1/workspace/deletion \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -H 'content-type: application/json' \
    -d '{"graceMs": 86400000, "reason": "contract exit", "ticket": "CS-014"}'

  # Cancel before scheduledFor
  curl -sS -X DELETE http://localhost:8787/v1/workspace/deletion \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY"

  # Open the deletion console in a browser
  open http://localhost:3000/settings/workspace-deletion
  ```

- Sign-in activity log: every login attempt against the API is recorded in a focused, append-only log so a security reviewer doesn't have to grep the global audit chain during an incident. Each record carries the canonical actor, the auth method (`github`, `oidc`, ...), the outcome (`success`, `failure`, `logout`), the source IP, a truncated user-agent, and an optional reason on failure. The self-view at `GET /v1/sign-in-log` is scoped to the caller and is gated by `sign-in-log:read`; the workspace view at `GET /v1/sign-in-log/all` is admin+ and gated by `sign-in-log:admin` because the full feed exposes probing attempts that never resolved to a user. Both endpoints paginate newest-first with a stable cursor. State lives at `data/sign-in-log.json` capped at 5000 rows. The web console renders the same data at `/settings/sign-in-log` with outcome filters and a one-click toggle between the self and workspace views.

  Try it locally (API on `http://localhost:8787`, web on `http://localhost:3000`):

  ```bash
  # My recent sign-ins (session cookie required)
  curl -sS --cookie 'cm.sid=...' http://localhost:8787/v1/sign-in-log

  # Workspace-wide failures only (admin+ API key)
  curl -sS -H "Authorization: Bearer $CLAWMIND_ADMIN_KEY" \
    'http://localhost:8787/v1/sign-in-log/all?outcome=failure&limit=50'

  # Open the activity view in a browser
  open http://localhost:3000/settings/sign-in-log
  ```

- Security Incident Disclosure Log: enterprise procurement (SOC 2 CC7.4, ISO 27001 A.5.24, NIST IR-6) wants a published, machine-readable timeline of past incidents with severity, scope, customer-data impact, and resolution. The public list at `GET /v1/incidents` and the rendered page at `/incidents` are unauthenticated so a buyer's vendor-review tool can crawl them without credentials. Each incident carries `severity` (low / medium / high / critical), `status` (investigating, identified, monitoring, resolved), `startedAt`, `resolvedAt`, `affectedComponents`, a boolean `customerDataImpacted` rendered prominently because it is the single most-asked-about field in any questionnaire, and a chronological update timeline. Operator-only fields (`privateNotes`, `updatedBy`) are stripped from the public projection. Writes are owner-only with MFA step-up: `POST /v1/incidents`, `PUT /v1/incidents/:id`, and `DELETE /v1/incidents/:id` all support a `?dry_run=true` validate-only mode and land an `incidents.create` / `incidents.update` / `incidents.delete` row in the hash-chained audit log with the severity, status, and customer-data-impact bit (never the private notes). State lives at `data/incidents.json`, the admin list at `GET /v1/incidents/admin` is gated by `incidents:read` (admin+), and every write is gated by `incidents:admin` (owner + MFA).

  Try it locally (API on `http://localhost:8787`, web on `http://localhost:3000`):

  ```bash
  # Public timeline, no auth required
  curl -sS http://localhost:8787/v1/incidents

  # Publish a resolved incident (owner + MFA at the API)
  curl -sS -X POST http://localhost:8787/v1/incidents \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY" \
    -H 'content-type: application/json' \
    -d '{
      "title":"Latency spike on /v1/ask",
      "summary":"Elevated p95 for 22 minutes after a deploy.",
      "severity":"medium",
      "status":"resolved",
      "startedAt":"2026-05-31T18:00:00Z",
      "resolvedAt":"2026-05-31T18:22:00Z",
      "affectedComponents":["api"],
      "customerDataImpacted":false,
      "updates":[{"message":"Rolled back deploy.","status":"resolved"}]
    }'

  # Public page and owner console in a browser
  open http://localhost:3000/incidents
  open http://localhost:3000/settings/incidents
  ```

- Break-glass time-bound role elevation: enterprise procurement (SOC2 CC6.3, ISO 27001 A.9.2.3, NIST AC-6(2)) wants temporary privileged access without standing owner credentials. A member or admin files a request at `POST /v1/role-elevation/requests` with `toRole`, a written `reason`, and a bounded `durationMinutes` (5 to 240). An owner other than the requester approves at `POST /v1/role-elevation/requests/:id/approve` with MFA step-up (four-eyes rule). The auth plugin overlays the elevated role on `req.user` for every authenticated request inside the window and drops back automatically once `expiresAt` passes, so no cron is required. Owners can yank a live grant at any time with `POST /v1/role-elevation/requests/:id/revoke`. Every request, approval, denial, and revocation lands in the hash-chained audit log with the elevation id, the role transition, the duration, and the reason text, which is exactly the evidence a procurement reviewer asks for during a privileged-access walkthrough. State lives at `data/role-elevation.json`, listing is gated by `role-elevation:read` (admin+), filing a request by `role-elevation:write`, and approve / deny / revoke by `role-elevation:admin` (owner only).

  Try it locally (API on `http://localhost:8787`, web on `http://localhost:3000`):

  ```bash
  # File a 30-minute elevation request as the current member
  curl -sS -X POST http://localhost:8787/v1/role-elevation/requests \
    -H "Authorization: Bearer $CLAWMIND_KEY" \
    -H 'content-type: application/json' \
    -d '{"toRole":"owner","reason":"Incident #1234 restore","durationMinutes":30}'

  # As an owner with MFA, approve by id
  curl -sS -X POST http://localhost:8787/v1/role-elevation/requests/<id>/approve \
    -H "Authorization: Bearer $CLAWMIND_OWNER_KEY"

  # Browse the settings page in a browser
  open http://localhost:3000/settings/role-elevation
  ```

- Workspace PII redaction policy: owner-managed detector classes (email, phone, SSN, credit card, IPv4 plus custom labelled regex) enforced on every inbound query to `/v1/ask`, `/v1/ask/stream`, `/v1/search`, `/v1/explain` and `/v1/ask/batch` before retrieval or the LLM run. Each class can be `off`, `redact` (rewrite matches in place as `[REDACTED:class]`), or `block` (reject with 422 `pii-blocked`). Credit card matches are Luhn-validated to suppress false positives from order IDs, and SSN / credit_card default to `block` because a partial redaction that misses a single digit still leaks the secret. The policy file lives at `data/pii-redaction.json`, `GET /v1/pii-redaction` is admin+, `PUT /v1/pii-redaction` is owner only with MFA step-up, and every redaction or block writes a `pii-redaction.redacted` / `pii-redaction.blocked` row into the hash-chained audit log with class names and counts only, never the matched substring or the raw query. Gated by the new `pii-redaction:read` / `pii-redaction:admin` API-key scopes.

  Try it locally (API on `http://localhost:8787`, web on `http://localhost:3000`):

  ```bash
  # Read the current policy (admin+)
  curl -sS http://localhost:8787/v1/pii-redaction \
    -H "Authorization: Bearer $CLAWMIND_KEY"

  # Demo: send a query containing an SSN. The policy default rejects with 422.
  curl -sS -i -X POST http://localhost:8787/v1/ask \
    -H "Authorization: Bearer $CLAWMIND_KEY" \
    -H 'content-type: application/json' \
    -d '{"q":"lookup patient 123-45-6789 history"}'

  # Browse the settings page in a browser
  open http://localhost:3000/settings/pii-redaction
  ```

- Workspace CORS origin allowlist: owner-managed list of additional browser origins permitted to call the API on top of the static `CLAWMIND_API_CORS_ORIGIN` baseline. Enterprise customers who embed ClawMind in their own dashboard at `app.acme.com` add the origin themselves rather than file a support ticket, while the vendor still controls the default. The list is read once per CORS preflight from `data/workspace-origin-allowlist.json` (bounded to 64 origins), `GET /v1/workspace-origin-allowlist` is admin+, `PUT /v1/workspace-origin-allowlist` is owner only with MFA step-up, and every change writes a `workspace-origin-allowlist.update` row into the hash-chained audit log with the added and removed origins. Server-to-server callers (no Origin header) are unaffected since CORS only matters to browsers. Gated by the new `origin-allowlist:read` / `origin-allowlist:write` API key scopes.

  Try it locally (API on `http://localhost:8787`, web on `http://localhost:3000`):

  ```bash
  # Read the current workspace-managed origin list (admin+)
  curl -sS http://localhost:8787/v1/workspace-origin-allowlist \
    -H "Authorization: Bearer $CLAWMIND_KEY"

  # Owner adds an internal portal origin (requires MFA-stepped session bearer)
  curl -sS -X PUT http://localhost:8787/v1/workspace-origin-allowlist \
    -H "Authorization: Bearer $CLAWMIND_KEY" \
    -H 'content-type: application/json' \
    -d '{"enabled":true,"rules":[{"origin":"https://app.acme.com","label":"internal portal"}]}'

  # Browse the settings page in a browser
  open http://localhost:3000/settings/workspace-origin-allowlist
  ```

- Trust Center: a public, server-rendered `/trust` page that procurement and security reviewers can cite by URL, backed by an owner-edited profile (summary, security contact, vulnerability disclosure URL, compliance frameworks with status and issued dates, encryption at rest / in transit, data residency, and additional resource links). The unauthenticated `GET /v1/trust` returns the same JSON a buyer's vendor-review tool can ingest into their questionnaire pipeline, while `GET /.well-known/security.txt` is auto-derived from the same profile so vulnerability scanners get an RFC 9116 record without anyone copy-pasting one. The operator console at `/settings/trust` is owner only with MFA step-up; every edit writes a `trust.update` row into the hash-chained audit log. Backed by `GET /v1/trust` (public), `GET /v1/trust/admin` (admin+), and `PUT /v1/trust` (owner+MFA), gated by the new `trust:read` / `trust:admin` API key scopes.

  Try it locally (API on `http://localhost:8787`, web on `http://localhost:3000`):

  ```bash
  # Public trust profile, no auth (cite this URL in your DPA)
  curl -sS http://localhost:8787/v1/trust

  # RFC 9116 security.txt, auto-derived from the trust profile
  curl -sS http://localhost:8787/.well-known/security.txt

  # Owner updates the profile (requires MFA-stepped session bearer)
  curl -sS -X PUT http://localhost:8787/v1/trust \
    -H "Authorization: Bearer $CLAWMIND_KEY" \
    -H 'content-type: application/json' \
    -d '{"summary":"SOC 2 Type II since 2025-01.","securityContactEmail":"security@example.com","vulnerabilityPolicyUrl":"https://example.com/security/disclosure","frameworks":[{"name":"SOC 2 Type II","status":"achieved","issuedAt":"2025-01-15","auditor":"Prescient Assurance","reportUrl":null}],"encryptionAtRest":"AES-256 at the storage layer","encryptionInTransit":"TLS 1.3 for every public endpoint","dataResidency":"us-east-1 by default; EU residency available on request","links":[]}'

  # Browse the public page in a browser
  open http://localhost:3000/trust
  ```

- Hybrid retrieval: LanceDB dense vectors + BM25 lexical, merged with MMR
- Namespaces inferred from path (memory / sessions / projects / docs / misc) for scoped queries
- Streaming and non-streaming `/ask` with cited spans back to source files
- Saved searches with snapshot history so you can diff results over time, plus inline rename, taggable groups, and a tag filter on the Saved page
- Collections: group saved searches into named folders (with an accent color and an optional description) so onboarding playbooks stay separate from incident reviews. The `/collections` page lists every folder with a live count, lets you create, rename, recolor, or delete folders, and opens an inline drawer where you tick saved searches in or out without leaving the page. Backed by `/v1/collections` and `/v1/collections/:id/members`, isolated per user, and gated by the `collections:read` / `collections:write` scopes for API keys
- Pins, mutes, and aliases to bias or exclude paths from retrieval
- Tags on files, browsable as facets
- Search workspace: `/search` runs hybrid retrieval with namespace chips, include and exclude tag filters (auto-completing against your tag library), client-side sort and pagination, recent searches persisted in `localStorage`, and full filter state in the URL so a shared link restores the exact view
- Conversations: multi-turn threads with archive, fork, rename, Markdown export, and full-text search across titles and message content with highlighted snippets, paginated results, and a `/`-to-focus search box
- History export: download every past ask as `.json`, `.csv`, or `.md`, with the same search and namespace filters the History page is showing
- Per-question tags on history: add freeform tags to any past Q&A and filter the History page by one or more tags. Tags live in `history-tags.json` keyed by user, are scoped by the `history:read` / `history:write` API key scopes, and are returned inline on `GET /v1/history` so the page renders in one round trip
- Rename any history entry to a memorable title ("Q3 launch plan", "deck refs") so the History page scans like a notebook instead of a wall of raw questions. Titles are per-user, kept in `history-titles.json`, returned inline on `GET /v1/history`, and editable via `PATCH /v1/history/<id>` (empty title clears the rename)
- Feedback (thumbs / notes) on answers, used to mark good or bad chunks
- Digests: scheduled recurring queries (e.g. "what changed this week in projects/")
- Stale source detection (files indexed but not seen on disk recently)
- Related-document lookup and basic stats / doctor endpoints
- API keys with per-key rate limiting, GitHub OAuth or single-user mode. Each key carries a per-key usage log (`GET /v1/keys/:id/usage`) with 24h and 7d request totals, success vs error split, top routes, the last 10 calls, and a forensic trace that records the source IP and (truncated) User-Agent on every authenticated request so a procurement reviewer can answer "where is this credential being used from?" without grepping the audit chain. The report exposes `byIp` (top source IPs ranked by request count) and `uniqueIps` (distinct addresses ever seen on the key) alongside the existing aggregates, and the `/keys` page renders a Source IPs panel and per-row IP column inline behind the Usage toggle. Legacy log lines from before forensic capture render as `unknown` rather than producing phantom rows. When you mint a new key the issued-secret panel and a permanent reference section at the bottom of `/keys` show copy-pasteable `curl` snippets for `/v1/ask`, `/v1/search`, and `/v1/history` (pre-filled with your real secret on issue, otherwise `$CLAWMIND_KEY`) so a first-time user is one paste away from a working API call.
- Outbound webhooks: register a URL, get signed POSTs on `ask.completed`, `ingest.completed`, and `audit.event`, with automatic retries and a delivery log
- Workspace policy acceptance (TOS / DPA / AUP): an owner-only `/settings/policies` page that lets you publish versioned Terms of Service, Data Processing Addendum, and Acceptable Use Policy text and track who has accepted which version. Publish is owner-only and MFA-stepped; every body change produces a deterministic content-hashed policy id so an in-place edit can never silently rewrite history, and the prior version is preserved (just marked superseded) so an existing acceptance row stays verifiable forever. Until every authenticated user has accepted the currently in-force required versions the API returns `451 Unavailable For Legal Reasons` with the unmet policy ids so the web UI can drive them to the accept screen and an SDK can detect the gate cleanly; auth, MFA, sessions, GDPR self-service, the policy endpoints themselves, and read access to the audit log stay reachable so the gate cannot deadlock the workspace. Every publish and every acceptance writes to the hash-chained audit log with policy id, kind, body hash, and the accepting IP / user-agent so a SOC2 reviewer can reconstruct exactly what each user agreed to and when. Backed by `GET /v1/policies`, `GET /v1/policies/me`, `POST /v1/policies/:id/accept`, `POST /v1/policies`, `GET /v1/policies/acceptances`, and `GET /v1/policies/summary` (admin+ for the last two), gated by the new `policies:read` / `policies:write` / `policies:admin` API key scopes.
- Audit log streaming to your SIEM: subscribe a webhook to the `audit.event` family and every record appended to the hash-chained audit log is fanned out to that endpoint, signed with the same HMAC scheme (`x-clawmind-signature`, `x-clawmind-timestamp`) as the rest of the webhook surface. The payload carries the full persisted event (`id`, `ts`, `actor`, `action`, `resource`, `meta`, `prevHash`, `hash`) so a Splunk/Datadog/Elastic pipeline can ingest a tamper-evident copy in near real time without polling `/v1/admin/audit/export`. Fan-out crosses workspace owners (so a workspace-level SIEM connector sees every actor's audit row), per-subscriber failures are isolated, and a flaky sink is auto-paused after the standard consecutive-failure cap. Forwarding happens after the on-disk append returns, so a downed SIEM can never block or corrupt the audit chain itself.
- Batch ask: paste or upload a CSV of up to 100 questions, get a results table plus a one-click CSV download. Every row is saved to history and counts against the monthly quota.
- Usage meter: per-user monthly request count, free-tier quota with 429 on overrun, and an in-app `/usage` page with reset countdown and upgrade CTA
- Workspace quota policy: an owner-only `/settings/quota` page that caps how many billable `/v1/ask`, `/v1/search`, and `/v1/batch/ask` units the workspace can burn each calendar month. Two independent knobs, a workspace-wide ceiling and an optional per-member ceiling, are enforced pre-call on every billable route: blowing either returns `429 quota exceeded` with `X-RateLimit-*` and `x-clawmind-quota-scope: workspace|user` headers plus a structured body that names the blocker so the client can show "this workspace cap is hit" vs "your seat cap is hit". Blank means unlimited (enterprise / on-prem default); existing installs default to the historical free-tier number so nothing changes until the owner explicitly raises or lowers the cap. The `/v1/usage` response now carries a `workspace` rollup (used, remaining, members active this period, kind breakdown, reset timestamp) so the in-app meter can render the workspace ceiling alongside the per-user one. Backed by `GET /v1/workspace-quota` (admin+) and `PUT /v1/workspace-quota` (owner-only, MFA-stepped), gated by the new `workspace-quota:read` / `workspace-quota:admin` API key scopes, and every change writes a `workspace-quota.update` row into the hash-chained audit log.

  Try it locally (API on `http://localhost:8787`):

  ```bash
  # Read the current policy + this month's workspace rollup
  curl -sS http://localhost:8787/v1/workspace-quota -H "Authorization: Bearer $CLAWMIND_KEY"

  # Cap the workspace at 10k units/month with a 500/month per-member ceiling
  curl -sS -X PUT http://localhost:8787/v1/workspace-quota \
    -H "Authorization: Bearer $CLAWMIND_KEY" \
    -H 'content-type: application/json' \
    -d '{"monthlyLimit":10000,"perUserMonthlyLimit":500}'
  ```
- Workspace quota policy: an owner-only `/settings/quota` page that sets a hard monthly ceiling on ask, search, and batch units across the whole workspace, plus an optional secondary per-member cap so one runaway integration cannot drain the shared budget. Setting the workspace ceiling to blank means unlimited (the enterprise / on-prem default); setting it to a number enforces the cap at the very front of `/v1/ask`, `/v1/ask/stream`, `/v1/search`, and `/v1/batch` so a single rogue API key cannot blow the budget regardless of which member owns it. Over-quota requests get `429 quota exceeded` with `x-clawmind-quota-scope: workspace|user`, `RateLimit-*` headers pointing at the next month boundary, and a body that includes both the per-user and workspace counters so the client can render the right banner. Backed by `GET /v1/workspace-quota` (admin+) and `PUT /v1/workspace-quota` (owner-only, MFA-stepped), gated by the new `workspace-quota:read` / `workspace-quota:admin` API key scopes, and every policy change writes to the hash-chained audit log with actor and the new limits.
- Data subject requests (GDPR Art. 15/17, CCPA §1798.110/.105): a public unauthenticated `POST /v1/dsr/submit` lets a data subject (member or not) file access, erasure, rectification, portability, or restriction requests against the workspace. Submission returns a one-shot verification token; only requests confirmed via `GET /v1/dsr/verify/:id/:token` ever surface on the admin triage queue, blocking spoofed-email pollution of the backlog. Admin+ keys with the new `dsr:read` scope read the queue at `/v1/dsr` and the `/settings/dsr` console; owners with active MFA and `dsr:admin` transition rows through pending, acknowledged, fulfilled, or rejected, with `resolvedBy` / `resolvedAt` anchoring the legally required 30-day response clock. Submitter IP is stored as a truncated salted hash so the queue cannot be repurposed as a third-party tracking ledger; verification tokens are never persisted in plaintext; an inline honeypot drops obvious bot traffic with a fake 202; and every status change is recorded in the existing hash-chained audit log by the audit plugin so a SOC2 reviewer can reconstruct who decided what.
- Record of Processing Activities (GDPR Article 30): an owner-only `/settings/ropa` page that publishes the Article 30 register a buyer's DPO will ask for during procurement. The unauthenticated `GET /v1/ropa` returns the citable JSON (activity name, plain-language purpose, Art. 6(1) legal basis, data categories, data subjects, storage region, retention, recipients, cross-border transfer mechanism, status, disclosed-at) so customer counsel can drop our register into their own without needing an account; the operator view at `GET /v1/ropa/admin` surfaces internal notes and `updatedBy`. Add, update, retire, and restore are owner-only with MFA step-up and support `?dry_run=true` so a procurement reviewer can preview every change before publishing. Every mutation writes a `ropa.add|update|retire` row to the hash-chained audit log with a per-field before/after diff in `meta`, and broadcasts a `ropa.changed` in-app notification to every workspace member so customers get the advance notice that most master agreements require. Retirement is a status flip so the register stays a complete historical record of processing. Backed by the new `ropa:read` / `ropa:admin` API key scopes, de-duplicates active activities by case-insensitive name, and rejects unknown legal bases at the route schema.

  Try it locally (API on `http://localhost:8787`):

  ```bash
  # Public Art. 30 register (no auth, DPA-citable)
  curl -sS http://localhost:8787/v1/ropa

  # Disclose a new processing activity (owner key, MFA-stepped)
  curl -sS -X POST http://localhost:8787/v1/ropa \
    -H "Authorization: Bearer $CLAWMIND_KEY" \
    -H 'content-type: application/json' \
    -d '{"name":"Customer support","purpose":"Answer end-user tickets","legalBasis":"contract","dataCategories":"name, email, message body","dataSubjects":"customers, end-users","storageRegion":"us-east-1","retention":"24 months after ticket closure","recipients":"Zendesk","transferMechanism":"SCCs 2021/914 module 2"}'

  # Preview a retirement without mutating
  curl -sS -X DELETE 'http://localhost:8787/v1/ropa/ropa_xxx?dry_run=true' \
    -H "Authorization: Bearer $CLAWMIND_KEY"
  ```
- Sub-processor registry (GDPR Article 28): an owner-only `/settings/sub-processors` page that maintains the disclosure list your Data Processing Agreement points at. The public, unauthenticated `GET /v1/sub-processors` returns the citable JSON (entity name, purpose, region, public DPA link, status, disclosed-at) so customer counsel can review without needing an account; the operator console at `GET /v1/sub-processors/admin` surfaces internal notes and `updatedBy`. Add, update, retire, and restore are owner-only with MFA step-up and support `?dry_run=true` so a procurement reviewer can preview the change before publishing. Every mutation writes a `sub-processor.add|update|retire` row to the hash-chained audit log with a before/after diff in `meta`, and broadcasts a `sub-processor.changed` in-app notification to every workspace member so customers get the advance notice that most master agreements require. Retirement is a status flip rather than a hard delete so the registry stays a complete historical disclosure record. Backed by the new `sub-processors:read` / `sub-processors:admin` API key scopes and de-duplicates active entries by case-insensitive name.

  Try it locally (API on `http://localhost:8787`):

  ```bash
  # Public DPA-citable list (no auth)
  curl -sS http://localhost:8787/v1/sub-processors

  # Disclose a new sub-processor (owner key, MFA-stepped)
  curl -sS -X POST http://localhost:8787/v1/sub-processors \
    -H "Authorization: Bearer $CLAWMIND_KEY" \
    -H 'content-type: application/json' \
    -d '{"name":"AcmeDB","purpose":"Primary database","region":"us-east-1","website":"https://acme.example/dpa"}'

  # Preview a retirement without mutating
  curl -sS -X DELETE 'http://localhost:8787/v1/sub-processors/sp_xxx?dry_run=true' \
    -H "Authorization: Bearer $CLAWMIND_KEY"
  ```
- Shareable read-only answer links, created in one click from the Share button under any finished chat answer, with per-share OpenGraph cards (dynamic 1200x630 image, Twitter `summary_large_image`, title and snippet) so a pasted `/s/<id>` URL renders as a rich preview in Slack, iMessage, and X. Every link carries an expiry (default 30 days, max 365, chosen at create time) so a leaked URL stops resolving on its own with `410 Gone`; expiry, creation, and revoke are all written to the audit log. The public `/s/<id>` page also renders the cited sources (path, line range, excerpt), the share timestamp, a copy-link button, and a Try ClawMind CTA so first-time viewers can convert into users. The `/shares` page lists every link you created, with view counts, expiry countdown, an Expired badge once the TTL has elapsed, copy-link, and one-click revoke so a leaked URL is easy to kill
- Installable PWA: web app manifest, offline shell, and in-app install prompt so the web UI lives on your home screen with quick shortcuts to Ask, Search, and Saved
- Sandbox preview on every destructive endpoint: append `?dry_run=true` to a DELETE and the server returns the exact counts the real call would report without touching storage. Wired across the GDPR account hard-delete, bulk history prune, bulk and single notification deletes, share revoke, webhook delete, API key revoke, and session revoke, on top of the existing members / invitations / domain-policies / retention / maintenance previews. The audit log records previews under `<action>.dry_run` so an auditor can always tell a rehearsal apart from a real mutation, and the GDPR card on `/settings` exposes a one-click Preview deletion button that itemises history items, conversations, saved items, feedback votes, and keys before you type DELETE.
- Account settings: `/settings` shows your user id and plan, a live usage meter, system health, shortcuts to keys and webhooks, a one-click JSON export of every per-user record, and a type-to-confirm GDPR delete that audit-logs the wipe
- Editable profile: `GET /v1/me` and `PATCH /v1/me` back a display name, IANA timezone, and default model preference per user. The settings page exposes an inline edit form (with a one-click Use local timezone helper) so a returning user can rename themselves, pin their timezone, and lock in a preferred model without leaving the page. Profiles are stored per-user in `profiles.json`, isolated by `userId`, and gated by the `profile:read` / `profile:write` scopes for API keys
- Onboarding: `/welcome` is a three-step first-run guide (ingest a source, ask your first question, create an API key) with per-user server-side progress, a one-click button to index the bundled sample pack, and a dismiss/restore toggle so the guide stops nagging once you are set up
- Storage maintenance UI: an owner-only `/settings/maintenance` page that wraps the two write-side maintenance endpoints behind a real, safe-by-default workflow. The **Compact** card scans the manifest on load and surfaces how many indexed sources no longer exist on disk, lists the first paths inline, and only enables the Compact button when there is actually work to do. The **Bulk forget by pattern** card accepts up to 50 picomatch globs (one per line), runs a dry-run preview that shows the exact source paths and chunk count that would be removed, then unlocks a type-to-confirm `FORGET` gate before the destructive call. Both surfaces route through `POST /v1/maintenance/compact` and `POST /v1/maintenance/forget`, which are owner-only, MFA-stepped, rate-limited to 6 per minute, and append a `maintenance.compact` or `maintenance.forget` event to the hash-chained audit log with actor, patterns, and matched / removed counts so a reviewer can reconstruct what disappeared and why.
- Audit log review: an owner-only `/audit` page that surfaces every mutation written to the hash-chained log. Filter by actor, action substring, resource prefix, and time window, page 50 at a time, expand any row to inspect the raw JSON, and click Verify chain to replay the on-disk hashes and prove the file has not been tampered with. Use the **Export JSONL** or **Export CSV** buttons to stream the full filtered chain straight to disk for SOC2 / regulator pulls that exceed the 1000-row query cap. The same page now records and verifies HMAC-signed *anchors* over the chain head: the hash chain catches in-place edits, but anchors catch what it cannot, truncation (the on-disk tail was deleted) and rewrite (the log was rebuilt to a different past). Each anchor is signed with the server secret, pins the head hash plus the chain length at a point in time, and is append-only in `audit-anchors.jsonl`; verify reports `chain-truncated`, `chain-rewritten`, or `bad-signature` with the offending anchor so an incident responder gets a structured signal instead of silence. Backed by `GET /v1/admin/audit`, `GET /v1/admin/audit/verify`, `GET /v1/admin/audit/export?format=jsonl|csv`, `GET /v1/admin/audit/anchors`, `GET /v1/admin/audit/anchors/verify`, and `POST /v1/admin/audit/anchors` (owner-only, requires the new `audit:admin` scope), all read paths gated by `audit:read`. The export itself and every anchor record / verify are themselves audited so a downloaded file can be pinned to an exact chain state later.
- IP allowlist for the whole account: a `/settings/security` page lets the owner add a list of trusted IPv4 / IPv6 addresses or CIDR blocks (office egress, VPN range, CI runner subnet) and flip a single switch to enforce it. When enforcement is on, every request that is not on the list gets a `403 ip_not_allowed`, regardless of whether it presents a session cookie or a Bearer API key. The settings endpoint itself is deliberately exempt so a typo can never lock the account out. Rules are normalised (`10.0.0.5/24` becomes `10.0.0.0/24`), duplicates are rejected, denials are written to the audit log, and the whole document is per-user isolated in `ip-allowlist.json`. Backed by `GET` / `PUT /v1/ip-allowlist` and the new `ip-allowlist:read` / `ip-allowlist:write` API key scopes.
- Workspace-wide IP allowlist: an owner-only `/settings/workspace-ip-allowlist` page that locks the entire workspace down to a fixed set of corporate IP ranges so every authenticated request from every member (session cookie or Bearer API key) must originate from one of them. Distinct from the per-user list above, which each member opts into for their own account, and from the per-API-key list, which scopes a single credential. When enabled, off-network requests get a `403 workspace_ip_not_allowed`; the management endpoint itself is never gated so an owner can always recover from a bad rule. The PUT refuses a change that would lock the calling owner out of their current IP unless they explicitly accept the self-lockout warning (`confirmSelfLockoutAccepted: true`), so a typo cannot lock the entire workspace out from a single keystroke. Rules are normalised (`10.0.0.5/24` becomes `10.0.0.0/24`), duplicates are rejected, the document is persisted to `workspace-ip-allowlist.json`, and every change plus every denial writes a hash-chained audit row with the actor, the requesting IP, and the request id. Backed by `GET /v1/workspace-ip-allowlist` (any authenticated member, `ip-allowlist:read` scope) and `PUT /v1/workspace-ip-allowlist` (owner-only, MFA-stepped, `ip-allowlist:write` scope).

  Try it locally (API on `http://localhost:8787`):

  ```bash
  # Read current workspace allowlist (any authenticated member)
  curl -s http://127.0.0.1:8787/v1/workspace-ip-allowlist | jq .

  # Lock the workspace to a corporate range (owner + MFA step-up)
  curl -s -X PUT http://127.0.0.1:8787/v1/workspace-ip-allowlist \
    -H "content-type: application/json" \
    -d '{"enabled":true,"rules":[{"cidr":"203.0.113.0/24","label":"HQ egress"}]}'
  ```
- Active sessions with force-logout: a `/settings/sessions` page lists every browser currently signed in to the account with its short user-agent, IP, sign-in time, and last-seen time, and the current browser is clearly marked. Revoking a single session or hitting the "sign out everywhere else" button writes a tombstone to the per-user `sessions.json` registry; the next request from that session id is rejected with `401 session revoked` by the API auth hook even though the cookie still decrypts. Sids are stored as `sha256` hashes so a leaked registry file is not a leaked cookie. Every revoke is written to the audit log, and the registry is gated by the new `sessions:read` / `sessions:admin` API key scopes via `GET /v1/sessions`, `DELETE /v1/sessions/:id`, and `POST /v1/sessions/revoke-all`.
- API key brute-force monitor: every Bearer-authenticated request now passes a per-source-IP failed-verification throttle before `verifySecret` is even called. After 6 failed attempts inside a 5-minute sliding window the source IP is locked out for 15 minutes and further requests return `429 too many failed api key attempts` with standard `X-RateLimit-*` and `Retry-After` headers, so an attacker mounting an online dictionary attack from a fixed IP cannot keep probing for a valid key regardless of how many keys the workspace has issued. A successful verification clears the counter immediately so an intermittent typo by a legitimate operator never accumulates into a surprise lockout. Each lockout writes an `api_key.bruteforce.lock` row into the hash-chained audit log and a structured entry into `api-key-bruteforce.log` so an incident responder can reconstruct an attack timeline after the fact. The admin-gated `/settings/api-key-bruteforce` page surfaces the policy, every tracked IP with its recent failure count and lock status, and the last 100 throttle events; owners can clear an individual lock once a legitimate source is identified, which requires MFA step-up and is itself audited as `api_key.bruteforce.unlock`. Backed by `GET /v1/api-key-bruteforce` (admin:read) and `DELETE /v1/api-key-bruteforce/:ip` (owner-only, MFA-stepped, maintenance:write).

  Try it locally (API on `http://localhost:8787`):

  ```bash
  # Inspect the current policy and any active lockouts
  curl -sS http://localhost:8787/v1/api-key-bruteforce \
    -H "Authorization: Bearer $CLAWMIND_KEY"

  # Clear a locked source IP (owner + MFA)
  curl -sS -X DELETE http://localhost:8787/v1/api-key-bruteforce/203.0.113.7 \
    -H "Authorization: Bearer $CLAWMIND_KEY"
  ```

  Open `http://localhost:3030/settings/api-key-bruteforce` in the web app for the live table.
- Enterprise SSO via OIDC: ClawMind can require single sign-on against any spec-compliant provider (Google Workspace, Okta, Azure AD / Entra ID, Auth0, Keycloak) without code changes. Set `CLAWMIND_AUTH_MODE=oidc` plus `CLAWMIND_OIDC_ISSUER`, `CLAWMIND_OIDC_CLIENT_ID`, `CLAWMIND_OIDC_CLIENT_SECRET`, and `CLAWMIND_OIDC_REDIRECT_URI` and the API exposes `GET /auth/oidc` (start) and `GET /auth/oidc/callback` (finish). The discovery document is fetched on demand, ID tokens are verified RS256-against-JWKS with audience, issuer, nonce, and expiry checks, the state and nonce are cookie-bound and single-use, and successful logins record a `sso.login` event in the hash-chained audit log. `CLAWMIND_OIDC_ALLOWED_DOMAINS=acme.com,acme.co.uk` restricts sign-in to verified emails in those domains so a contractor with a personal Gmail cannot create an account. The owner-only `/settings/sso` page shows live status (configured, enforced, issuer, client id, redirect URI, allowed domains) for procurement and IT review without ever exposing the client secret.
- Multi-factor authentication (TOTP, RFC 6238): owner accounts can enroll an authenticator app at `/settings/mfa`. The endpoint set is `GET /v1/mfa/status`, `POST /v1/mfa/enroll`, `POST /v1/mfa/confirm`, `POST /v1/mfa/verify`, `POST /v1/mfa/recovery/regenerate`, `DELETE /v1/mfa`, all gated by the new `mfa:read` / `mfa:admin` scopes. Enrollment hands out a 160-bit base32 secret and ten single-use recovery codes (sha256-hashed on disk so a leaked `mfa/<userId>.json` is not a leaked code). The auth plugin exposes a `requireMfa` decorator that demands a successful step-up within a configurable window (default 15 minutes) before sensitive routes will run: key issuance, key revoke and rotate, account hard-delete, IP allowlist edits, maintenance compact and forget, single-session and bulk session revoke, and every webhook mutation. API key callers bypass MFA because their authorization is the scope set bound to the key; cookie-session callers without a fresh code get `401 mfa step-up required` with `x-mfa-required: 1`. Replay protection rejects the same TOTP counter twice in the acceptance window, and every verify, recovery use, and failure is written to the hash-chained audit log.
- Trusted devices for MFA: tick *Remember this device* during a verify and the current browser is bound for a bounded window (default 14 days, hard cap 30) so the user does not have to retype a TOTP code on every sensitive action from the same laptop. Cookies carry `userId.rawToken`, only `sha256(rawToken)` is persisted on disk under `mfa/trusted/<userId>.json`, validation is constant-time, and expired records are pruned on the spot. Listing, individual revoke, and bulk revoke live at `GET /v1/mfa/trusted-devices`, `DELETE /v1/mfa/trusted-devices/:id`, and `DELETE /v1/mfa/trusted-devices`; the revoke endpoints themselves demand an MFA step-up so a stolen session cookie cannot evict a real device and lock the user in. Disabling MFA wipes every trust in one atomic step, and every mint and revoke writes a row into the hash-chained audit log. The `/settings/mfa` page lists every active device with its label, IP, last-seen, and expiry, and flags the current browser inline.
- Data retention policy: an owner-only `/settings/retention` page that lets you cap how long ClawMind keeps your ask history and conversations before auto-erasing them, the single biggest GDPR/CCPA blocker in procurement reviews. Three independent knobs (history days, conversation days, audit retention hint) accept an integer between 1 and 3650 days or blank for "keep forever". A dry-run preview reports exactly how many records the sweep would remove before you commit; the apply button only enables when the preview shows nonzero deletes and prompts for confirmation. The audit chain is deliberately never silently truncated, even when an `auditDays` hint is set, so SOC2 evidence stays intact. Backed by `GET /v1/retention`, `PUT /v1/retention`, and `POST /v1/retention/apply?dry_run=true|false`, gated by the new `retention:read` / `retention:admin` API key scopes, and every mutation plus every applied sweep writes to the hash-chained audit log with before/after diffs.
- Workspace freeze (kill switch): an owner-only `/settings/workspace-freeze` page that pauses every mutating endpoint with HTTP `423 Locked` while keeping reads, exports, MFA step-up, and sign-out fully available, the boring-but-required switch a buyer wants to see during incident response, billing disputes, and offboarding wind-downs. Activating a freeze records the actor, an optional external ticket reference (for example `SEC-2026-009`), and a free-form reason; the enforcement plugin runs after auth so the denial audit row carries the real actor and the response body returns the freeze metadata so client code can render a clean banner instead of a silent 423. The allowlist is intentionally narrow (auth, MFA verify, sessions, GDPR export download, and the freeze endpoint itself) so an owner can always sign in and unfreeze even if they were the one who set it. Freeze state is exposed in `GET /v1/admin/overview` next to SSO, MFA, IP allowlist, and audit head hash so an enterprise reviewer sees the pause from one screen. Backed by `GET /v1/workspace/freeze` (admin+), `POST /v1/workspace/freeze` and `DELETE /v1/workspace/freeze` (owner-only, MFA-stepped), and the new `workspace-freeze:read` / `workspace-freeze:admin` API key scopes; every activate, update, release, and every blocked write writes to the hash-chained audit log.
- Workspace-wide GDPR / data-portability export: an owner-only `/settings/workspace-export` page that downloads every workspace-scoped record &mdash; members, the full multi-user history, every conversation, saved searches, feedback rows, API key metadata, pins, mutes, aliases, tags, collections, domain policies, IP allowlist, webhook allowlist, webhooks, invitations, the hash-chained audit log, and the ingest manifest &mdash; as a single JSON file or as a flat ZIP-of-JSON archive that BI and legal-hold tooling can ingest verbatim. Companion to the per-user `/v1/me/export` endpoints, this satisfies the exit and data-portability clauses every enterprise contract puts in front of a buyer. Secret material is deliberately stripped before packaging: bcrypt and sha256 hashes, OIDC client secrets, MFA TOTP seeds, and SMTP credentials never leave disk, so a leaked bundle cannot be replayed to re-impersonate users on another deployment. A read-only preview endpoint reports the same counts plus an estimated bundle size without doing the real download, so an owner can sanity-check a multi-GB tenant before committing. Backed by `GET /v1/workspace/export.json`, `GET /v1/workspace/export.zip`, and `GET /v1/workspace/export/preview`, all owner-gated and audited on every call (including dry-run previews recorded under `workspace.export.dry_run`), behind the new `workspace-export:read` / `workspace-export:admin` API key scopes.
- Workspace query blocklist: an owner-only `/settings/query-blocklist` page that maintains a list of literal substring or regex patterns enforced at the very front of `/v1/ask`, `/v1/ask/stream`, `/v1/search`, and `/v1/explain`. A matched query is rejected with `422 query-blocked` before retrieval and before any LLM call, so a leaked API token prefix, a banned customer name, or a PII pattern (for example `\b\d{3}-\d{2}-\d{4}\b` for US social-security numbers) never reaches the embedder, the index, or an external model provider. Literal patterns are case-insensitive and de-duplicated on write; regex patterns are validated at write time with `new RegExp(..., 'i')` so a broken expression cannot land and 500 every query later. Owner-only with MFA step-up on add and remove; reads are admin+ so a compliance operator can audit the closed set. Every add, every remove, and every block records to the hash-chained audit log with the rule id (never the raw matched query, to avoid logging the secret the user just tried to send). Backed by `GET /v1/query-blocklist`, `POST /v1/query-blocklist`, and `DELETE /v1/query-blocklist/:id`, behind the new `query-blocklist:read` / `query-blocklist:admin` API key scopes.
- Workspace legal hold: an owner-only `/settings/legal-hold` page that suppresses all user-initiated data deletion and every scheduled retention sweep across the workspace while a litigation or regulatory matter is open, the hard SOC2 / e-discovery requirement that sits underneath the retention story. Imposing a hold records the actor, an external ticket reference (for example `LEGAL-2026-042`), and a free-form reason; while the hold is active, `DELETE /v1/me/data` and `POST /v1/retention/apply` both return `409 legal_hold_active` with the hold metadata so the calling client can surface a clean explanation instead of a silent failure. Reads, exports, and normal product usage are intentionally unaffected so the hold preserves evidence without locking the workspace, and the audit chain (which is never truncated regardless) records `legal-hold.impose`, `legal-hold.update`, `legal-hold.release`, plus every blocked attempt under `lifecycle.delete.blocked` and `retention.apply.blocked`. Backed by `GET /v1/legal-hold` (admin+), `POST /v1/legal-hold` and `DELETE /v1/legal-hold` (owner-only, MFA-stepped), and the new `legal-hold:read` / `legal-hold:admin` API key scopes.
- Atomic offboarding sweep with orphaned-credential cleanup: removing a workspace member, either manually via `DELETE /v1/members/:userId` or automatically via SCIM 2.0 deprovisioning (`DELETE /scim/v2/Users/:id`), now revokes every API key and active session that member owned in the same operation, closing the classic dangling-credential gap where an offboarded employee kept hitting the API with a key minted before they left. The sweep is idempotent (a second call reports zero) and writes both a counter on the `members.remove` / `scim.user.delete` audit row and a follow-up `members.offboarding.sweep` row listing the revoked key ids and session count, so a reviewer can prove the cleanup was atomic with the membership change. The new owner-only `/settings/offboarding` page surfaces any historical orphan, an API key whose owning userId is no longer a workspace member, and lets the owner revoke each one with MFA step-up. Backed by `GET /v1/offboarding/orphans` (admin+) and `POST /v1/offboarding/orphans/:id/revoke` (owner-only, MFA), behind the new `offboarding:read` / `offboarding:admin` API key scopes.
- Periodic access reviews (SOC2 CC6.3 / ISO 27001 A.9.2.5): an owner-only `/settings/access-reviews` page that produces the recurring user-access recertification artifact every enterprise procurement review asks for. Opening a review snapshots every current member (`userId`, role, email, label, `lastSeenAt`) so the decision is bound to who held what role at review time, not who happens to exist when the review eventually completes. The owner walks the snapshot and records `keep`, `downgrade` (to `member` or `viewer`), or `revoke` for each row, with an optional free-text note per member; close is blocked until every row has a decision so the resulting record is genuinely complete. On close, downgrades route through `updateRole` and revokes through `removeMember` so the same RBAC hierarchy rules (last-owner protection, no admin demoting an owner) enforce themselves automatically, partial-application errors are captured per row instead of aborting the close, the owner's free-text attestation is signed into the record, and one audit event per applied change plus a summary `access-reviews.close` event land in the hash-chained log so a regulator can reconstruct exactly who attested what and which member memberships actually moved. Closed reviews are immutable. Backed by `GET /v1/access-reviews`, `GET /v1/access-reviews/summary`, `GET /v1/access-reviews/:id`, `POST /v1/access-reviews`, `POST /v1/access-reviews/:id/decisions/:userId`, and `POST /v1/access-reviews/:id/close` (with optional `dryRun` on the mutations), behind the new `access-reviews:read` (admin+) / `access-reviews:admin` (owner-only, MFA-stepped) API key scopes.
- Members and RBAC (4 roles): the new owner-only `/settings/members` page makes ClawMind a real multi-user product. Every authenticated user is recorded in `members.json` with one of `owner`, `admin`, `member`, or `viewer`; the first user to ever log in is auto-bootstrapped as the owner so the deployment is never role-less. Admins can invite teammates, change roles, and remove members; only owners can mint or demote other owners, and the registry refuses to let the last owner be demoted or removed so a workspace cannot be orphaned. The new `requireMinRole` decorator gates the routes hierarchically (`owner > admin > member > viewer`), invites are MFA stepped, and every promote, demote, invite, and removal writes a before/after diff into the hash-chained audit log. Backed by `GET/POST /v1/members`, `PATCH /v1/members/:userId`, `DELETE /v1/members/:userId` and the new `members:read` / `members:admin` scopes; DELETE supports `?dry_run=true` for safe what-if checks.
- Domain auto-join policies: an owner or admin can list verified email domains at `/settings/domains` and set `member` or `viewer` as the default role for any first-time sign-in from that domain, so onboarding a 200-person org across SSO does not require 200 individual invites. The policy table is replaced atomically (no partial writes), case-insensitive on the domain, hard-capped at 50 entries, and refuses to ever auto-grant `admin` or `owner` so a compromised email provider cannot escalate. Existing members are never silently promoted or demoted: policies only apply to brand-new users on their first login. Backed by `GET /v1/domain-policies` and `PUT /v1/domain-policies` (with optional `dryRun`), gated by the new `domain-policies:read` / `domain-policies:admin` scopes, MFA-stepped on mutate, and every replace plus every denied attempt writes a before/after diff into the hash-chained audit log.
- Email-token invitations: a workspace owner or admin can send a one-time invitation link bound to a specific email at `/settings/invitations`, instead of needing to know the recipient's OIDC subject up front. POST `/v1/invitations` mints a 32-byte token, returns it once, and stores only `sha256(token)` so a leaked `invitations.json` does not let an attacker walk in through a pending invite. The recipient lands on `/invitations/accept?token=...` where the UI peeks the role and expiry without consuming the token, then accept verifies the signed-in user's email matches the one the invite was issued to (defence against link forwarding). Accept is single-use, expirable (1, 7, 14, or 30 days), and on success calls `inviteMember()` so the recipient drops into the registry at the pre-bound role on their next OIDC login. List/peek/create/revoke are all MFA stepped under the new `invitations:read` / `invitations:admin` scopes, and every mint, accept, revoke, and denial writes a before/after diff into the hash-chained audit log.
- SCIM 2.0 provisioning: an owner-only `/settings/scim` page lets the workspace mint a single bearer token that an identity provider (Okta, Azure AD, Google Workspace, Auth0, OneLogin, JumpCloud) uses to push users into ClawMind on assignment and pull them out on offboarding. The protocol surface lives at `/scim/v2/Users` and covers `GET` (with `filter=userName eq "x"`, `startIndex`, `count`), `GET/:id`, `POST`, `PATCH` (active flag and role, including Okta's `replace path=active value=false` deprovision shape), and `DELETE`, plus the discovery endpoints `ServiceProviderConfig`, `ResourceTypes`, and `Schemas`. Users are projected one-to-one from the existing member registry so SCIM and the in-app `/settings/members` UI can never disagree about who has access; `active=false` soft-suspends to `viewer` instead of deleting so audit history stays attached, and the last-owner protection refuses both deprovision and delete so a misconfigured IdP cannot orphan the workspace. The token is shown plaintext exactly once on rotation, only its sha256 digest is persisted, lifecycle is owner+MFA gated, and every SCIM create, patch, delete, and denial is written to the hash-chained audit log with actor `scim:<token-id>` so SOC2 reviewers can trace which IdP action provisioned which user. See `docs/SCIM.md` for IdP setup.
- SCIM 2.0 user provisioning: enterprise IdPs (Okta, Azure AD / Entra ID, Google Workspace, OneLogin) can push the full user lifecycle into ClawMind without the workspace owner clicking invite links by hand. The owner mints a single workspace bearer token at `/settings/scim` (plaintext shown exactly once, sha256 digest stored on disk, MFA-gated to rotate or revoke) and points the IdP at `/scim/v2`. The protocol surface is RFC-compliant: `GET /scim/v2/ServiceProviderConfig`, `/ResourceTypes`, `/Schemas`, plus full `Users` CRUD with `userName eq` filtering, RFC 6902-style PATCH for active flag and role, `application/scim+json` content type, and standard 401 / 404 / 409 SCIM error envelopes with `scimType=uniqueness` on conflicts. Users project one-to-one from the existing `members.json` registry (no parallel user table to drift), the role lives on the schema extension `urn:ietf:params:scim:schemas:extension:clawmind:2.0:User`, `active=false` softly demotes to viewer instead of orphaning audit history, and the registry refuses to deprovision the last remaining owner. Every create, patch, delete, and denial is written to the hash-chained audit log with the actor stamped as `scim:<tokenId>` so an auditor can tell IdP-driven changes apart from in-app ones.
- Admin console: a single owner-only `/admin` page that aggregates every security control on the tenant into one screen so an enterprise reviewer can answer "is this configured safely" without clicking through eight separate settings panels. SSO status, MFA enrollment, active sessions, API key counts and last-used time, 24h webhook deliveries and failures, IP allowlist state, data retention windows, and the current audit chain head hash all surface in one round trip via `GET /v1/admin/overview`. Every number comes from the same services the dedicated routes use so the overview cannot drift from reality. Owner-gated, `admin:read` scoped, and the fetch itself appends an `admin.overview` row to the hash-chained audit log so the act of reviewing posture leaves its own trace.

- Notifications inbox: an in-app `/notifications` page plus a live bell badge in the top nav, so you find out when someone opens a share you minted or when one of your webhooks gets auto-paused after repeated failures. No email, no SMS, no third-party push. Notifications dedupe per share (every refresh just bumps the existing row's view count), cap at 200 per user, and ship with mark-read, mark-all-read, remove, and clear. Per-user notification preferences at `/settings/notifications` (or `GET`/`PUT /v1/notification-preferences`) let you toggle each kind (share views, webhook failures, webhook auto-disabled, system messages) on or off; switched-off kinds are dropped at the producer with `shouldDeliver()` before they ever reach the inbox, so you never see another row of a category you muted
- Idempotency-Key on every mutating endpoint: callers can pass an opaque `Idempotency-Key` header on any `POST`, `PUT`, `PATCH`, or `DELETE` and ClawMind guarantees the request runs at most once. A retry with the same key and the same body replays the original response byte-for-byte (with `Idempotency-Replay: true` set so client code can tell) instead of double-creating a conversation, double-charging a quota slot, or double-revoking a key. A retry with the same key but a different body returns `409 idempotency_key_reused` so a coding bug surfaces immediately instead of silently mutating state. Keys are scoped per actor (cookie session user id or API key id) so two tenants reusing the same key string never collide, anonymous callers are rejected with `401 idempotency_requires_auth` so the on-disk registry cannot be filled by drive-by traffic, only `2xx` responses are cached so a transient `500` is retried for real, and entries expire after 24 hours. Implemented as a Fastify plugin that runs after auth, persisted to `idempotency.json` with the same atomic-rewrite pattern as the rest of the on-disk state.
- File watcher for incremental reindex
- Local MLX embeddings with automatic fallback to an OpenAI-compatible endpoint

## Try it: Software Bill of Materials (CycloneDX 1.5)

Procurement reviewers and SCA pipelines (Anchore, Snyk, Dependency-Track) pin a single URL and reconcile it against CISA KEV.

```bash
# 1. Public: pull the CycloneDX 1.5 document. No auth required.
curl -sS http://localhost:7410/v1/sbom.json | jq '{format: .bomFormat, spec: .specVersion, components: (.components | length)}'

# 2. Public: lightweight summary the web page renders.
curl -sS http://localhost:7410/v1/sbom/summary | jq

# 3. Owner-only: publish the vendor + source repo + build commit overlay.
#    Requires an MFA-stepped session and the sbom:admin scope.
curl -sS -X PUT http://localhost:7410/v1/admin/sbom/attestation \
  -H "Authorization: Bearer $OWNER_KEY" \
  -H 'content-type: application/json' \
  -d '{"vendor":"ClawMind, Inc.","repository":"https://github.com/Sanjays2402/clawmind","commit":"'"$(git rev-parse HEAD)"'","notes":"Production build for 2026 Q2."}'

# 4. Owner-only: pin a SHA-256 over the current SBOM. The hash is
#    reproducible from the published document (timestamp stripped).
curl -sS -X POST http://localhost:7410/v1/admin/sbom/attestation/sign \
  -H "Authorization: Bearer $OWNER_KEY"
```

The web view is at `http://localhost:7412/sbom`.

## Try it: Data Processing Agreement acceptance

Prove to a buyer's legal team that a versioned DPA is on file and walk away with a portable signed receipt.

```bash
# 1. Public: confirm a DPA version is published (no auth, no creds).
curl -sS http://localhost:7410/v1/dpa/versions | jq '.versions[0] | {id,label,effective,fingerprint,bodyBytes}'

# 2. Public: read the exact canonical body so you can diff what you are accepting.
curl -sS http://localhost:7410/v1/dpa/versions/2025-01-15 | jq -r .body | head -20

# 3. Public: status badge for procurement (is anything on file yet?).
curl -sS http://localhost:7410/v1/dpa/status | jq

# 4. Owner + MFA: record the binding acceptance. Returns a signed receipt.
curl -sS -X POST http://localhost:7410/v1/dpa/accept \
  -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "signatoryName": "Alice Example",
    "signatoryTitle": "Chief Information Security Officer",
    "signatoryEmail": "alice@acme.example",
    "notes": "MSA section 12 reference"
  }' | jq '.acceptance | {id,versionLabel,versionFingerprint,signatoryName,acceptedAt,signature}'

# 5. Admin: download a portable receipt for the buyer's legal team.
curl -sS -OJ -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  http://localhost:7410/v1/dpa/acceptances/$ACCEPTANCE_ID/receipt

# 6. Admin: re-verify the signature server-side.
curl -sS -X POST -H "Authorization: Bearer $CLAWMIND_API_KEY" \
  http://localhost:7410/v1/dpa/acceptances/$ACCEPTANCE_ID/verify | jq

# Web console.
open http://localhost:7412/settings/dpa
```

## Try it: idempotent retries

```bash
# First call creates the conversation
curl -sS http://localhost:8787/v1/conversations \
  -H "authorization: Bearer $CLAWMIND_KEY" \
  -H "content-type: application/json" \
  -H "idempotency-key: launch-plan-2026-05-31" \
  -d '{"title":"Launch plan"}'

# Retry with the same key + body replays the first response,
# sets Idempotency-Replay: true, does not create a duplicate.
curl -sS -i http://localhost:8787/v1/conversations \
  -H "authorization: Bearer $CLAWMIND_KEY" \
  -H "content-type: application/json" \
  -H "idempotency-key: launch-plan-2026-05-31" \
  -d '{"title":"Launch plan"}'

# Reusing the key with a different body returns 409.
curl -sS -i http://localhost:8787/v1/conversations \
  -H "authorization: Bearer $CLAWMIND_KEY" \
  -H "content-type: application/json" \
  -H "idempotency-key: launch-plan-2026-05-31" \
  -d '{"title":"Different title"}'
```

## Try it: acceptable use policy

```bash
# Owner publishes a versioned AUP and turns on enforcement.
curl -sS http://localhost:8787/v1/acceptable-use \
  -X PUT \
  -H "authorization: Bearer $CLAWMIND_OWNER_KEY" \
  -H "content-type: application/json" \
  -d '{
    "version": "2026-06-01",
    "title": "Acceptable Use Policy",
    "body": "Do not upload prohibited content...",
    "requireAcceptance": true
  }'

# A member that has not accepted gets 412 on every mutating route,
# with x-acceptable-use-version and an acceptUrl in the body.
curl -sS -i http://localhost:8787/v1/docs \
  -X POST \
  -H "authorization: Bearer $CLAWMIND_MEMBER_KEY" \
  -d '{"title":"notes"}'

# Member accepts by echoing back the version and SHA-256 of the body
# they saw. The bodyHash is returned from GET /v1/acceptable-use.
curl -sS http://localhost:8787/v1/acceptable-use/accept \
  -X POST \
  -H "authorization: Bearer $CLAWMIND_MEMBER_KEY" \
  -H "content-type: application/json" \
  -d '{"version":"2026-06-01","bodyHash":"<sha256>"}'

# Admins inspect coverage: who has accepted, who is outstanding.
curl -sS http://localhost:8787/v1/acceptable-use/coverage \
  -H "authorization: Bearer $CLAWMIND_ADMIN_KEY"
```

UI lives at <http://localhost:3000/settings/acceptable-use>.

## Try it: tamper-evident audit anchors

The audit log is hash-chained, so an in-place edit shows up as a hash break.
What the chain cannot catch on its own is truncation (the tail was deleted)
or rewrite (the file was rebuilt to a different past). Anchors are short
HMAC-signed records that pin the chain head plus length at a point in time;
a later verify reports `chain-truncated` or `chain-rewritten` when the
live chain no longer matches the anchor.

```bash
# Visit the UI at http://localhost:7412/audit and use the Anchors panel,
# or drive the API directly:

# Record a fresh anchor (owner + audit:admin scope).
curl -sS -X POST http://localhost:8787/v1/admin/audit/anchors \
  -H "authorization: Bearer $CLAWMIND_KEY" \
  -H "content-type: application/json" \
  -d '{"note":"monthly SOC2 close"}'

# List the most recent anchors with HMAC validity per row.
curl -sS http://localhost:8787/v1/admin/audit/anchors \
  -H "authorization: Bearer $CLAWMIND_KEY"

# Verify the latest anchor against the live chain.
curl -sS http://localhost:8787/v1/admin/audit/anchors/verify \
  -H "authorization: Bearer $CLAWMIND_KEY"
```

## Try it: data residency

Workspaces that must answer the "where does my data live" question on a
procurement form can pin the API process to a canonical region
(`CLAWMIND_REGION`, one of `us | eu | uk | ca | au | ap | other`) and
restrict which regions are allowed to land writes. Every response
carries `x-clawmind-region` so a multi-region client can confirm the
request landed in a compliant process. Mutations from a disallowed
region are rejected with HTTP 451 and a structured `{error,
serverRegion, allowedRegions}` body so an SDK can retry against a
compliant region. Reads are never blocked.

```bash
# Confirm which region this process is pinned to.
curl -sI http://localhost:8787/healthz | grep -i x-clawmind-region

# Read the workspace policy plus current server region (admin+).
curl -sS http://localhost:8787/v1/data-residency \
  -H "authorization: Bearer $CLAWMIND_KEY"

# Restrict writes to EU + UK only (owner + MFA step-up).
curl -sS -X PUT http://localhost:8787/v1/data-residency \
  -H "authorization: Bearer $CLAWMIND_KEY" \
  -H "content-type: application/json" \
  -d '{"allowedRegions":["eu","uk"],"controller":"Acme GmbH, Frankfurt"}'
```

## Try it: data subject requests (GDPR / CCPA)

Public intake at `/privacy/request`. Anyone (workspace member or not) can file an access, erasure, rectification, portability, or restriction request without an account. The submission returns a one-shot verification token; only verified requests appear on the admin queue. Status changes are owner + MFA gated and written to the hash-chained audit log so a compliance reviewer can prove the 30-day response SLA from the queue alone.

```bash
# Public submission (no auth)
curl -X POST http://localhost:8787/v1/dsr/submit \
  -H 'content-type: application/json' \
  -d '{"subjectEmail":"alice@example.com","kind":"erasure","details":"please delete"}'
# => {"id":"dsr_...","status":"unverified","verifyToken":"...","verifyPath":"/v1/dsr/verify/..."}

# Subject confirms control of the email
curl http://localhost:8787/v1/dsr/verify/<id>/<token>

# Admin reads the queue (admin+, scope dsr:read)
curl -H "Authorization: Bearer $CLAWMIND_KEY" http://localhost:8787/v1/dsr

# Owner (with MFA, scope dsr:admin) resolves
curl -X PATCH http://localhost:8787/v1/dsr/<id> \
  -H "Authorization: Bearer $CLAWMIND_KEY" \
  -H 'content-type: application/json' \
  -d '{"status":"fulfilled","note":"exported via /v1/workspace-export then deleted"}'
```

Admin UI lives at `/settings/dsr`; the public form is `/privacy/request`.

## Try it: GDPR Article 17 erasure certificates

When a workspace fulfils a Data Subject erasure request, ClawMind mints
a signed destruction receipt the subject (and their auditor or
regulator) can verify offline. The plaintext email never lands on disk;
the certificate stores a sha256 fingerprint and the holder proves
identity by replaying the email through a constant-time check.

```
# Subject submits an erasure request (public, no account required).
curl -s -X POST http://localhost:7411/v1/dsr/submit \
  -H 'content-type: application/json' \
  -d '{"subjectEmail":"jane@example.com","kind":"erasure","details":"please delete my data"}'

# Admin fulfils the request; this mints the certificate automatically.
# Response includes certificateId alongside the updated DSR row.
curl -s -X PATCH http://localhost:7411/v1/dsr/$DSR_ID \
  -H 'authorization: Bearer $TOKEN' \
  -H 'content-type: application/json' \
  -d '{"status":"fulfilled","note":"all corpus + history rows destroyed"}'

# Subject pulls the receipt with only the id (public, no auth).
curl -s http://localhost:7411/v1/erasure-certificates/by-dsr/$DSR_ID

# Subject proves ownership by replaying the email. Constant-time check;
# the address is never persisted or echoed in access logs.
curl -s -X POST http://localhost:7411/v1/erasure-certificates/$CERT_ID/verify \
  -H 'content-type: application/json' \
  -d '{"subjectEmail":"jane@example.com"}'
```

The receipt is HMAC-SHA256 signed with a per-workspace secret kept next
to the certificate file, and the content fingerprint is a sha256 over
the canonical JSON payload so procurement teams can pin a stable
identifier in their vendor record. Storage is append-only: a certificate
cannot be amended or deleted, only revoked (revocation writes a note
alongside the bit-for-bit original).

UI:

- Public viewer + verifier at `/privacy/certificate` (no workspace
  chrome, safe to link from a privacy policy or DPA addendum).
- Admin triage list at `/settings/erasure-certificates` (owner or admin
  with `erasure-certificates:read`), with offline signature recheck per
  row so a tampered file is visible at a glance.

## Try it: scheduled API key activation

Pre-mint an API key for a fixed change-management window. The key is
stored immediately but refuses to authenticate until the chosen
timestamp arrives, then goes live with no manual rotation step.

Local URL: `http://localhost:3000/settings/key-activation`.

Mint a key scheduled to activate one hour from now:

```bash
NOW=$(node -e 'console.log(Date.now())')
FUTURE=$((NOW + 3600000))
curl -sX POST http://localhost:8080/v1/keys \
  -H "authorization: Bearer $CLAWMIND_API_KEY" \
  -H 'content-type: application/json' \
  -d "{\"label\":\"vendor-cutover\",\"notBefore\":$FUTURE}"
```

Until `notBefore` arrives, requests with the new secret receive:

```
HTTP/1.1 401 Unauthorized
X-API-Key-Not-Before: 2026-05-31T23:45:00.000Z
Retry-After: 3540

{"error":"api key not yet active","reason":"not_yet_active","notBefore":"...","waitSeconds":3540}
```

Reschedule or clear later with `PUT /v1/keys/:id/activates-at`
(`{"notBefore": <epoch-ms>}` or `{"notBefore": null}`). Every change is
audited and the dashboard shows pending vs active per key.
