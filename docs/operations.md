# Operations

Deploying and running ClawMind in production.

Deploy targets are the Helm chart in `infra/helm/clawmind` and the Docker
images built from `infra/docker/*.Dockerfile`. The API is stateless apart
from the LanceDB and BM25 files under `CLAWMIND_DATA_DIR`, which the chart
mounts from a PersistentVolumeClaim.

Container images:

- `infra/docker/api.Dockerfile` is a real multi-stage build. The `deps`
  and `build` stages install the full pnpm workspace and compile the api
  with `tsc`. A separate `prod` stage re-installs production-only deps
  (`pnpm install --prod --frozen-lockfile --ignore-scripts`) so no
  devDependency leaks. `pnpm --filter @clawmind/api deploy --prod`
  flattens the api package plus its workspace deps into `/out`, and the
  final `runtime` stage copies only `package.json`, `node_modules`, and
  `dist` into a fresh `node:20-alpine`. Source, tsconfig, turbo, pnpm,
  and the lockfile do not exist in the shipped image.
- The runtime image runs as uid 10001 (`USER cm`), uses `tini` as PID 1
  so signals reach Node and zombies get reaped, and ships a container
  `HEALTHCHECK` against `/live`. `NODE_ENV=production` and
  `CLAWMIND_API_HOST=0.0.0.0` are baked in so the container boots
  cleanly under Kubernetes without extra env wiring.
- `apps/api/test/api-dockerfile.test.ts` freezes these properties in CI
  (no docker daemon required) so a future edit that re-introduces source
  or drops the non-root user fails the build.
- Build locally with
  `docker build -f infra/docker/api.Dockerfile -t clawmind-api:dev .`
  from the repo root.

Health endpoints:

- `GET /live` is the Kubernetes liveness target. Always returns 200 with
  `{ "ok": true }` and performs zero downstream calls, so a slow or
  degraded embed sidecar, LLM provider, or storage layer cannot cascade
  into pod restarts. The Helm chart points the api livenessProbe here.
- `GET /ready` is readiness. Returns 200 once LanceDB, BM25, and the
  ingest manifest are loaded, 503 before that. The Service does not
  route to the pod until this passes.
- `GET /health` is a deeper status endpoint for dashboards and on-call.
  It reports embed and LLM health, chunk count, BM25 size, and document
  count. Do not use it as a livenessProbe; it intentionally fans out to
  dependencies and can stall.
- `GET /version` returns the build name and version.

Metrics:

- `GET /metrics` returns Prometheus text exposition format (version
  0.0.4). Scrape with a `ServiceMonitor` or plain Prometheus job. Series
  exposed include `http_requests_total{method,route,status}`,
  `http_requests_errors_total`, the
  `http_request_duration_seconds` histogram with buckets from 5 ms to
  10 s, plus `process_resident_memory_bytes`, `nodejs_heap_used_bytes`,
  and `process_uptime_seconds`. Cardinality is bounded by labelling on
  the Fastify route template, not the raw URL.
- `GET /metrics` with `Accept: application/json`, or `GET /metrics.json`,
  returns the legacy JSON snapshot for dashboards that have not moved to
  Prometheus yet.

Logs and traces:

- Structured JSON logs via pino. Each request gets a request id from
  Fastify and is attached to the log context as `requestId`.
- Request id propagation: the API honours an inbound `X-Request-Id`
  header when it matches `^[A-Za-z0-9_.:-]{8,128}$` so an upstream
  gateway, load balancer, or calling service can join logs across hops.
  Otherwise a fresh `req_` prefixed nanoid is minted. The chosen id is
  echoed back on every response as `X-Request-Id` and is recorded on
  every audit row under `meta.requestId`, so logs, audit, Sentry events,
  and the client trace all join on the same key.
- OpenTelemetry tracing is opt-in via `CLAWMIND_OTEL_ENABLED=true` and
  `CLAWMIND_OTEL_ENDPOINT`. Trace ids propagate into the log lines.

Error tracking (Sentry):

- Set `CLAWMIND_SENTRY_DSN` to enable. With the DSN empty the SDK never
  initialises and zero events are sent, so dev and test runs stay offline.
- The Fastify `sentryPlugin` reports every 5xx response and every uncaught
  error handler invocation. 4xx responses are intentionally skipped to keep
  validation noise out of the issue tracker; those still land in the audit
  log and structured logs.
- Each event carries the Fastify request id, the route template (not the
  raw URL, so query strings stay out of the payload), the client IP, and
  the HTTP status. When a user is authenticated the event is tagged with
  their user id and GitHub login.
- `req.captureException(err, extra?)` is exposed on every request for
  routes that want to capture handled errors with extra context.
- `CLAWMIND_SENTRY_ENVIRONMENT` (default `development`) and
  `CLAWMIND_SENTRY_RELEASE` map to the standard Sentry fields.
  `CLAWMIND_SENTRY_TRACES_SAMPLE_RATE` controls performance trace sampling
  and defaults to `0`.
- On graceful shutdown the plugin flushes the Sentry queue with a 1.5 s
  budget so in-flight events leave the pod before SIGTERM kills the
  process.

Audit log:

- Mutating requests and any non-2xx response are appended to the audit
  log at `${CLAWMIND_DATA_DIR}/audit.log` by the `auditPlugin`. Each row
  carries actor, action, resource, and request IP.
- Compliance review uses `GET /v1/admin/audit`. The route requires the
  `owner` role and the `audit:read` scope, so a narrowly scoped API key
  cannot tail user activity. Supported query parameters are `actor`
  (exact match), `action` (substring match), `resource` (path prefix
  match), `since` and `until` (epoch ms window), and `limit` / `offset`
  for paging. `limit` is capped at 1000. Results are newest first and
  the response shape is `{ total, events }`. The query itself is
  appended to the log with `action: audit.query`, so a reviewer
  inspecting the trail always leaves their own footprint in it.
- For very large logs, the `AuditLog` rotates `audit.log` in process.
  Once the active file exceeds `CLAWMIND_AUDIT_MAX_BYTES` (default 32 MiB)
  it is renamed to `audit.log.1`, older rotations shift up (`.1` -> `.2`,
  ...), and anything past `CLAWMIND_AUDIT_KEEP_FILES` (default 5) is
  deleted. Set `CLAWMIND_AUDIT_MAX_BYTES=0` to disable in-process
  rotation and hand off to external tooling (logrotate, a k8s sidecar,
  shipping to object storage). The query endpoint reads the active file
  plus every retained rotation so a window that crosses a rotation
  boundary still returns the right events; it is intended for incident
  response rather than analytics and caps a single response at 1000 rows.
- Each row is part of a sha256 hash chain. On write, the previous row's
  hash is stored in `prevHash` and a new `hash` is computed over a
  canonical serialisation of the row (meta keys sorted, hash field
  excluded). The first row in any chain commits to the sentinel
  `genesis`. `GET /v1/admin/audit/verify` replays the chain across the
  active log and every retained rotation, returns
  `{ ok, checked, firstBadIndex, reason, headHash }`, and self-logs the
  call with `action: audit.verify`. An on-call procedure for tamper
  evidence is: (1) after a security event, snapshot the current
  `headHash` from `/v1/admin/audit/verify` and stash it in the incident
  ticket; (2) anchor that head externally if you want non-repudiation
  (commit hash to a ticket, notarise, ship to write-once storage);
  (3) re-run verify later, and if `ok=false` or `headHash` changed for
  a record at or before the anchored point, the on-disk log was
  tampered with. The chain tolerates a legacy unchained prefix (rows
  written before this feature carry no hash and are skipped without
  failing verify) so an upgrade in place does not falsely flag the
  existing log.

Rate limits:

- Global ceiling of 240 requests per minute, keyed on API key id, then
  session user, then client IP. Hot routes such as `/v1/ask` apply a
  tighter per-route budget on top.

API key scopes:

- Every gated route declares a scope from `apps/api/src/scopes.ts`. The
  full catalogue is also exposed at `GET /v1/keys/scopes` so a UI can
  render checkboxes when issuing a key.
- Scopes follow `<resource>:<action>` where action is one of `read`,
  `write`, or `admin`. Examples: `search:read`, `ingest:write`,
  `lifecycle:admin`. The wildcard `*` grants every scope and is the
  intended choice for trusted automation that needs the whole surface.
- A key with an empty scope list is treated as unrestricted for
  backwards compatibility, matching the long-standing behaviour of
  `services/api-keys.ts#hasScope`. A key with at least one scope is
  restricted to that set; the `requireScope` preHandler returns 403 on
  any route that asks for a scope not in the list.
- `POST /v1/keys` validates submitted scopes against the registry and
  rejects typos with HTTP 400, so a key cannot silently look
  restrictive while in practice gating nothing. Session-cookie users
  bypass the scope check (they are intentionally unscoped); scope
  enforcement only applies to API key requests.
- Coverage is enforced by `apps/api/test/scopes.test.ts`, which asserts
  that no route file leaves a bare `requireAuth` or `requireRole`
  preHandler in place and that every `requireScope()` argument resolves
  to a known scope. Adding a new route without a scope fails the build.

Scaling:

- The API is horizontally scalable as long as all replicas share the
  same `CLAWMIND_DATA_DIR` volume (ReadWriteMany) or you front a single
  writer with read replicas. Set `api.replicas` in the Helm values.
- Embed sidecar is CPU bound. Scale `embed.replicas` and put a Service
  in front of it so the API load balances across pods.

Security headers:

- The API ships an in-process `security-headers` plugin (`apps/api/src/plugins/security-headers.ts`)
  that stamps a JSON-API baseline on every response: `X-Content-Type-Options:
  nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy` denying camera, microphone, geolocation, and the
  legacy `interest-cohort` token, plus `Cross-Origin-Opener-Policy` and
  `Cross-Origin-Resource-Policy` both pinned to `same-origin`.
- The default `Content-Security-Policy` is `default-src 'none'; frame-ancestors
  'none'; base-uri 'none'; form-action 'none'`. The API only serves JSON and
  never returns user supplied HTML, so this policy is safe to leave on. The
  Next.js web client is a separate origin and is not affected.
- `Strict-Transport-Security` is opt-in via `CLAWMIND_HSTS_ENABLED=true`
  because the default bind is plain HTTP on `127.0.0.1`. Enable it once the
  API is behind a TLS terminating ingress. `CLAWMIND_HSTS_MAX_AGE_SECONDS`
  controls the max-age (default 180 days, `includeSubDomains` on).
- Headers are applied via the `onSend` hook so they also appear on error
  responses, including 4xx/5xx coming from Fastify itself. Coverage lives in
  `apps/api/test/security-headers.test.ts`.

Helm hardening:

- The chart defaults are safe but minimal. Production overlays should set
  `api.autoscaling.enabled=true` (and optionally `web.autoscaling.enabled=true`)
  to enable the `HorizontalPodAutoscaler`. CPU target defaults to 75 percent
  and memory to 80 percent; tune via `api.autoscaling.targetCPUUtilizationPercentage`
  and `targetMemoryUtilizationPercentage`. The HPA replaces the static
  `replicas` field, so do not set both.
- `api.pdb.enabled`, `web.pdb.enabled`, and `embed.pdb.enabled` install a
  `PodDisruptionBudget` with `minAvailable: 1` per service. Turn these on
  before node drains during cluster upgrades.
- `networkPolicy.enabled=true` installs three `NetworkPolicy` objects:
  the API accepts traffic from `clawmind-web` and any pod labelled
  `clawmind.io/allow: api`; the web pod accepts the same set; the embed
  pod only accepts traffic from the API. Add ingress controllers via
  `networkPolicy.extraIngressNamespaceSelectors`. Set
  `networkPolicy.allowEgressToInternet=false` for fully air-gapped deploys.
- Every workload runs as `runAsNonRoot` UID 10001, drops `ALL` capabilities,
  and uses the `RuntimeDefault` seccomp profile. These satisfy the
  Pod Security Standards `restricted` profile.
- Resource limits are set for `api`, `web`, and `embed`. The embed sidecar
  defaults to 1 CPU and 2 GiB memory because the BGE model preload is the
  hot path; raise this for larger models.
- The chart is covered by `apps/api/test/helm-chart.test.ts` which shells
  out to `helm template` and asserts default vs hardened renders. Skipped
  when the `helm` CLI is not on PATH.

Prometheus Operator integration:

- `monitoring.serviceMonitor.enabled=true` installs a `ServiceMonitor` that
  scrapes the API Service on the named `http` port at `/metrics`. Set
  `monitoring.serviceMonitor.labels` to the label your Prometheus instance
  uses for `serviceMonitorSelector` (for kube-prometheus-stack the
  convention is `release: kube-prometheus-stack`). `interval` and
  `scrapeTimeout` default to 30s and 10s respectively, and
  `relabelings` / `metricRelabelings` pass through for advanced topologies.
- `monitoring.prometheusRule.enabled=true` installs a `PrometheusRule`
  with the four alerts listed under On-call below: `ClawmindApiDown`,
  `ClawmindApiHighErrorRate`, `ClawmindApiAskLatencyHigh`, and
  `ClawmindApiReadinessFlapping`. Thresholds and rate windows are tunable
  via `monitoring.prometheusRule.thresholds.*` so you can match them to
  your traffic profile without forking the chart. Every alert carries a
  `severity` label (`critical` or `warning`), a `service: clawmind-api`
  label for Alertmanager routing, and a `runbook` annotation pointing
  back to this section.
- Both objects are off by default and only render when their flag is
  flipped, so the chart still installs cleanly on clusters that do not
  have the `monitoring.coreos.com` CRDs registered. Coverage is locked
  down by `apps/api/test/helm-chart.test.ts`.

Backup and restore:

- The only stateful directory is `CLAWMIND_DATA_DIR`. Snapshot the PVC
  on a schedule (Velero, restic, or your cloud provider snapshotter).
- To restore: stop the API replicas, restore the volume, restart.
  Ingest is idempotent so a partial restore can be reconciled by
  re-running `clawmind ingest` against the source workspace.

Data lifecycle (GDPR):

- `GET /v1/me/export` returns a JSON bundle of every per-user record
  (history, conversations, saved searches, feedback votes, and API key
  metadata with hashes redacted). Served with a `Content-Disposition`
  attachment header so curl and browsers save it as a file. The export
  is written to the audit log with row counts.
- `DELETE /v1/me/data` erases every per-user record and returns a
  deletion report with counts. Body must be `{"confirm": "DELETE"}`.
  Shared feedback entries are updated in place: the calling user's vote
  is removed and counts are decremented, and entries that go to zero are
  dropped. Workspace scoped state (pins, mutes, aliases, tags, the
  ingest manifest, the embedding index) is left intact because it is
  shared across users. The deletion is written to the audit log.
- Both endpoints require authentication and are scoped to the calling
  user. There is no admin override that deletes another user's data
  from the API surface; operators do that by stopping the API and
  editing the data directory directly.

Continuous integration:

- The pipeline lives in `.github/workflows/ci.yml` and is gated behind the
  repository variable `ENABLE_CI=true`. The `guard` job emits an `enabled`
  output and every real job (`verify`, `audit`, `docker`) refuses to run
  unless that output is `'true'`. This keeps the gate honest: there is no
  silent skip, the gating expression is the same string in every job.
- `verify` runs `pnpm install --frozen-lockfile` then `pnpm typecheck`,
  `pnpm test`, and `pnpm build` end to end. A green run means the entire
  workspace typechecks, every package test suite passes, and every build
  target produces its declared `outputs`.
- `audit` runs `pnpm audit --prod --audit-level high`, so any high or
  critical advisory in a production dependency fails the build. Moderate
  and low advisories surface in the log without blocking.
- `docker` builds the `api`, `web`, and `embed` images from
  `infra/docker/*.Dockerfile` via `docker/build-push-action` with a GHA
  layer cache. The images are built but not pushed; this catches
  Dockerfile regressions before they hit `release.yml`.
- The workflow shape is locked down by `apps/api/test/ci-workflow.test.ts`
  so accidental edits (dropping the audit job, ungating a step, deleting
  a Dockerfile from the matrix) fail in `pnpm test` before they ship.

On-call:

- The four alerts shipped by `monitoring.prometheusRule.enabled=true`
  encode this section directly:
  - `ClawmindApiDown` pages when no API scrape target has been `up` for
    `thresholds.downFor` (default 2m).
  - `ClawmindApiHighErrorRate` pages on sustained
    `http_requests_errors_total` rate above `thresholds.errorRatePerSecond`
    over `thresholds.errorRateWindow`.
  - `ClawmindApiAskLatencyHigh` warns when the p95 of
    `http_request_duration_seconds_bucket{route="/v1/ask"}` exceeds
    `thresholds.askP95Seconds` (default 1s).
  - `ClawmindApiReadinessFlapping` warns when
    `kube_pod_container_status_ready` for the API container changes more
    than `thresholds.flapChanges` times in `thresholds.flapWindow`.
- Audit log growth stalling (indicating the writer is wedged) is not yet
  shipped as a built-in alert because it depends on whether you ship the
  audit log to a sidecar; add it as an extra rule in your own overlay.
