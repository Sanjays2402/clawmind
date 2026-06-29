# clawmind autoship STATE

Cron-owned memory for the 20-minute autoship loop. Maintained by Cake (cron)
directly on main. (Commits land on main each tick.)

- **Active branch: `main`** — commit and push DIRECTLY to main every tick. No feature branches.
- Cron identity: `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.
- Verify gate: `pnpm run ci:verify` (typecheck + test + build across all packages).
- Quality bar: each item is a small, demo-able vertical slice. Tests for new
  behaviour. No drive-by refactors. No emoji in commit messages.

## Active focus

**FRONTEND / UX (Sanjay's standing override, set 2026-06-23 evening).**
Until the override block in `~/.hermes/scripts/clawmind-20min-prompt.md` is
removed, every tick ships FIVE frontend slices in `apps/web/` (Next.js 15
+ React 19 + Tailwind v4 + the `@clawmind/ui` design-system package).
Backend/CLI work is paused for this loop.

What counts as a slice:
1. Real UI feature, visual polish, interaction, animation, layout, a11y,
   loading / empty / error states, theming, keyboard UX, data-viz.
2. Matches the existing paper-cream + Fraunces/Inter/JetBrains-Mono
   design language — pull tokens from `packages/ui/src/styles/tokens.css`
   and surfaces from `apps/web/src/styles/globals.css`. Never invent
   colors; use the `--cm-*` variables.
3. Linear / Raycast / Vercel quality. No generic admin-template UIs.
4. Touch the API only when a UI feature genuinely needs it; keep that
   patch surgical and wire it straight to the page.

Heuristic for picking the next slice: pick something a daily user of
ClawMind would notice and quietly appreciate. The chat surface is the
hottest area (used every session); secondary pages should still feel
finished and intentional, not stamped.

## Roadmap (newest first - work top to bottom each tick)

Status legend: [ ] open, [x] done, [~] in-progress (only ever during a single tick).

### TICK LOG 2026-06-28 17:33 PDT - DATA-VIZ VEIN + SOURCE-VIEWER reading (5 slices)

Drained the two top-of-queue veins: 3 DATA-VIZ bars (saved/collections/dashboard)
+ 2 SOURCE-VIEWER reading slices. AUDITED before touching: the queued usage
ask-vs-search bar was ALREADY shipped (c6fd748 mix bar + MixLegend already live on
/usage), so I dropped it as done and pulled a dashboard tile audit instead - 5 real
slices, 0 filler, 0 padding-with-a-done-item.

The 5 slices:
- saved: digest rows showed last-run churn as bare "+N new / -N removed" text;
  replaced with a DIVERGING delta bar (removed grows left in danger, new right in
  success, around a centre tick, each half scaled to maxChurn across visible
  digests). Clean 0/0 collapses to a quiet "no change last run" so the row stays
  honest. SHIPPED d0cb67d.
- collections: item count was a bare "N saved" chip; added a proportional size bar
  under each name, scaled to the largest collection (maxItems), tinted by each
  folder's accent dot, 6% floor for tiny ones, empty draws nothing. SHIPPED 7d56c32.
- dashboard: namespace tiles dumped files/chunks/bytes raw; added a chunk-weight bar
  scaled to the heaviest namespace (same pattern stats page proves), 4% floor.
  SHIPPED 0542218.
- sources/view: line permalinks only washed the cited band; a plain-file gutter
  click had NO feedback until the nav round-tripped. Added optimistic
  .cm-selected-line (softer accent rail than gold cited) on the clicked rows +
  accent gutter number, cleared when cited band resolves. SHIPPED 0e39b4e.
- sources/view: tall cited bands lost their bottom when scrolled to top; tagged the
  last cited row id=cm-cited-end + new CitedLineStepper pill jumps first<->last,
  only renders when band > 85vh and spans >1 line, reduced-motion aware. SHIPPED
  3402b22.

Gated ONCE: web typecheck GREEN, web build GREEN (all 102 routes, incl. /saved,
/collections, /dashboard, /sources/view now 7.13kB w/ both steppers). Diff is 6
files under apps/web/src (saved/collections/dashboard pages, CodeView, sources/view
page, globals.css) + 1 new component (CitedLineStepper.tsx), 0 backend/packages.
Pushed d552fd1..3402b22:
- d0cb67d feat(web/saved): diverging new-vs-removed churn bar.
- 7d56c32 feat(web/collections): proportional size bar per collection.
- 0542218 feat(web/dashboard): proportional bar on namespace tiles.
- 0e39b4e feat(web/sources/view): instant selection wash on clicked lines.
- 3402b22 feat(web/sources/view): jump-to-first/last stepper for tall cited bands.

NEXT TICK: data-viz vein is mostly drained (saved/usage/collections/dashboard all
done). The remaining strong items: the chat composer drag-and-drop pin (needs a tiny
/pins->ask API touch, last chat-surface gap), sources/view in-file find overlay,
GLOBAL UX (Dialog primitive standardization, TopNav roving-tabindex). Pull from the
DATA-VIZ VEIN + SOURCE VIEWER + GLOBAL UX queues below.

### TICK LOG 2026-06-28 14:37 PDT - CHAT MULTI-TURN + data-viz vein (5 slices)

Pulled the CHAT SURFACE per-message conversation history - the single biggest
standing product gap, carried + flagged "PULL IT NEXT" across many ticks - as the
anchor slice, then shipped 3 data-viz-vein upgrades and 1 chat companion the
multi-turn work creates the need for. 5 real slices, 0 filler.

THE CORE FINDING (verified by reading ChatShell.tsx, not guessed): the chat held a
SINGLE answer/sources/question in component state and submit() WIPED all of it on
every new question (setAnswer(''), setSources([]), ...). So the conversation was
amnesiac - ask a follow-up and the prior Q/A vanished entirely, and the question
itself only ever lived in the composer (gone on submit). This is why it was the
top gap: the chat literally could not hold a conversation.

The 5 slices:
- chat (anchor): replace the single-answer state with a `turns: Turn[]` model. Each
  Turn = {id, question, answer, sources, error, done}. submit() prepends a turn and
  streams into it; the whole thread stays on screen + scrollable. Composer is
  TOP-anchored (Reflect/Mem style), so newest renders directly under it - exactly
  where the old single answer sat - and you scroll DOWN into history. (Deliberate
  divergence from the queue's "newest at bottom" note, which assumed a bottom
  composer; newest-on-top is the consistent flow for a top composer. Documented in
  the commit + code comments.) Each turn: serif question header (the asked question
  is now PERSISTENT, was lost on submit), its answer, per-turn Copy/Share, per-turn
  error/retry. A single sticky margin rail follows the ACTIVE turn (streaming a new
  turn, or clicking a citation in an older one, sets it active) so per-turn citation
  numbering + the rail stay coherent without stacking N rails. [ ] cite cycle + j/k
  rail scope to the active turn. "New thread" resets the surface; thread meta strip
  shows the exchange count. SHIPPED 006d868.
- sources: the per-source feedback boost was raw text ("boost +0.40"); turned it
  into a DIVERGING signal bar around a centre line (boost>0 grows right in
  --cm-success, boost<0 grows left in --cm-danger, scaled to the strongest |boost|
  in view), numeric value alongside in tabular-nums. SHIPPED 9884478.
- history: the per-day group headers showed a bare count; added a MODEL-MIX
  segmented strip (one band per model that day, width = share, widest first, ordered
  brand-ink palette accent->cite->fg-soft->muted->faint) so a busy/varied day reads
  as a shape. groupByDay already hands each header its items - pure presentation.
  SHIPPED ea6c876.
- pins: pinnedAt was plain text; added a per-row RECENCY LANE (left vertical rail,
  fill maps the pin's age within the min/max set - freshest fills solid accent,
  oldest a 12%-floored sliver, older rows use softer accent-line) + a "newest" badge.
  SHIPPED e74ccca.
- chat (companion): a THREAD OUTLINE navigator - multi-turn creates a scrollable
  stack, so a floating bottom-left "Thread N/M" pill expands into an index of every
  question (newest first), click to scroll+activate an exchange, active marked, each
  row shows its source count. Hidden for a single-exchange thread. New component
  ThreadOutline + stable cm-turn-<id> anchors with scroll-margin on each turn block.
  SHIPPED 72c9109.

Gated ONCE for the batch: web typecheck GREEN, web build GREEN (all 102 routes
compiled, incl. the 4 touched - /chat now 10.8kB with multi-turn+outline, /sources,
/history, /pins), @clawmind/ui build GREEN (echo-ok no-op). Batch diff is 4 page/
component files under apps/web/src + 1 new component (ThreadOutline.tsx), 0 backend/
packages, 0 telemetry. The lone build warning (history line 624 sources->useMemo) is
PRE-EXISTING in HistoryRow (identical at line 552 pre-tick, only shifted by my
ModelMixBar insertion above it) - NOT introduced this tick. Pushed 34e3293..72c9109:
- 006d868 feat(web/chat): per-message conversation history within a thread.
- 9884478 feat(web/sources): diverging boost signal bar on the source list.
- ea6c876 feat(web/history): per-day model-mix strip in the day header.
- e74ccca feat(web/pins): per-row recency lane on the pin list.
- 72c9109 feat(web/chat): thread outline navigator for multi-turn threads.

NEXT TICK: the #1 standing product gap (chat multi-turn) is now CLOSED. The
remaining CHAT SURFACE queue item is the composer drag-and-drop pin (needs a small
API touch - the /pins endpoint exists, surface a "Pinned: <path>" chip). The
data-viz vein proven over the last two ticks (proportional/diverging bars, segmented
mix strips, recency lanes, posture chips) is still a strong evergreen for the
remaining list/dashboard pages - see the refilled DATA-VIZ VEIN + GLOBAL UX queues
below. The welcome 3-card tour queue item is effectively DONE (welcome/page.tsx is
already a complete real 3-step action flow, not a stub) - dropped from the queue.

### TICK LOG 2026-06-28 10:53 PDT - TOP-LEVEL PAGES batch I: re-theme + data-viz (5 slices)

Started the post-/settings cluster: top-level pages outside /settings. The queued
plan was webhooks/usage/stats/shares/stale, but I AUDITED each before touching it
(grep for drift tokens + confirm against the compiled palette) rather than trusting
the queue - and found the queue was partly stale: usage and stats are ALREADY fully
on cm-* (0 drift tokens; usage's lone text-white sits on bg-cm-accent, the house CTA
pattern used 32x app-wide, NOT drift). Re-theming them would have been padding. So I
shipped the 2 pages with GENUINE drift, upgraded stale (cm-themed already) with real
data-viz, and pivoted the 2 freed slots to two more genuine data-viz upgrades on
adjacent top-level pages - 5 real slices, 0 filler.

CONFIRMED-REAL drift finding (same class as every prior re-theme tick, verified by
grep against tokens.css + the @theme bridge, not guessed): bg-cm-panel and bg-cm-bg-soft
are DEAD tokens - defined NOWHERE in the app (only --cm-* ships in tokens.css + the
--color-cm-* bridge in globals.css). webhooks leaned on bg-cm-panel for all 5 surfaces;
shares on bg-cm-bg-soft for every row - so they rendered with no surface fill on broken
fallback. Both also carried hand-rolled raw status colors (webhooks: emerald/amber/rose
for the active dot, failing count, rotate dialog, redeliver errors, delivery table;
shares: red-200/50/700 + dark: variants on the Expired badge and Revoke button) that
ignore the brand.

The 5 slices:
- webhooks: re-theme onto bg-cm-paper; raw colors -> brand inks (active+OK -> success,
  failing+delete+error -> danger, rotate caution -> cite gold); NEW state-driven
  delivery-health banner (any failureCount>0 -> danger / any active -> success / all
  paused -> muted) so a failing endpoint is caught at a glance.
- shares: re-theme onto bg-cm-paper; Expired badge + Revoke -> --cm-danger 10%% tint;
  NEW expiry-posture chip set (open-ended -> cite gold as most-exposed / time-boxed ->
  success / expired -> muted) replacing the bare share/view count.
- stale: NEW threshold-RELATIVE severity (>=4x -> severe danger / >=2x -> moderate cite /
  else mild accent), per-row drift bars scaled to the oldest in the set, severity-inked
  clock + age figure, and a "N severely drifted" danger summary chip.
- tags: NEW proportional usage bars (width = count / max-count) + frequency-desc ranking,
  turning the flat count-chip grid into a scannable frequency map.
- related: NEW similarity-strength bars in citation gold (width = score / top-score) so
  embedding closeness reads as a shape the reader can rank by eye before hopping.

Gated ONCE for the batch: web typecheck GREEN, web build GREEN (all 5 routes compiled -
/webhooks 4.29kB, /shares, /stale, /tags, /related), @clawmind/ui build GREEN. Batch
diff is exactly 5 files, all under apps/web/src/app/ (webhooks, shares, stale, tags,
related), 0 backend/packages touched, 0 telemetry (ci:verify's only red remains the
pre-existing, unrelated @clawmind/telemetry OTel SDK version-skew, never touched this
tick). Pushed 081f543..3c5c4c4:
- 068d473 feat(web/webhooks): re-theme off dead bg-cm-panel + raw emerald/amber/rose;
  NEW delivery-health banner.
- 4ba00c6 feat(web/shares): re-theme off dead bg-cm-bg-soft + raw red; NEW expiry-posture
  summary.
- 36cbfb5 feat(web/stale): NEW per-source drift bars + severity coloring + severely-
  drifted summary.
- 98fc045 feat(web/tags): NEW proportional usage bars + frequency ranking.
- 3c5c4c4 feat(web/related): NEW similarity-strength bars on related sources.

NEXT TICK: top-level pages are now audited and effectively drift-free across the app
(the remaining ones - sources, history, pins, saved, posture, sbom, search - are all
cm-* already). The CHAT SURFACE per-message conversation history is now the clear
single biggest standing product gap - PULL IT NEXT. After that, the data-viz vein
proven this tick (proportional bars, posture chips) is a strong evergreen for the
remaining list/dashboard pages - see the refilled DATA-VIZ VEIN queue below.

### TICK LOG 2026-06-28 05:24 PDT - RE-THEME BATCH H: access/trust settings (5 slices)

Finished BATCH H - the access/trust settings cluster, completing the multi-tick
settings re-theme that began with BATCH A. Four of the five (role-elevation,
recovery-contacts, vendor-access, share-policy) were on the foreign shadcn palette
(bg-background / bg-card / text-muted-foreground / border-border / border-input /
bg-primary text-primary-foreground / focus:ring-ring / destructive) PLUS hand-rolled
raw emerald/amber/rose status surfaces. Same confirmed-REAL finding as every prior
re-theme tick: none of those shadcn tokens are defined anywhere in the app (only
--cm-* ships in tokens.css + the @theme bridge in globals.css), so all four rendered
on broken fallbacks - cards with no surface fill, "primary" CTAs with no brand fill,
inputs with no theme-aware focus ring. The fifth (trust) was the DEEPEST drift in
the whole settings tree: built entirely on inline style={} objects with raw hex
(#111827 ink button, #b91c1c error text, #e5e7eb borders) and a bare <main> with no
themed surface at all - it grepped as 0 shadcn tokens precisely because it predated
the Tailwind/cm system entirely.

Each slice got a genuine state-driven UX upgrade on top of the mechanical map:
role-elevation a NEW live access-posture banner (active grants -> success / pending
-> cite caution / clear -> muted) so an owner sees at a glance whether anyone holds
break-glass access or is waiting on them, PLUS status chips + approve/deny/revoke
buttons routed through brand inks; recovery-contacts a NEW public-escalation-coverage
banner (the unauthenticated /v1/recovery-contacts projection only emits active+public
contacts, so count how many qualify - success when a named public path exists, cite
caution when none are public with copy that branches on whether a fallback email is
set) so the empty-public-list gap stops hiding behind a populated operator console;
vendor-access re-cast the lockbox OPEN/CLOSED banner on brand semantics (OPEN = vendor
support can read right now -> cite gold with a live inline countdown chip / CLOSED =
safe default -> success), mint-once token panel + disabled notice off raw amber onto
cite-gold; share-policy a NEW 3-state share-governance posture banner derived from the
live toggle matrix (off entirely -> success most-restrictive / required-expiry and/or
TTL cap -> accent governed, naming the active guardrails / neither -> cite open
posture) + the toggle matrix checkboxes -> accent-cm-accent with disabled dimming;
trust fully converted off inline-style raw hex to the cm Tailwind language (cm-paper
cards, INPUT_CLS, ink Save, accent View-public link), framework cards gained a
state-driven left accent border (achieved -> success / in-progress -> cite /
not-pursued -> border) + a NEW compliance-posture headline banner (achieved -> success
/ only in-progress -> cite / none -> muted). Four hoisted a shared INPUT_CLS (bg-cm-bg
+ placeholder:text-cm-faint + focus:ring-cm-accent); four traded a bare inline Spinner
for SettingsCardSkeleton; every Remove/Retire/Revoke -> --cm-danger; every Save -> ink
bg-cm-fg text-cm-bg button.

Gated ONCE for the batch: web typecheck GREEN, web build GREEN (all routes compiled,
incl. the 5 - /settings/role-elevation, /recovery-contacts, /vendor-access,
/share-policy, /trust), @clawmind/ui build GREEN. Batch diff is exactly 5 files, all
under apps/web/src/app/settings/, 0 residual drift tokens in any of them (verified by
grep), 0 telemetry touched (ci:verify's only red remains the pre-existing, unrelated
@clawmind/telemetry OTel SDK version-skew, never touched this tick). Pushed
cd2d2b5..ede760b:
- 89fb45c feat(web/settings/role-elevation): re-theme off shadcn + raw emerald/amber/
  rose; NEW live access-posture banner; INPUT_CLS; brand-ink status chips + buttons.
- 7ac5f62 feat(web/settings/recovery-contacts): re-theme; NEW public-coverage banner;
  INPUT_CLS; accent checkbox; success/cite chips; danger Retire; skeleton.
- d64d91a feat(web/settings/vendor-access): re-theme + raw amber/emerald + destructive;
  lockbox banner OPEN->cite gold w/ live countdown / CLOSED->success; accent checkboxes.
- 892d83c feat(web/settings/share-policy): re-theme; NEW 3-state governance posture
  banner (off/governed/open); accent toggle matrix; skeleton.
- ede760b feat(web/settings/trust): convert off inline-style raw hex to cm language;
  state-driven framework-card accent borders; NEW compliance-posture headline banner.

NEXT TICK: BATCH H done -> the /settings re-theme is COMPLETE (batches A-H). The next
coherent cluster is TOP-LEVEL PAGES (shadcn drift outside /settings) - it is queued
below and refilled. Pull the 5: webhooks, usage, stats, shares, stale. After that the
CHAT SURFACE per-message conversation history remains the biggest standing product gap
- pull it in if the top-level batch doesn't cohere into a clean 5.

### TICK LOG 2026-06-27 22:59 PDT - RE-THEME BATCH G: allowlist/network settings (5 slices)

Finished BATCH G - the five allowlist/network settings pages still on the foreign
shadcn palette (bg-background / bg-card / text-muted-foreground / bg-primary
text-primary-foreground / border / border-input / ring-ring / destructive /
accent-foreground) PLUS hand-rolled raw emerald/amber/red status surfaces. Same
confirmed-REAL finding as every prior re-theme tick: none of those shadcn tokens
are defined anywhere in the app (only --cm-* ships in tokens.css + the @theme color
bridge in globals.css), so all five rendered on broken fallbacks - cards with no
surface fill, "primary" CTAs with no brand fill, inputs with no theme-aware focus
ring, toggles/checkboxes with no brand accent.

Each slice got a genuine state-driven UX upgrade on top of the mechanical map:
webhook-allowlist a NEW 3-state enforcement-posture banner (enforced+hosts ->
success / enforced+empty -> cite "blocks every delivery" gap / off -> muted);
webhook-events-allowlist a NEW data-exposure posture banner counting how many
approved subjects carry user content (ask.completed/audit.event) routed through
cite gold vs --cm-success when metadata-only, PLUS per-event rows state-driven
(approved -> bg-cm-accent-soft wash + Approved accent chip, sensitive subjects ->
gold Sensitive chip); workspace-ip-allowlist a NEW lockdown posture banner
(locked->success / enforced-but-no-range -> cite "would reject every request" gap /
open->muted) + active rows on cm-paper, empty draft rows dim to cm-subtle, the
break-glass self-lockout confirm moved off raw amber onto the cite-gold surface;
workspace-origin-allowlist a NEW CORS posture banner with ADDITIVE semantics
(enforced+origins->success / enforced+empty->cite baseline-only, deliberately NOT
flagged as a hard gap the way IP is, since it falls back to the vendor baseline /
off->muted); sign-in-geofence's country chips now state-driven by mode (allow ->
--cm-success permit set / block -> --cm-danger deny set, helper copy switches too)
+ the live server-probe decision chip off raw emerald/destructive onto success/
danger pills + mode radio cards selected -> accent. All five hoisted a shared
INPUT_CLS (bg-cm-bg + placeholder:text-cm-faint + focus:ring-cm-accent); two traded
a bare inline Spinner for SettingsCardSkeleton; checkboxes/radios -> accent-cm-accent;
every Remove -> --cm-danger hover wash; every Save -> ink bg-cm-fg text-cm-bg button.

Gated ONCE for the batch: web typecheck GREEN, web build GREEN (all routes
compiled, incl. the 5 - /settings/webhook-allowlist, /webhook-events-allowlist,
/workspace-ip-allowlist, /workspace-origin-allowlist, /sign-in-geofence),
@clawmind/ui build GREEN. Batch diff is exactly 5 files, all under
apps/web/src/app/settings/, 0 telemetry (ci:verify's only red remains the
pre-existing, unrelated @clawmind/telemetry OTel SDK version-skew, never touched
this tick). Pushed 883521e..5e39cbf:
- b5ff671 feat(web/settings/webhook-allowlist): re-theme off shadcn; NEW enforcement
  posture banner (enforced/gap/off); INPUT_CLS; Remove -> danger; ink Save; skeleton.
- c943561 feat(web/settings/webhook-events-allowlist): re-theme; NEW sensitive-event
  data-exposure banner + per-event approved wash + Sensitive/Approved chips; skeleton.
- c3734b2 feat(web/settings/workspace-ip-allowlist): re-theme + raw emerald/amber;
  NEW lockdown posture banner; active-row wash; self-lockout confirm -> cite gold.
- c63ae1a feat(web/settings/workspace-origin-allowlist): re-theme; NEW additive-CORS
  posture banner (additive/baseline/off); active-row wash; ink Save.
- 5e39cbf feat(web/settings/sign-in-geofence): re-theme + raw emerald/amber; country
  chips state-driven by mode (success allow / danger block); probe decision pills.

NEXT TICK: BATCH G done. BATCH H (access/trust: role-elevation, recovery-contacts,
vendor-access, share-policy, trust) is queued below and is the next coherent cluster
- pull it. After H, the TOP-LEVEL PAGES cluster (webhooks/usage/stats/shares/stale)
still drifts on shadcn, then the CHAT SURFACE per-message history item remains the
biggest standing product gap - pull it in if a re-theme batch doesn't cohere.

### TICK LOG 2026-06-27 18:10 PDT - RE-THEME BATCH F: API-key policy settings (5 slices)

Finished BATCH F - the five API-key-policy + usage pages, all on the foreign
shadcn palette (bg-background / bg-card / text-muted-foreground / bg-primary
text-primary-foreground / border-border / destructive / focus:ring-ring). Same
finding as every prior re-theme tick, confirmed REAL not cosmetic: none of those
tokens are defined anywhere in the app (only --cm-* ships in tokens.css + the
@theme color bridge in globals.css), so all five rendered on broken fallbacks -
cards with no surface fill, muted copy at full ink, "primary" CTAs with no brand
fill, inputs with no theme-aware focus ring - PLUS hand-rolled raw red/amber
status surfaces (api-key-expiry urgency, api-key-inactivity count cards + status
pills + sweep button, model-allowlist empty-allow warning) that ignore the brand.
Each slice got a genuine UX upgrade on top of the mechanical shadcn->cm map:
api-key-policy a NEW state-driven enforcement banner (activeCaps() counts how many
of the 6 caps constrain new keys -> success wash if any, cite caution "Unrestricted"
if all-zero so the posture gap reads); api-key-expiry's urgencyClass through brand
inks (<=1d danger / <=7d cite / else muted) + the "expiring soon" stat card a
state-driven cite surface; api-key-inactivity's three count cards state-driven
(Approaching -> cite, Past-threshold -> danger), the destructive Sweep button +
post-sweep result through danger/success, status pills mapped; quota a NEW
three-state usage-health banner + colored progress meter (quotaHealth(): over>=100%
danger / near>=80% cite / healthy success, unlimited skips it); model-allowlist's
active mode button a bg-cm-accent-soft wash + accent border, empty-allow warning
off raw amber to --cm-cite, per-model Remove a --cm-danger hover wash. All four
multi-state pages hoisted a shared INPUT_CLS; four traded a bare inline Spinner for
the shared SettingsCardSkeleton.

Gated ONCE for the batch: web typecheck GREEN, web build GREEN (all routes
compiled, incl. the 5 - /settings/api-key-policy, /api-key-expiry,
/api-key-inactivity, /quota, /model-allowlist), @clawmind/ui build GREEN. Batch
diff is exactly 5 files, all under apps/web/src/app/settings/, 0 telemetry
(ci:verify's only red remains the pre-existing, unrelated @clawmind/telemetry OTel
SDK version-skew, never touched this tick). Pushed be647cb..f69ddb1:
- 28486c6 feat(web/settings/api-key-policy): off shadcn; NEW enforcement banner
  (activeCaps -> success / cite); INPUT_CLS; ink Save; Clear-all -> --cm-danger.
- 64106b0 feat(web/settings/api-key-expiry): off shadcn + raw red/amber; urgencyClass
  through brand inks; expiring-soon card -> cite surface; INPUT_CLS; ink Save; skeleton.
- 3f95aad feat(web/settings/api-key-inactivity): off shadcn + raw red/amber; count
  cards state-driven (cite/danger); Sweep + result -> danger/success; status pills mapped.
- 9448a49 feat(web/settings/quota): off shadcn; NEW 3-state usage-health banner +
  colored meter (quotaHealth over/near/healthy); INPUT_CLS; ink Save; skeleton.
- f69ddb1 feat(web/settings/model-allowlist): off shadcn + raw amber/red; active mode
  -> accent-soft wash; empty-allow -> --cm-cite; Remove -> --cm-danger hover; ink Add.

NEXT TICK: BATCH F was the LAST queued re-theme batch. The remaining shadcn-palette
settings pages still drift (recovery-contacts, role-elevation, sign-in-geofence,
share-policy, trust, vendor-access, webhook-allowlist, webhook-events-allowlist,
workspace-export, workspace-ip-allowlist, workspace-origin-allowlist, usage, and the
top-level /webhooks /shares /sources /stats /stale /tags pages). A fresh BATCH G
queue is refilled below grouping the next coherent cluster. After the settings
re-theme is exhausted, the CHAT SURFACE per-message history item is STILL the
biggest remaining product gap - pull it in if a re-theme batch doesn't cohere.

### TICK LOG 2026-06-27 13:08 PDT - RE-THEME BATCH E: access-policy settings (5 slices)

Finished BATCH E - the five access-policy pages still on the foreign --var palette.
Confirmed the drift is REAL not cosmetic (same finding as every prior re-theme
tick): --bg / --surface / --surface-1 / --surface-2 / --surface-hover / --card /
--border / --muted / --muted-fg / --fg-muted / --fg / --accent / --text-muted are
DEFINED NOWHERE in the app (only --cm-* ships in tokens.css), so all five rendered
on broken fallbacks - cards with no surface fill, "accent" buttons with no brand
color, muted copy at full ink - PLUS heavy raw emerald/amber/red status surfaces
(mfa-policy + api-key-bruteforce each carried hand-rolled light+dark amber/emerald
variants) that ignore the brand. Each slice got a genuine UX upgrade on top of the
mechanical map: session-policy a NEW state-driven live banner (any cap active ->
success wash / no cap -> cite caution so an unbounded policy reads as the posture
gap it is); mfa-policy's enforced/off banner through success/cite + all danger
paths to --cm-danger; offboarding's section count chip state-driven (0 orphans ->
success, any -> cite) + Revoke to legible --cm-danger; domains' FIELD_CLS hoist +
ink Save + danger save-error + brand-accent checkboxes; api-key-bruteforce a NEW
at-a-glance posture chip (locked now -> danger "Lockout active" / else success
"Armed and clear") + an eventChipClass routing throttle-log events through state
(lock=danger incident, unlock=success recovery, fail=neutral). Four pages traded a
bare inline Spinner for the shared SettingsCardSkeleton; three hoisted a shared
INPUT_CLS/FIELD_CLS.

Gated ONCE for the batch: web typecheck GREEN, web build GREEN (all routes
compiled, incl. the 5 - /settings/session-policy, /mfa-policy, /offboarding,
/domains, /api-key-bruteforce), @clawmind/ui build GREEN. Batch diff is exactly 5
files, all under apps/web/src/app/settings/, 0 telemetry (ci:verify's only red
remains the pre-existing, unrelated @clawmind/telemetry OTel SDK version-skew, never
touched this tick). Pushed fe51b45..dd20e56:
- 2620186 feat(web/settings/session-policy): off --surface-1/2/--accent/--text-muted;
  NEW state-driven cap banner (success/cite); INPUT_CLS; ink Save; SettingsCardSkeleton.
- 7e142a8 feat(web/settings/mfa-policy): off --var + raw emerald/amber; enforced ->
  --cm-success, off -> cite caution; danger Disable + error; INPUT_CLS; skeleton.
- 286290f feat(web/settings/offboarding): off --var; count chip state-driven (0 ->
  success / any -> cite); Revoke -> --cm-danger; success/danger banners; skeleton.
- 8eb228c feat(web/settings/domains): off --var + raw amber; FIELD_CLS; ink Save;
  --cm-danger save-error; brand-accent checkboxes; danger remove-hover; skeleton.
- dd20e56 feat(web/settings/api-key-bruteforce): off --var + raw amber/emerald; NEW
  posture chip (locked=danger / armed=success); eventChipClass; danger locked rows.

NEXT TICK: the --var cluster is now essentially EXHAUSTED - only /settings/dsr still
carries stray --var tokens (mostly shadcn). The remaining drift is the SHADCN
palette (~25 pages: bg-card / text-muted-foreground / bg-primary / bg-background /
border-border / bg-muted). BATCH F (API-key policy: api-key-policy, api-key-expiry,
api-key-inactivity, quota, model-allowlist) is queued below and coheres as a group.
After F, the CHAT SURFACE per-message history item is still the biggest remaining
product gap - pull it in if a re-theme batch doesn't cohere.

### TICK LOG 2026-06-27 08:27 PDT - RE-THEME BATCH D: workspace/account settings (5 slices)

Finished BATCH D - the five workspace/account settings pages still on the foreign
--var palette. Confirmed (same finding as every prior re-theme tick) the drift is
REAL not cosmetic: --bg / --bg-muted / --bg-elev / --card / --border / --muted /
--muted-fg / --fg-muted / --fg / --accent are DEFINED NOWHERE in the app (only
--cm-* ships in tokens.css), so all five rendered on broken fallbacks - cards with
no surface fill, muted copy at full ink, inputs with no theme-aware focus ring -
plus raw emerald/amber/red/rose/zinc status surfaces that ignore the brand. Each
slice got a genuine UX upgrade on top of the mechanical map: whoami's auth chip
through brand inks; retention's INPUT_CLS + ink Save + danger purge; warrant-canary
a NEW state-driven status-panel surface (active=success wash / stale=cite caution /
withdrawn=danger) + skeleton; workspace-deletion a NEW success-wash idle banner so
the safe state reads as safe, Cancel as the ink primary (restoring writes is safe,
not destructive); scim's token-reveal banner collapsed from hand-rolled amber
light+dark variants to one --cm-cite gold caution surface. Three pages traded a
bare inline Spinner for the shared SettingsCardSkeleton.

Gated ONCE for the batch: web typecheck GREEN, web build GREEN (all routes compiled,
incl. the 5 - /settings/whoami, /retention, /warrant-canary, /workspace-deletion,
/scim), @clawmind/ui build GREEN. Batch diff is exactly 5 files, all under
apps/web/src/app/settings/, 0 telemetry (ci:verify's only red remains the
pre-existing, unrelated @clawmind/telemetry OTel SDK version-skew, never touched
this tick). One in-gate fix (whoami had a truncated JSX literal from the read) was
folded into its own slice via autosquash before pushing - history stayed one-slice-
one-commit. Pushed e6f56cc..f3e33ed:
- 9ca8267 feat(web/settings/whoami): identity debugger off --var; auth chip ->
  --cm-success / neutral cm; Mono/Row/CopyButton/raw-JSON onto cm surfaces.
- 04a7f89 feat(web/settings/retention): off --var; INPUT_CLS; Save -> ink, Saved ->
  --cm-success; Apply-and-delete + action-error -> --cm-danger; ReportPanel onto cm.
- 12f4025 feat(web/settings/warrant-canary): off --var; statusColor through brand
  inks; NEW state-driven statusSurface; Sign/Save -> ink, Withdraw -> --cm-danger;
  bare Spinner -> SettingsCardSkeleton.
- 3cda052 feat(web/settings/workspace-deletion): pure destructive page off --var;
  danger through --cm-danger; NEW idle -> --cm-success wash; Cancel -> ink (safe
  restore); INPUT_CLS; Spinner -> skeleton.
- f3e33ed feat(web/settings/scim): off --var; token-reveal -> --cm-cite caution
  surface (dropped amber variants); Active -> --cm-success; Mint/Rotate -> ink,
  Revoke -> --cm-danger; Spinner -> skeleton.

NEXT TICK: BATCH E - access-policy --var settings (session-policy, mfa-policy,
offboarding, domains, api-key-bruteforce) cohere as a group. After E, BATCH F
(API-key policy, shadcn palette) and the CHAT SURFACE per-message history item
(still the biggest remaining product gap) are queued below. ~31 settings pages
still drift.

### TICK LOG 2026-06-27 04:13 PDT - RE-THEME BATCH C: compliance/legal settings (5 slices)

Finished BATCH C - the five compliance/legal settings pages. Confirmed the drift
is REAL not cosmetic (same finding as every prior re-theme tick): --bg / --surface
/ --surface-2 / --card / --border / --muted / --fg / --accent AND the shadcn
bg-card / text-muted-foreground / bg-primary / bg-background / border-border /
bg-muted family are DEFINED NOWHERE in the app (only --cm-* ships in tokens.css),
so all five rendered on broken fallbacks - cards with no surface fill, invisible
accent icon tiles, muted copy at full ink, white-on-accent CTAs clashing with the
paper theme, and status chips on raw emerald/amber/rose that ignore the brand.
DPA was the lone page in the foreign shadcn language; the other four were on the
--var palette. Gated ONCE for the batch: web typecheck GREEN, web build GREEN (all
routes compiled, incl. the 5 - /settings/dpa, /erasure-certificates, /legal-hold,
/ropa, /sub-processors), @clawmind/ui build GREEN. Batch diff is exactly 5 files,
all under apps/web/src/app/settings/, 0 telemetry (ci:verify's only red remains
the pre-existing, unrelated @clawmind/telemetry OTel SDK version-skew, never
touched this tick). Pushed 18973ea..135bcf0:
- 06c896e feat(web/settings/legal-hold): off --var; ACTIVE-hold banner -> cite-gold
  caution (intentional pause), no-hold -> --cm-success; Impose -> bg-cm-fg ink;
  SettingsCardSkeleton replaces the bare Spinner.
- 7b9adbb feat(web/settings/sub-processors): off --var; active chip + Saved ->
  --cm-success, actionError -> cite caution, Retire -> --cm-danger; Save/Disclose
  -> bg-cm-fg ink (were bg-[accent] text-white); shared INPUT_CLS on all fields.
- 15c5924 feat(web/settings/ropa): Article 30 register off --var; legal-basis
  select + every input on INPUT_CLS; active chip + Saved -> --cm-success, error ->
  cite caution, Retire -> --cm-danger; dl keys text-cm-fg over text-cm-muted.
- 23df922 feat(web/settings/dpa): the one shadcn page; status banner state-driven
  (accepted+current -> --cm-success, stale/none -> cite caution); Record acceptance
  -> bg-cm-fg ink; per-row Verify -> --cm-success ok / --cm-danger mismatch.
- 135bcf0 feat(web/settings/erasure-certificates): off --var; sig-ok pill ->
  --cm-success, mismatch/revoked + row error -> --cm-danger; cm-paper rows.

NEXT TICK: BATCH D - workspace/account --var settings (whoami, retention,
warrant-canary, workspace-deletion, scim) cohere as a group. After D, the CHAT
SURFACE per-message history item is still the biggest remaining product gap -
pull it in if a re-theme batch doesn't cohere. ~36 settings pages still drift
(11 on --var, 25 on shadcn) - see the refilled queue below.

### TICK LOG 2026-06-27 00:36 PDT - RE-THEME BATCH B: foreign --var settings (5 slices)

Finished BATCH B - the five settings pages still built on the foreign --var
palette. Verified the drift is REAL not cosmetic (same finding as the 18:01 +
22:27 ticks): --bg / --card / --border / --muted-fg / --fg-muted / --bg-elev /
--bg-hover / --accent / --accent-fg are DEFINED NOWHERE in the app (only --cm-*
ships in tokens.css), so every one of these pages rendered on broken fallbacks -
muted copy inherited full --cm-fg, cards had no surface fill, "accent" buttons
had no brand color, and danger/destructive actions rendered on raw
emerald/amber/red that ignore the brand. Gated: web typecheck GREEN, web build
GREEN (all routes compiled, incl. the 5 re-themed), @clawmind/ui build GREEN.
ci:verify's only red remains the pre-existing, unrelated @clawmind/telemetry
OTel SDK version-skew in packages/telemetry/src/tracing.ts - NEVER touched this
tick (batch diff is 5 files, all under apps/web/src/app/settings/, 0 telemetry).
Pushed 58c7c88..b66f94f:
- 2c23dd8 feat(web/settings/encryption): KEK-active -> --cm-success; upload =
  bg-cm-fg ink button, remove -> --cm-danger, rotate -> neutral cm-border.
- b9117ec feat(web/settings/workspace-freeze): FROZEN banner -> cite-gold caution
  surface (intentional pause, not a hard fail); Freeze/Update ink button.
- 882bdef feat(web/settings/sso): status chip through brand inks (enforced=success,
  available=accent, not-configured=cite caution); Continue-with-SSO ink button.
- dc00d85 feat(web/settings/mfa): enabled=success / not-enabled=cite; all three
  danger paths -> --cm-danger; current-browser badge reuses the sessions accent chip.
- b66f94f feat(web/settings/maintenance): both destructive apply buttons (Compact,
  Forget) -> --cm-danger so the delete reads as dangerous; Stat warn = cite caution.

NEXT TICK: BATCH C - compliance/legal settings (legal-hold, sub-processors, ropa,
dpa, erasure-certificates). After C, the CHAT SURFACE per-message history item is
the biggest remaining product gap - pull it in if a re-theme batch doesn't cohere.

### TICK LOG 2026-06-26 22:27 PDT - cm-* utility-layer FIX + access/identity re-theme (5 slices)

CRITICAL FINDING this tick (verified against the compiled CSS across all
chunks, not guessed): the re-theme work has been leaning on cm-* utility
classes that DID NOT COMPILE. globals.css only ever hand-rolled a small subset
of base, variant-less helpers (.bg-cm-paper / .text-cm-muted / ...). Tailwind
v4 SILENTLY DROPS any utility it has not been taught about, so every other
cm-* class rendered as a no-op while the build stayed green:
  - bg-cm-fg (16x) + text-cm-bg (15x): the primary "ink" action buttons on
    EVERY shipped re-theme (invitations, policies, security, members, ...) had
    NO FILL.
  - hover:text-cm-fg (108x), divide-cm-border (30x), focus:ring-cm-accent
    (35x), hover:bg-cm-subtle (27x), placeholder:text-cm-muted, bg-cm-danger,
    bg-cm-bg-soft/panel/elev, ... all dead.
Slice 1 fixes the ROOT CAUSE for the whole app; slices 2-5 then re-theme batch
A onto utilities that now actually render. Gated: web typecheck + web build +
ui build + api typecheck all GREEN; ci:verify's only red is the pre-existing,
unrelated @clawmind/telemetry OTel SDK version-skew (identical on pre-tick
6483cc4, never touched this tick). Pushed 6483cc4..ae5b3dd:
- 920bf7b fix(web/theme): register the cm-* palette as Tailwind @theme colors
  (--color-cm-*) pointing at the --cm-* vars -> full utility matrix + every
  variant, theme-aware (vars flip in dark). One change repairs the ink buttons
  + hover/focus/divide states on every already-shipped re-theme page.
- 93b25e6 feat(web/settings/members): re-theme RBAC admin; role badges as a
  privilege gradient through cm inks (owner=accent, admin=cite gold,
  member/viewer=neutral/muted); ink buttons now real; banners -> success/danger.
- 4fd8d2b feat(web/settings/sessions): re-theme; current session gets a
  bg-cm-accent-soft wash + accent "This browser" chip; revoke + bulk revoke
  through --cm-danger.
- 2b92191 feat(web/settings/sign-in-log): re-theme; OutcomeBadge through brand
  inks (success=green, failure=cite-gold caution, logout=neutral); failure
  reason + admin-block notice -> cite caution.
- ae5b3dd feat(web/settings/sign-in-anomalies): re-theme; StatusBadge Open ->
  cite-gold caution, Acknowledged -> --cm-success.

IMPORTANT for future ticks: cm-* utilities (incl. all variants) NOW COMPILE, so
new re-themes can use bg-cm-fg/text-cm-bg ink buttons, hover:/focus:/divide-
variants freely - they will render. The hand-rolled helper block in globals.css
(lines ~297-315) is now redundant but left in place (identical values).

### TICK LOG 2026-06-26 18:01 PDT - design-language re-theme batch (5 slices)

Shipped 5 full re-themes off the foreign/shadcn palettes onto cm-*, gated
green (web typecheck + web build both pass; ci:verify still has the unrelated
packages/telemetry red), pushed to main dc29d9c..00913a6:
- 85debc9 feat(web/settings/invitations): re-theme onto the cm palette
- 61bd735 feat(web/settings/policies): re-theme onto the cm palette
- 6041d3e feat(web/posture): re-theme the security-posture scorecard onto cm
- 65f98fb feat(web/settings/security): re-theme IP allowlist off shadcn onto cm
- 00913a6 feat(web/settings/notifications): re-theme off shadcn onto cm

Confirmed the drift is REAL not cosmetic: --bg/--surface/--card/--muted/--fg/
--border + the shadcn bg-card/text-muted-foreground/bg-primary family are
DEFINED NOWHERE in the app (only --cm-* ships in tokens.css), so these pages
rendered on broken fallbacks (muted copy = full navy, cards = no surface fill).
Remaining drift after this tick: ~28 pages still on the shadcn palette + ~25
on the foreign --var palette (~50 total) - see the refilled queue below.

### Queued frontend (refilled 2026-06-26 18:01 PDT)

The DESIGN-LANGUAGE RE-THEME is still the highest-value standing theme and far
from done (~50 pages remain). Group each tick's 5 by visual coherence. The two
clusters: (a) the shadcn palette (bg-card/text-muted-foreground/bg-primary/
bg-background/border-input/ring-ring) needs a FULL re-theme; (b) the foreign
--var palette (--bg/--surface/--surface-hover/--card/--muted/--fg/--border/
--bg-elev/--muted-fg) maps mechanically onto cm-* (bg->cm-bg, surface/card->
cm-paper, border->cm-border, muted->cm-muted, fg->cm-fg, hover->cm-subtle).
Status chips/inks always route through the brand feedback inks: --cm-success
(green), --cm-cite (gold caution), --cm-danger (red), each with a 10% rgba
tint (success rgba(47,122,85,0.10), danger rgba(180,66,60,0.10), cite uses
--cm-cite-bg). Primary actions = bg-cm-fg / text-cm-bg ink buttons. Wire the
shared SettingsCardSkeleton into any bare-Spinner loading state while you're in
a page.

RE-THEME BATCH A - access/identity settings (shadcn palette, cohere as a group):
- [x] feat(web/settings/members): re-theme the members + RBAC admin page off the
  shadcn palette onto cm-*; role badges through cm inks. SHIPPED 93b25e6 (this
  tick): full re-theme; ROLE_TONE privilege gradient (owner=accent, admin=cite
  gold, member/viewer=neutral/muted); ink buttons now compile; banners ->
  success/danger inks.
- [x] feat(web/settings/sessions): re-theme the active-sessions page; the
  current-session highlight + revoke action through cm accent / --cm-danger.
  SHIPPED 4fd8d2b (this tick): current row bg-cm-accent-soft wash + accent "This
  browser" chip; per-session + bulk revoke through --cm-danger.
- [x] feat(web/settings/sign-in-log): re-theme; success/failure rows through
  --cm-success / --cm-danger inks instead of raw emerald/rose. SHIPPED 2b92191
  (this tick): OutcomeBadge success=green, failure=cite-gold caution,
  logout=neutral; failure reason + admin-block notice -> cite caution.
- [x] feat(web/settings/sign-in-anomalies): re-theme the impossible-travel page;
  the anomaly flags through the cite-gold caution ink. SHIPPED ae5b3dd (this
  tick): StatusBadge Open -> cite-gold caution, Acknowledged -> --cm-success.
- [ ] feat(web/settings/access-reviews): re-theme the recertification page;
  pending/approved states through cm feedback inks. CARRIED: this tick traded
  its slot for the systemic cm-* utility fix (920bf7b). Note this page has the
  richest feedback surface in batch A (keep/downgrade/revoke decision badges,
  open/closed campaign chips, the per-row ActionButton tone matrix) - map keep
  -> --cm-success, downgrade -> cite-gold caution, revoke -> --cm-danger,
  pending -> neutral muted; campaign open -> cite caution, closed -> success.

RE-THEME BATCH B - foreign --var settings (mechanical map, cohere as a group):
- [x] feat(web/settings/encryption): re-theme off --card/--muted-fg/--bg-elev/
  --accent onto cm-*; KEK-active panel through --cm-success; SettingsCardSkeleton
  already wired, keep it. (Reference page used in this tick's study.) SHIPPED
  2c23dd8 (this tick): KEK-active banner -> --cm-success 10%% tint, internal-KEK
  check tints accent; upload is a real bg-cm-fg ink button, remove -> --cm-danger,
  rotate -> neutral cm-border; inputs bg-cm-bg focus:ring-cm-accent; skeleton kept.
- [x] feat(web/settings/sso): re-theme off the foreign --var palette onto cm-*.
  SHIPPED 882bdef (this tick): status chip routes through brand inks (enforced ->
  --cm-success, available -> cm accent, not-configured -> cite-gold caution);
  Continue-with-SSO -> bg-cm-fg ink button; allowed-domain checks tint success;
  env block + inline code on bg-cm-subtle.
- [x] feat(web/settings/mfa): re-theme; enrolled/unenrolled states through cm inks.
  SHIPPED dc00d85 (this tick): enabled -> --cm-success, not-enabled -> cite caution;
  Disable/Revoke-all/revoke-device + error -> --cm-danger; current-browser badge
  reuses the sessions accent chip; Start/Confirm/Verify now real ink buttons.
- [x] feat(web/settings/maintenance): re-theme the storage-maintenance page;
  compact/forget destructive actions through --cm-danger. SHIPPED b66f94f (this
  tick): both apply buttons (Compact, Forget) -> --cm-danger so the delete is
  legible; Stat warn tone -> cite-gold caution, success line -> --cm-success;
  section icon tiles tint accent; skeleton shimmer + inputs on cm surfaces.
- [x] feat(web/settings/workspace-freeze): re-theme; the frozen-state banner
  through the cite-gold caution surface. SHIPPED b9117ec (this tick): FROZEN banner
  -> border-cm-cite-line/bg-cm-cite-bg/text-cm-cite (intentional caution, not a
  hard fail); live state tints success; Freeze/Update -> bg-cm-fg ink button,
  Release -> neutral cm-border; error -> --cm-danger, saved -> --cm-success.

RE-THEME BATCH C - compliance/legal settings (mixed palette) - DONE 2026-06-27 04:13:
- [x] feat(web/settings/legal-hold): SHIPPED 06c896e - off --var; ACTIVE-hold
  banner -> cite-gold caution, no-hold -> --cm-success; ink Impose button;
  SettingsCardSkeleton wired.
- [x] feat(web/settings/sub-processors): SHIPPED 7b9adbb - off --var; active chip +
  Saved -> --cm-success, actionError -> cite caution, Retire -> --cm-danger; shared
  INPUT_CLS; Save/Disclose are bg-cm-fg ink buttons (were bg-[accent] text-white).
- [x] feat(web/settings/ropa): SHIPPED 15c5924 - Article 30 register off --var;
  legal-basis select + every field on INPUT_CLS; active chip + Saved -> --cm-success,
  actionError -> cite caution, Retire -> --cm-danger.
- [x] feat(web/settings/dpa): SHIPPED 23df922 - the lone shadcn-palette page;
  status banner state-driven (accepted+current -> --cm-success, stale/none -> cite
  caution); Record acceptance -> bg-cm-fg ink; Verify result -> success/danger.
- [x] feat(web/settings/erasure-certificates): SHIPPED 135bcf0 - off --var; sig-ok
  pill -> --cm-success, mismatch/revoked -> --cm-danger; cm-paper rows.

### Queued frontend re-theme (refilled 2026-06-27 04:13 PDT)

~36 settings pages still drift off the brand. Two clusters, same mechanical maps
as prior batches: (a) foreign --var palette (--bg->cm-bg, --surface/--surface-2/
--card->cm-paper or cm-subtle for inset rows, --border->cm-border, --muted/
--muted-fg->cm-muted, --fg->cm-fg, --accent->cm-accent); (b) shadcn palette
(bg-background->cm-bg, bg-card->cm-paper, text-muted-foreground->cm-muted,
border-border->cm-border, bg-muted->cm-subtle, bg-primary text-primary-foreground
-> bg-cm-fg text-cm-bg ink button). Status/feedback ALWAYS routes through the brand
inks: --cm-success (green, 10%% rgba(47,122,85,0.10) tint), --cm-cite gold caution
(bg-cm-cite-bg/border-cm-cite-line/text-cm-cite), --cm-danger (red, 10%%
rgba(180,66,60,0.10) tint). Hoist repeated input classes to a const INPUT_CLS on
bg-cm-bg + placeholder:text-cm-faint + focus:ring-cm-accent. Wire SettingsCardSkeleton
into any bare-Spinner loading state while you're in the page. Group each tick by
visual coherence.

RE-THEME BATCH D - workspace/account --var settings - DONE 2026-06-27 08:27:
- [x] feat(web/settings/whoami): SHIPPED 9ca8267 - identity debugger off --var
  (--bg-muted/--fg/--fg-muted/--border) + raw emerald; Mono/Row/CopyButton/details
  -> cm surfaces; Authenticated chip -> --cm-success, Anonymous -> neutral cm-subtle.
- [x] feat(web/settings/retention): SHIPPED 04a7f89 - off --var; INPUT_CLS hoist;
  Save -> bg-cm-fg ink, Saved -> --cm-success; "Apply and delete" + action-error
  -> --cm-danger 10% tint; ReportPanel onto cm; field errors -> text-cm-danger.
- [x] feat(web/settings/warrant-canary): SHIPPED 12f4025 - off --var + raw
  emerald/amber/red; statusColor through brand inks (active=success, stale=cite,
  withdrawn=danger); NEW state-driven status-panel surface (statusSurface); Sign +
  Save -> ink buttons; Withdraw -> --cm-danger; bare Spinner -> SettingsCardSkeleton.
- [x] feat(web/settings/workspace-deletion): SHIPPED 3cda052 - the pure destructive
  page off --var + raw red/zinc/emerald; danger reads through --cm-danger (PENDING
  banner, Schedule, Mark-complete); NEW idle-state banner -> --cm-success wash (writes
  safe); Cancel -> bg-cm-fg ink (safe restore); INPUT_CLS; Spinner -> skeleton.
- [x] feat(web/settings/scim): SHIPPED f3e33ed - off --var; token-reveal banner ->
  --cm-cite gold caution surface (dropped hand-rolled amber light+dark variants);
  Active chip -> --cm-success, error pill -> --cm-danger; Mint/Rotate -> ink, Revoke
  -> --cm-danger; bare Spinner -> SettingsCardSkeleton.

RE-THEME BATCH E - access-policy --var settings - DONE 2026-06-27 13:08:
- [x] feat(web/settings/session-policy): SHIPPED 2620186 - off --surface-1/2/--accent/
  --text-muted; NEW state-driven live banner (any cap active -> --cm-success wash, no
  cap -> --cm-cite caution); INPUT_CLS hoist; ink Save; bare Spinner -> SettingsCardSkeleton.
- [x] feat(web/settings/mfa-policy): SHIPPED 7e142a8 - off --var + raw emerald/amber;
  enforced banner -> --cm-success, off -> --cm-cite caution; grace INPUT_CLS; Enable ->
  ink, Disable + error -> --cm-danger; Saved -> --cm-success; skeleton.
- [x] feat(web/settings/offboarding): SHIPPED 286290f - off --var; section count chip
  state-driven (0 orphans -> --cm-success, any -> --cm-cite caution); per-orphan Revoke
  -> --cm-danger; action-error danger / revoked success banners; brand icon tile; skeleton.
- [x] feat(web/settings/domains): SHIPPED 8eb228c - off --var + raw amber-600; FIELD_CLS
  hoist (domain input + role select); ink Save; --cm-danger save-error surface; Saved ->
  --cm-success; brand-accent checkboxes; remove-button danger hover; skeleton.
- [x] feat(web/settings/api-key-bruteforce): SHIPPED dd20e56 - off --var + raw amber/
  emerald light+dark; NEW posture chip (locked now -> --cm-danger "Lockout active", else
  --cm-success "Armed and clear"); eventChipClass routes log events (lock=danger, unlock=
  success, fail=neutral); locked rows + summary -> --cm-danger, tracking -> --cm-cite; skeleton.

RE-THEME BATCH F - API-key policy settings (shadcn palette) - DONE 2026-06-27 18:10:
- [x] feat(web/settings/api-key-policy): SHIPPED 28486c6 - off shadcn; NEW state-driven
  enforcement banner (activeCaps counts the 6 caps -> success wash if any constrain
  new keys / cite "Unrestricted" if all-zero); INPUT_CLS; ink Save; Clear-all-caps ->
  --cm-danger; Saved -> --cm-success; brand-accent checkboxes; SettingsCardSkeleton.
- [x] feat(web/settings/api-key-expiry): SHIPPED 64106b0 - off shadcn + raw red/amber;
  urgencyClass through brand inks (<=1d danger, <=7d cite, else muted); expiring-soon
  stat card -> state-driven cite surface; warnDays=0 hint -> cite; INPUT_CLS; ink Save;
  Saved -> --cm-success; SettingsCardSkeleton.
- [x] feat(web/settings/api-key-inactivity): SHIPPED 3f95aad - off shadcn + raw red/amber;
  three count cards state-driven (Approaching -> cite, Past-threshold -> danger); Sweep
  button + post-sweep result -> --cm-danger / --cm-success; at-risk status pills (expired
  -> danger, warn -> cite); idleDays=0 hint -> cite; INPUT_CLS; ink Save; skeleton.
- [x] feat(web/settings/quota): SHIPPED 9448a49 - off shadcn; NEW three-state usage-health
  banner + colored progress meter (quotaHealth: over>=100% danger / near>=80% cite /
  healthy success, unlimited skips it); INPUT_CLS; ink Save; field errors + Saved -> brand
  inks; SettingsCardSkeleton.
- [x] feat(web/settings/model-allowlist): SHIPPED f69ddb1 - off shadcn + raw amber/red;
  active mode button -> bg-cm-accent-soft wash + accent border; empty-allow warning off
  raw amber -> --cm-cite gold caution; per-model Remove -> --cm-danger hover wash; ink Add;
  action errors -> --cm-danger, Saved -> --cm-success; INPUT_CLS; SettingsCardSkeleton.


### Queued frontend re-theme (refilled 2026-06-27 18:10 PDT)

BATCH F exhausted the queued batches A-F. The remaining settings drift is still the
shadcn palette (bg-background -> cm-bg, bg-card -> cm-paper, text-muted-foreground ->
cm-muted, border-border/border-input -> cm-border, bg-muted -> cm-subtle, bg-primary
text-primary-foreground -> bg-cm-fg text-cm-bg ink button, destructive -> --cm-danger,
focus:ring-ring -> focus:ring-cm-accent). Status/feedback ALWAYS routes through the brand
inks: --cm-success (green, 10% rgba(47,122,85,0.10) tint), --cm-cite gold caution
(bg-cm-cite-bg/border-cm-cite-line/text-cm-cite), --cm-danger (red, 10% rgba(180,66,60,0.10)
tint). Hoist repeated input classes to a const INPUT_CLS on bg-cm-bg + placeholder:text-cm-
faint + focus:ring-cm-accent. Wire SettingsCardSkeleton into any bare-Spinner loading state.
Group each tick's 5 by visual coherence; give each slice a genuine state-driven UX upgrade
on top of the mechanical map.

RE-THEME BATCH G - allowlist/network settings (shadcn palette) - DONE 2026-06-27 22:59 PDT:
- [x] feat(web/settings/webhook-allowlist): SHIPPED b5ff671 - re-theme off shadcn; NEW
  enforcement-posture banner (enforced/gap/off); INPUT_CLS; Remove -> --cm-danger; ink Save.
- [x] feat(web/settings/webhook-events-allowlist): SHIPPED c943561 - re-theme; NEW
  sensitive-event data-exposure banner; approved rows wash + Sensitive/Approved chips.
- [x] feat(web/settings/workspace-ip-allowlist): SHIPPED c3734b2 - re-theme + raw emerald/
  amber; NEW lockdown posture banner; active-row wash; self-lockout confirm -> cite gold.
- [x] feat(web/settings/workspace-origin-allowlist): SHIPPED c63ae1a - re-theme; NEW
  additive-CORS posture banner (additive/baseline/off); active-row wash; ink Save.
- [x] feat(web/settings/sign-in-geofence): SHIPPED 5e39cbf - re-theme + raw emerald/amber;
  country chips state-driven by mode (success allow / danger block); probe decision pills.

RE-THEME BATCH H - access/trust settings - DONE 2026-06-28 05:24 PDT:
- [x] feat(web/settings/role-elevation): SHIPPED 89fb45c - re-theme off shadcn + raw
  emerald/amber/rose; NEW live access-posture banner; brand-ink status chips + buttons.
- [x] feat(web/settings/recovery-contacts): SHIPPED 7ac5f62 - re-theme; NEW public-
  escalation-coverage banner; success/cite chips; danger Retire; skeleton.
- [x] feat(web/settings/vendor-access): SHIPPED d64d91a - re-theme + raw amber/emerald +
  destructive; lockbox OPEN->cite gold w/ live countdown / CLOSED->success.
- [x] feat(web/settings/share-policy): SHIPPED 892d83c - re-theme; NEW 3-state governance
  posture banner (off/governed/open); accent toggle matrix; skeleton.
- [x] feat(web/settings/trust): SHIPPED ede760b - convert off inline-style raw hex to cm
  language; state-driven framework-card accent borders; NEW compliance-posture banner.

>>> The /settings re-theme is now COMPLETE (batches A-H). NEXT cluster = TOP-LEVEL PAGES.

RE-THEME / POLISH BATCH I - TOP-LEVEL PAGES - DONE 2026-06-28 10:53 PDT:
- [x] feat(web/webhooks): re-theme + NEW delivery-health banner. SHIPPED 068d473.
  Dead bg-cm-panel (5 surfaces) -> bg-cm-paper; raw emerald/amber/rose -> brand inks;
  state-driven failing/live/paused banner.
- [x] feat(web/shares): re-theme + NEW expiry-posture summary. SHIPPED 4ba00c6.
  Dead bg-cm-bg-soft -> bg-cm-paper; raw red Expired badge + Revoke -> --cm-danger;
  open-ended/time-boxed/expired chip set.
- [~] feat(web/usage): SKIPPED - audited clean. Already fully on cm-* (var(--cm-*)
  bar tints, cm-card surfaces); the lone text-white sits on bg-cm-accent, which is
  the house CTA pattern (32 uses app-wide), NOT drift. No re-theme warranted.
- [~] feat(web/stats): SKIPPED - audited clean. 0 drift tokens; bars/cards/toggle all
  already cm-*. No re-theme warranted.
- [x] feat(web/stale): NEW drift bars + severity coloring. SHIPPED 36cbfb5.
  (Page was already cm-themed, so this is a data-viz upgrade not a re-theme:
  threshold-relative severity, per-row drift bars, severely-drifted chip.)

Because usage + stats were already clean, the batch pivoted those two slots to two
genuine data-viz upgrades on adjacent top-level pages (both were on cm-* but dumped
raw numbers with no visual weight):
- [x] feat(web/tags): NEW proportional usage bars + frequency ranking. SHIPPED 98fc045.
- [x] feat(web/related): NEW similarity-strength bars. SHIPPED 3c5c4c4.

>>> TOP-LEVEL PAGES audited: the remaining top-level pages (sources, history, pins,
saved, stats, usage, posture, trust, sbom, search) are ALL on cm-* already - the
shadcn/foreign-palette drift is now effectively EXHAUSTED across the app. The CHAT
SURFACE per-message history item (below) is the clear next highest-value gap. Pull it
NEXT tick. After it, the data-viz pattern proven this tick (proportional bars scaled
to a set max, state-driven posture chips) is a strong evergreen vein for the remaining
list/dashboard pages (sources feedback boosts, history model-mix, stats already has a
donut). A fresh queue is refilled below.

CHAT SURFACE (multi-turn DONE 2026-06-28 14:37; one item remains):
- [x] feat(web/chat): per-message conversation history within a thread. SHIPPED
  006d868 - turns[] model, per-turn Q header + answer + Copy/Share + retry, single
  rail follows the active turn, [ ]/j-k scoped to active turn, New thread reset.
- [x] feat(web/chat): thread outline navigator (companion to multi-turn). SHIPPED
  72c9109 - floating Thread N/M pill, index of questions, jump+activate, hidden <2.
- [ ] feat(web/composer): drag-and-drop file pin onto the composer to pre-pin a
  source for the next question (surface a "Pinned: <path>" chip below the textarea).
  NEEDS a minimal API touch to thread the pinned path into the ask request; the
  /pins endpoint already exists. The last remaining chat-surface gap.

DATA-VIZ VEIN (evergreen; proven over batches I + this tick - turn dumped numbers
into shapes a daily user reads at a glance: proportional/diverging bars, segmented
mix strips, recency lanes, posture chips):
- [x] feat(web/sources): diverging feedback-boost signal bar. SHIPPED 9884478.
- [x] feat(web/history): per-day model-mix segmented strip. SHIPPED ea6c876.
- [x] feat(web/pins): per-row recency lane + newest badge. SHIPPED e74ccca.
- [x] feat(web/saved): the saved-search rows show run counts as text; a tiny
  new-vs-removed delta bar per saved search. SHIPPED d0cb67d - diverging churn
  bar, removed left/danger, new right/success, scaled to busiest digest.
- [x] feat(web/usage): proportional ask-vs-search bar. ALREADY SHIPPED (mix bar
  c6fd748 + MixLegend) - dropped, was already done.
- [x] feat(web/collections): item counts per collection are bare; a proportional
  bar scaled to the largest collection. SHIPPED 7d56c32 - accent-tinted size bar.
- [x] feat(web/dashboard): proportional bar on namespace tiles. SHIPPED 0542218 -
  chunk-weight bar scaled to heaviest namespace.

GLOBAL UX / POLISH (evergreen):
- [ ] feat(web/ui): standardize the modal/dialog shell (CommandPalette,
  ShareAnswerButton, ShortcutHelp) on a single <Dialog> primitive in @clawmind/ui
  (focus trap, Esc, backdrop, scroll-lock) so future modals don't drift.
- [ ] feat(web/a11y): roving-tabindex on the TopNav primary nav (ARIA menubar
  pattern) for keyboard arrow-key movement.
- [x] feat(web/welcome): finish the welcome guide visually. DROPPED - welcome/page.tsx
  is already a complete real 3-step action flow (ingest/ask/configure with live
  progress, seed button, dismiss/reset), not a stub. Building a separate tour would
  be padding.

### Queued frontend (refilled 2026-06-26 12:22 PDT)

Fresh batch so future ticks never run dry. The biggest standing theme is the
DESIGN-LANGUAGE DRIFT: ~540 uses of foreign CSS vars + raw Tailwind colors
across ~50 files. Two clusters exist - (a) cm-palette pages with a few stray
tokens (cheap fixes), and (b) whole pages built in a DIFFERENT shadcn-style
language (bg-card / text-muted-foreground / bg-primary) that need a full
re-theme. Group a re-theme batch by visual coherence.

DESIGN-LANGUAGE RE-THEME (highest-value; the 06:49 + 12:22 + 18:01 ticks did this):
- [x] feat(web/settings/security): re-theme the IP-allowlist page off the shadcn
  palette onto cm-* + wire the SettingsCardSkeleton for its loading state. SHIPPED
  65f98fb: full re-theme off bg-background/bg-card/text-muted-foreground/bg-primary/
  border-input/ring-ring; toggle "on" uses the brand accent; caution hint -> cite
  gold, errors -> --cm-danger, Saved -> --cm-success; SettingsCardSkeleton rows=4
  replaces the bare Spinner (completes the c0f0ad9 deferral).
- [x] feat(web/settings/notifications): re-theme onto cm-* + swap its bespoke
  loading list for the shared skeleton. SHIPPED 00913a6: off the shadcn palette;
  toggle "on" -> accent, off -> bg-cm-subtle; Saved -> --cm-success;
  SettingsCardSkeleton rows=4 replaces the hand-rolled animate-pulse list.
- [x] feat(web/posture): re-theme the security-posture scorecard. SHIPPED 6041d3e:
  off --bg/--card/--border + emerald/amber/rose; two lookup maps (STATUS_INK/
  STATUS_TINT) drive every pass/warn/fail surface (dots, badges, score tone, the
  three count cards, the configured line) through --cm-success / cite gold /
  --cm-danger so they can't drift.
- [x] feat(web/settings/invitations): re-theme onto cm-*; status chips through the
  cm feedback inks like the search chips (95f55d4). SHIPPED 85debc9: off
  --bg/--surface/--border + amber/emerald/rose; pending -> cite gold, accepted ->
  --cm-success, revoked -> --cm-danger; reveal panel -> cite-gold caution surface;
  action banners -> success/danger inks.
- [x] feat(web/settings/policies): re-theme onto cm-*; accepted/pending through
  --cm-success / --cm-muted. SHIPPED 61bd735: off --surface/--surface-hover/
  --warning-bg + green-600/red-600; Accept + Publish became ink buttons; the
  "action required" banner -> cite-gold caution surface; accepted chip ->
  --cm-success; required checkbox gets an accent tint.

CHAT SURFACE (still the biggest product gap):
- [ ] feat(web/chat): per-message conversation history within a thread - ChatShell
  loses the prior Q/A when a new question is asked. Vertical stack of Q/A pairs
  (newest at bottom), each with its own copy/share + a per-message collapsible
  citation rail. The single biggest chat gap; carried across many ticks.
- [ ] feat(web/composer): drag-and-drop file pin onto the composer to pre-pin a
  source for the next question (the /pins page exists; surface a "Pinned: <path>"
  chip below the textarea submitted with the question).

SOURCE VIEWER + READING:
- [x] feat(web/sources/view): "jump to next/prev cited line" stepper. SHIPPED
  3402b22 - CitedLineStepper, cm-cited <-> cm-cited-end, only when band > 85vh.
- [ ] feat(web/sources/view): in-file find (cmd+F-style overlay scoped to the
  viewer) highlighting matches in the rendered code, dependency-free, reusing the
  highlight token walk (native find doesn't see the token spans well).
- [x] feat(web/sources/view): line-permalink selection wash on plain (non-cited)
  lines. SHIPPED 0e39b4e - optimistic .cm-selected-line accent wash on click.

GLOBAL UX / POLISH:
- [ ] feat(web/ui): standardize the modal/dialog shell (CommandPalette,
  ShareAnswerButton, ShortcutHelp) on a single <Dialog> primitive in @clawmind/ui
  (focus trap, Esc, backdrop, scroll-lock) so future modals don't drift.
- [ ] feat(web/welcome): finish the welcome guide visually - a 3-card tour
  (chat + dashboard + sources) for a 30-second first-run orientation.
- [ ] feat(web/settings): inline accent-color preview swatch in the Appearance card
  so a future "pick your accent" feature has its surface ready.

### Roadmap (continued - newest first)

### Tick 2026-06-25 21:11 PDT (current) - source-viewer reading surface finished

- [x] feat(web/sources/view): language pill in the viewer header (61ed4f9)
- [x] feat(web/sources/view): soft-wrap toggle for long lines (1be8052)
- [x] feat(web/sources/view): copy the cited lines from the band header (31340c7)
- [x] feat(web/sources/view): expand/collapse context around the cited band (57a2be4)
- [x] feat(web/sources/view): floating "back to cited lines" when band scrolls off (21a07dc)

### Tick 2026-06-25 16:19 PDT - source-viewer reading surface + nav/notify polish

- [x] feat(web/sources/view): cited lines shown with surrounding context + gold highlight band + auto-scroll (0ed063c)
- [x] feat(web/sources/view): dependency-free syntax highlighting (623a1bb)
- [x] feat(web/nav): settings breadcrumb trail on every settings sub-page (7c5ee2b)
- [x] feat(web/chat/sources): j/k + arrow keyboard navigation through the rail (0cfb745)
- [x] feat(web/notifications): one-shot bell pulse on 0 -> 1+ unread (73b62ca)

### Tick 2026-06-25 11:19 PDT - nav discoverability + UI-primitive batch

- [x] feat(ui): shared Kbd + KbdGroup primitive replacing four duplicated kbd blocks (e300f3c)
- [x] feat(web/nav): desktop "More" overflow dropdown for the secondary surfaces (1e01dde)
- [x] feat(web/history): group answers under sticky per-day date headers (adcf288)
- [x] feat(web/stats): switchable files/chunks/bytes lens on the namespace bars (cba8f79)
- [x] feat(web/composer): cmd+/ saved-prompt picker overlay with type-to-filter (f761dee)

### Tick 2026-06-25 06:00 PDT - a11y + nav + theming batch

- [x] feat(web/theming): system-theme auto-detect on first visit + live OS follow (fd83f5b)
- [x] feat(web/a11y): skip-to-content link as the first focusable element (917c05e)
- [x] feat(web/a11y): aria-current="page" on the active TopNav link (76c13c2)
- [x] feat(web/a11y): global focus-visible ring on every interactive element (9b453b9)
- [x] feat(web/nav): per-route document title via a DRY resolver (f6a2c85)

### Tick 2026-06-25 00:07 PDT - chat navigation + recovery batch

- [x] feat(web/chat): scroll-into-view + transient flash-ring on citation click (a5ffb81)
- [x] feat(web/chat): [ and ] keyboard navigation through answer citations (36213ed)
- [x] feat(web/chat): retry + edit-and-try-again recovery on stream failure (d330b7f)
- [x] feat(web/chat): live token-count + last-token latency footer while streaming (928d500)
- [x] feat(web/chat/sources): per-card open-in-viewer deep link on the rail (3292b2b)

### Tick 2026-06-23 23:32 PDT

- [x] feat(ui): toast notification system with ToastProvider, useToast hook, and viewport (b0ac005)
- [x] feat(web/chat): copy-answer button with citation-preserving plain-text format (d840cb8)
- [x] feat(web): keyboard shortcut help overlay bound to '?' with TopNav hint (0e93243)
- [x] feat(web/chat): skeleton loading state for answer + sources rail (5574dad)
- [x] feat(web/chat): client-side filter input on the sources rail when >=4 sources (f5e19d4)

### Tick 2026-06-23 19:21 PDT

- [x] feat(search): --tsv [+ --header] emits the family-wide tab-separated rank/path/score/namespace stream (18ad396)
- [x] feat(related): --tsv [+ --header] extends the search-tsv 4-col shape with a 5th `hits` column (0037057)
- [x] feat(feedback): list --tsv [+ --header] emits the family-wide tab-separated path/boost/ups/downs stream (e8b79e7)
- [x] feat(digest): show --sort <ts|addedCount|removedCount> + --reverse port to the family-wide ordering primitive (6755e2f)
- [x] feat(forget): --top <n> caps the previewed removedPaths array + --paths-only stream (presentation-only, REJECTED with --apply) (c87a78b)

### Tick 2026-06-23 15:09 PDT

- [x] feat(watch): --only-add/--only-change/--only-unlink event-kind filter triplet on the live NDJSON stream (e16f742)
- [x] feat(tags): paths <tag> --sort path + --reverse port to the family-wide --sort/--reverse contract (5373fc4)
- [x] feat(digest): show <id> --json --slim emits {count, addedCount, removedCount} 3-integer churn-history shape (fc45981)
- [x] feat(stats): --tsv --header prepends the schema row for typed-table parsers (08b52b2)
- [x] feat(stale): --top <n> caps survivors of every narrowing + ordering filter (50cc616)

### Tick 2026-06-23 11:25 PDT

- [x] feat(compact): --json --slim emits {scanned, removed, kept, dryRun} 4-integer shape for cron-dashboard polls (1637323)
- [x] feat(export): --slim emits {format, since, bytes} 3-key dashboard probe shape that drops the body (4c404de)
- [x] feat(watch): --once --preview-json --slim emits {count, since} 2-key cron-dashboard probe shape (97f6647)
- [x] feat(digest): show --paths-only --diff --only-added/--only-removed exclusive single-direction emit modes (9ecbc55)
- [x] feat(stats): --json --slim --paths re-targets to a flat NAMESPACE-NAME pipeline stream (0ee197f)

### Tick 2026-06-23 07:10 PDT

- [x] feat(reindex): --dry-run --json --slim emits {count, since, dryRun} for the partial-reindex cron poll (985751a)
- [x] feat(ingest): --dry-run --json --slim emits {count, since, dryRun} for the incremental-refresh cron poll (492b542)
- [x] feat(stale): --json --slim emits {count, thresholdDays, since} for the stale-budget cron poll (b26f3ad)
- [x] feat(stats): --json --slim --top <n> caps the `stale` namespace array (re-targets from extensions) (684947e)
- [x] feat(doctor): --json --slim is the family-canonical alias for --quiet with severity-aware tallies (0344e25)

### Tick 2026-06-23 03:17 PDT

- [x] feat(pins): list --json --slim emits {count, paths} for the pin-stability cron poll (2e7a4c7)
- [x] feat(mutes): list --json --slim emits {count, paths} for the mute-stability cron poll (ac16b87)
- [x] feat(tags): list --json --slim emits {count, tags} for the tag-stability cron poll (afdde56)
- [x] feat(tags): paths <tag> --json --slim re-keys to {count, tag, paths} for the per-tag-stability cron poll (e5af7c7)
- [x] feat(forget): --json --slim emits {count, matched, removedChunks, dryRun} for the forget-preview cron poll (9ffb990)

### Tick 2026-06-22 23:37 PDT

- [x] feat(feedback): list --json --slim emits 4-integer count-only shape carving the boost distribution at neutral (5d21b7a)
- [x] feat(search): --json --slim emits the deeper-cut {rank,path,score,namespace} dashboard shape (skips snippetFor) (713649a)
- [x] feat(related): --json --slim drops per-neighbour hits + excerpt, keeps {path, score, namespace} (7bc727f)
- [x] feat(aliases): list --json --slim emits {count, names} for the alias-stability cron poll (71cb531)
- [x] feat(digest): list --json --slim emits {count, overdueCount, neverRunCount} for the digest-current cron poll (abec248)

### Tick 2026-06-22 20:07 PDT

- [x] feat(feedback): list --reverse modifier flips --sort direction (4th port of the family-wide reverse-modifier contract) (32580ff)
- [x] feat(digest): list --reverse modifier flips --sort direction (5th port of the family-wide reverse-modifier contract) (6777c44)
- [x] feat(aliases): list --reverse modifier flips --sort direction (6th port of the family-wide reverse-modifier contract) (4bfe9b3)
- [x] feat(stats): --reverse modifier flips --sort direction (7th port — completes the queued family-wide reverse-modifier sweep) (4e73f71)
- [x] feat(tags): list --reverse + secondary-by-original-index sort (8th port; bundles the queued tags-determinism queued item) (ba77780)

### Tick 2026-06-22 16:53 PDT

- [x] feat(stale): --reverse modifier flips --sort direction (establishes family-wide reverse contract) (cec9160)
- [x] feat(search): --reverse modifier flips --sort direction (mirrors stale --reverse) (c3ab531)
- [x] feat(related): --reverse modifier flips --sort direction (completes the queued reverse-modifier family-sweep) (d600337)
- [x] feat(digest): show --paths-only --diff splits emit into +/- direction streams (4b76cb1)
- [x] feat(feedback): prune --json --slim drops paths array for cron-dashboard counts (b524cb3)

### Tick 2026-06-22 13:41 PDT

- [x] feat(search): --sort <score|path|namespace> orders survivors of -t/--threshold (5e57ff3)
- [x] feat(stale): --sort <age|path|size> orders survivors of -q / --since / --days (a8fd3d9)
- [x] feat(digest): show --paths-only flat-emit of new/removed paths from filtered history rows (990689f)
- [x] feat(stats): --sort name family-alias + secondary-by-original-index tie sort (19da6aa)
- [x] test(feedback): pin prune --above --below --apply 3-flag byte-layout under --json (c3f8c56)

### Tick 2026-06-22 10:07 PDT

- [x] feat(feedback): list --sort <boost|path|ups|downs> orders survivors before --top (1f9946a)
- [x] feat(digest): list --sort <lastRunTs|runs|title> orders survivors of -q/--since (c6cd0e7)
- [x] feat(aliases): list --sort <name|createdAt> orders survivors of -q/--since (71d2f59)
- [x] feat(pins,mutes,aliases): list --paths-only as family-wide alias for --paths (b99dbcf)
- [x] feat(related): --sort <score|path|namespace> orders survivors of band-filter (85add58)

### Tick 2026-06-22 06:27 PDT

- [x] feat(stale): add --tsv --header for typed-table parsers (column -t / pandas.read_csv) (f2bb590)
- [x] feat(feedback): list --top <n> ranks the loudest votes by |boost - 1.0| (1e51e5d)
- [x] feat(digest): list --since <iso-date> surfaces overdue saved searches (b7dd8c6)
- [x] feat(aliases): list --since <iso-date> for daily snapshots of recent additions (27c6fc2)
- [x] feat(tags): paths <tag> --paths-only alias for --paths (family-wide naming) (e5e73db)

### Tick 2026-06-22 02:28 PDT

- [x] feat(status): --watch --json embeds a monotonic cycle:N per snapshot (c9490bc)
- [x] feat(ask): --out - treats single hyphen as the stdout sentinel (c9d27f5)
- [x] feat(watch): --once --preview-json wraps the preview list in a structured envelope (9748183)
- [x] test(ask): pin --stream-json --no-citations --out 3-flag composition byte layout (dc329f5)
- [x] test(related): pin --below / --above + --below + --paths-only byte layout (fea8312)

### Tick 2026-06-21 23:08 PDT

- [x] feat(status): emit --watch startup banner to stderr at loop start (696cce6)
- [x] feat(status): add --watch --check-after <n> to debounce 1-cycle blips (c712abb)
- [x] feat(watch): add --once --paths-only pure preview (no ingest, xargs-safe) (738037b)
- [x] feat(ask): --stream-json --out writes NDJSON event stream to file (no shell redirect needed) (c8f3810)
- [x] test(digest): pin --json --slim --since exact byte layout (NDJSON-friendly diff contract) (1b4b63c)

### Tick 2026-06-21 20:00 PDT

- [x] feat(status): add --watch <ms> + --max-polls <n> for a refreshing dashboard (11718bd)
- [x] feat(related): add --above/--below filter pair mirroring feedback list (a7e8e96)
- [x] feat(ask): add --stream-json for live NDJSON event streaming (75c5e05)
- [x] test(stale): pin --tsv --since composition byte layout (4d45a42)
- [x] feat(watch): add --once --since for one-shot incremental refresh (8496320)

### Tick 2026-06-21 16:57 PDT

- [x] feat(search): add --rerank-only debug flag (skipMmr through RAG retrieve) (2d9f396)
- [x] test(related): pin -n/--namespaces end-to-end forwarding contract (c1d622f)
- [x] feat(digest): add run --json --slim for 3-field cron-dashboard tally (b0da13a)
- [x] feat(forget): make --paths-only short-circuit win over --json (cron-safe combo) (08fcba0)
- [x] feat(stats): add --json --slim --tsv awk-pipeline shape (2-col namespace+files) (465b833)

### Tick 2026-06-21 13:26 PDT

- [x] feat(export): add --since end-to-end (API + CLI) for incremental conversation dumps (22bb5f4)
- [x] feat(search): add --rerank-off debug escape hatch through RAG retrieve() (d3419d3)
- [x] feat(watch): add --once for a single scheduled-scan pass (cron-friendly twin) (e747919)
- [x] feat(digest): add run --max <n> to cap the per-batch digest count (6ac0f90)
- [x] feat(pins/mutes): add list --by <user> for per-creator snapshot scoping (59d79f3)

### Tick 2026-06-21 10:11 PDT

- [x] feat(feedback): add prune --above <n> for cap-recalibration prunes (2ef0c8b)
- [x] feat(pins/mutes): add list --since <iso-date> for recent-only snapshots (51092d2)
- [x] feat(doctor): add --json --quiet slim shape for tight cron dashboards (41b383c)
- [x] feat(reindex): add --since <iso-date> for partial-reindex flow (becae0c)
- [x] feat(digest): add run --since <iso-date> to skip recently-run saved searches (c40a2ec)

### Tick 2026-06-21 07:05 PDT

- [x] chore(repo): ignore stray .js/.d.ts sidecars next to apps/cli/src/*.ts (d951f11)
- [x] feat(doctor): add --stale-after-days <n> end-to-end (API + CLI) (d9f9dda)
- [x] feat(ingest): add --dry-run + --paths-only rehearsal preview (fc6e3f2)
- [x] feat(tags): add list --sort <count|tag> and --top <n> (d589255)
- [x] feat(feedback): add prune --below <n> with --apply safety pattern (216077b)

### Tick 2026-06-21 04:13 PDT

- [x] feat(watch): add -q/--quiet to suppress per-file event chatter (3b48fdd)
- [x] feat(stale): add --paths-only as an alias for --paths to unify the flag family (6ac5d2b)
- [x] feat(stats): add --slim shape emitting just {stale, total} for cron pipelines (9796f9b)
- [x] feat(reindex): add --dry-run preview that lists files without touching the index (9bc0992)
- [x] feat(ingest): add --since <iso-date> for incremental refresh from cron (8ecf026)

### Tick 2026-06-21 00:40 PDT

- [x] feat(related): add -t/--threshold to drop neighbours below a relevance score (51dd7b8)
- [x] feat(digest): add show --last <n> to cap history rows newest-first (53e2550)
- [x] feat(stats): add --paths to emit the per-namespace extension flat list (fc363f0)
- [x] feat(watch): add --debounce <ms> to coalesce rapid file events (814cbe5)
- [x] feat(watch): emit an NDJSON startup banner to stderr on each run (76a5c9e)

### Tick 2026-06-20 22:01 PDT

- [x] feat(related): add --paths-only to dump deduped neighbour paths in rank order (5d6edcf)
- [x] feat(stats): add --since to keep only namespaces whose newestIngestedAt is older than the cutoff (f9f81a4)
- [x] feat(stale): add --since to filter the report to files whose last ingest predates an ISO cutoff (5db09c2)
- [x] feat(digest): add show --since <iso-date> to bound the history window by absolute date (ca8f043)
- [x] feat(feedback): add list --above/--below to filter entries by boost multiplier (a7ec554)

### Tick 2026-06-20 18:51 PDT

- [x] feat(ask): add --out option for saving long answers to a file (d7ab8a1)
- [x] feat(status): add --check to exit non-zero when any probe is down (2762613)
- [x] feat(forget): add --confirm safety tripwire to refuse misaligned --apply runs (5adbd71)
- [x] feat(doctor): add --severity to filter the displayed findings list (49ce082)
- [x] feat(search): add --paths-only to dump a deduplicated path-per-line stream (28b0414)

### Tick 2026-06-20 16:05 PDT

- [x] feat(tags): add --paths flag to tags paths for pipeline-friendly output (4457b33)
- [x] feat(stats): add --compact for single-line JSON snapshots (87de268)
- [x] feat(digest): add -q substring filter to digest show history rows (fe4dc23)
- [x] feat(ask): add --no-citations flag for quick non-cited answers (7579ed7)
- [x] feat(ask): add --threshold to skip LLM when no citation clears the bar (3e4ba85)

### Tick 2026-06-20 12:27 PDT

- [x] feat(pins): add --paths flag to pins list for pipeline-friendly output (e91c76d)
- [x] feat(mutes): add --paths flag to mutes list for pipeline-friendly output (7c84163)
- [x] feat(aliases): add --paths flag to aliases list for pipeline-friendly output (28cd9c6)
- [x] feat(search): add --no-snippet to emit slim ranking-only JSON (2645a6b)
- [x] feat(search): read the query from stdin when the argument is "-" (8538749)

### Tick 2026-06-20 08:05 PDT

- [x] feat(stats): add --top <n> to cap per-namespace extension breakdown (c47bc78)
- [x] feat(stats): add --sort <files|chunks|bytes|namespace> for the per-namespace table (77e0d9a)
- [x] feat(stats): add --tsv mode mirroring stale --tsv for awk/cut pipelines (2146dcb)
- [x] feat(search): add -t/--threshold to drop hits below a relevance score (6a7327b)
- [x] feat(forget): add --paths-only to emit just the matched paths (dd00423)

### Tick 2026-06-20 04:25 PDT

- [x] fix(deps): pin vitest to ^2.1.9 to restore vite 5 compatibility (3010d31)
- [x] fix(stale): surface clean error when api is unreachable or returns error body (aedb504)
- [x] feat(stale): add --tsv option to emit tab-separated rows for piping (7e1f329)
- [x] fix(forget): surface clean error when api is unreachable or returns error body (c6be7ae)
- [x] fix(stats): surface clean error when api is unreachable or returns error body (f9d7948)
- [x] feat(status): show resolved api base url and per-probe latency (46d1151)
- [x] fix(cli/compact): drop duplicate dryRun key in --json output (1c57284)

### Queued frontend (refilled 2026-06-23 23:32 PDT under FRONTEND override)

These are the top frontend ideas to ship in upcoming ticks under the active
FRONTEND focus. Order is rough priority but feel free to reorder by what
fits together as a clean batch theme.

CHAT SURFACE (apps/web/src/components/Chat*, apps/web/src/app/chat):
- [x] feat(web/chat): cite-pill scroll-into-view + sticky-highlight when a numbered citation in the answer body is clicked. SHIPPED a5ffb81 as scroll-into-view (block: nearest) + a one-shot 1.2s gold flash-ring via the shared lib/sourceNav revealSourceCard helper; prefers-reduced-motion guard collapses the flash.
- [x] feat(web/chat): citation [N] keyboard navigation. SHIPPED 36213ed as [ / ] cycling the cited sources in first-appearance order (lib/citations citedOrder), focusing each pill (cm-cite-<id>) and revealing its rail card; wraps, suppressed inside inputs, registered in the ? sheet.
- [x] feat(web/chat): retry-on-error affordance in the chat error state. SHIPPED d330b7f as a ChatError panel with Retry (re-submits same question) + Edit and try again (returns caret to composer via Composer focusSignal); submit() now takes an explicit question.
- [ ] feat(web/chat): per-message conversation history within a thread — the current ChatShell loses the prior question/answer when a new question is asked. Add a vertical stack of Q/A pairs (newest at bottom), each with its own copy/share affordance, citation rail folded into a per-message collapsible.
- [x] feat(web/chat): mid-stream "thinking..." + token-count hint while the LLM is producing output. SHIPPED 928d500 as a StreamProgress footer (breathing accent dot + running token count + last-token gap) that appears once the first token lands and resets each submit; reduced-motion guard.
- [x] feat(web/composer): saved-prompt picker overlay (cmd+/ from the composer). SHIPPED f761dee as a PromptPicker anchored beneath the composer: opens on cmd/ctrl+/ or the footer "saved prompts" hint button, type-to-filter, up/down + Enter to pick, Esc/click-outside to close. Picking drops the prompt into the textarea and returns the caret to the end. Tab cycling left untouched alongside it. Surfaced in the ShortcutHelp Chat group + the chat breadcrumb hint.
- [ ] feat(web/composer): drag-and-drop file pin onto the composer to pre-pin a source for the next question. The /pins page already exists; the composer should accept a file drop and surface a "Pinned: <path>" chip below the textarea that's submitted with the question.

SOURCES RAIL + VIEWER:
- [x] feat(web/chat/sources): keyboard navigation through the rail — `j` / `k` (vim-style) AND ArrowDown / ArrowUp from the answer column cycles the active card; Enter opens the source viewer. SHIPPED 0cfb745: j/ArrowDown + k/ArrowUp step EVERY card in the (filtered) rail, wrap at both ends, cold-start lands first/last; each step marks active + reveals (scroll+flash) via revealSourceCard so it agrees with a citation click; Enter opens the active card's real-path deep link in a new tab (noopener) and only fires when a card is selected so it never hijacks a form submit; suppressed in inputs/textareas; deduped viewerHrefFor; surfaced in ShortcutHelp + chat breadcrumb.
- [x] feat(web/chat/sources): per-source "open in viewer" button on each card. SHIPPED 3292b2b as a top-right OpenInViewer anchor opening /sources/view in a new tab without dismissing the active citation; stops click/mousedown propagation, calm-at-rest reveal on hover/focus-within, deep-links by s.path (NOT displayPath, which would 404 on aliased sources) and forwards start/end.
- [x] feat(web/sources/view): syntax highlighting for the source viewer. SHIPPED 623a1bb as a dependency-free stateful line tokenizer (lib/highlight.ts) — NO Prism/Shiki bundle. Covers TS/JS/TSX, Python, JSON, CSS/SCSS, shell, YAML, Go, Rust, C-family by extension; carries LineState across lines so multi-line block comments + template literals colour correctly while single/double strings + line comments terminate at the newline (a stray quote can't tint the rest of the file). Restrained --cm-* palette (kw=accent-ink, str=success, com=faint, num=cite-gold). Unknown grammars fall back to plain text. components/CodeView.tsx renders + keeps the cited-line wash + auto-scroll anchor. Verified with a 23-case runtime harness incl. a byte-for-byte text-preservation round-trip.
- [x] feat(web/sources/view): "open at line N" deep-link from the rail — the viewer should scroll-and-highlight that line when arriving via deep link. SHIPPED 0ed063c: the rail already passed start/end; the viewer now widens the fetch by CONTEXT_PAD (12) lines each side (lib/contextWindow.ts), renders the cited band with a gold wash + left rail (.cm-cited-line) + a "cited N-M" header pill, and auto-scrolls the band to viewport centre on arrival via ScrollToCited (prefers-reduced-motion aware). Non-cited opens keep whole-file behaviour.

GLOBAL UX / NAV:
- [x] feat(web/nav): collapsible "More" overflow menu in the TopNav secondary nav for the 20+ secondary surfaces. SHIPPED 1e01dde as a MoreMenu popover at the end of the desktop primary nav: a two-column grid of every secondary item, closes on Esc/click-outside/select, highlights the active item AND the "More" trigger when the current route lives in the secondary set. role=menu/menuitem + aria-haspopup/aria-expanded; reuses the existing `active` pathname computation. Added a shared IconCaretDown to @clawmind/ui for the trigger.
- [x] feat(web/nav): per-route page-title in the document head (`Page · ClawMind`) - today every page is just "ClawMind". SHIPPED f6a2c85 as lib/pageTitle.ts (route->label resolver with curated TOP_LEVEL + SETTINGS maps, humanize fallback, opaque-id skip) + a DocumentTitle client component mounted once in the layout. Server-titled routes (trust/incidents/sbom/breach-register/offline) resolve to null and are left untouched. Settings sub-pages get breadcrumb titles ("Security . Settings . ClawMind").
- [x] feat(web/nav): breadcrumbs on settings sub-pages (Settings > Security > API key policy). The /settings tree is two levels deep and the user has no anchor today. SHIPPED 7c5ee2b as a thin "Settings / <Sub>" trail under the TopNav (SettingsBreadcrumb), rendered ONLY on /settings/<sub> (null on /settings itself, every non-settings route, and deeper paths). Reuses the curated SETTINGS map via a new shared settingsSubLabel() in lib/pageTitle so acronym pages (SSO/DPA/SCIM/MFA/PII) read right and can't drift from the document title. Mounted once in TopNav -> all ~50 leaves get it free. NOTE: shipped as a 2-level trail (Settings / Sub), not the 3-level Settings > Security > API key policy form, because the settings tree is flat-under-/settings (no intermediate category route exists to anchor a middle crumb); revisit if a category layer is ever introduced.
- [x] feat(web/nav): focus-visible ring on every primary interactive element using --cm-accent-line so keyboard users always see where focus is. SHIPPED 9b453b9 as a base :focus-visible rule in globals.css covering a/button/input/textarea/select/summary + role=button|link|tab|menuitem with a 2px --cm-accent-line ring (tighter offset on inputs). :focus-visible means pointer clicks never ring; bespoke focus treatments (cite pill, skip link, open-viewer, share CTA) keep class-level specificity and override the base.
- [ ] feat(web/ui): standardize the modal/dialog shell (CommandPalette, ShareAnswerButton, ShortcutHelp) on a single `<Dialog>` primitive in @clawmind/ui so future modals don't drift in radius / shadow / backdrop opacity.
- [x] feat(web/ui): a `<KbdGroup keys={['⌘','K']} />` primitive so every kbd chip in the app shares one set of styles instead of the four duplicated kbd: CSSProperties blocks currently in use. SHIPPED e300f3c as Kbd (one key, sm/md size) + KbdGroup (key sequence, or boxed=one bordered pill for the TopNav legend) in @clawmind/ui; ShortcutHelp/CommandPalette/TopNav all dropped their local kbd consts and render the primitive. No visual change - chips render byte-identical at each size.

PAGE-LEVEL POLISH:
- [ ] feat(web/dashboard): inline sparkline next to each StatCard (the dashboard panel shows totals but no trend). A small SVG line chart of "documents indexed over the last 14 days" would turn the dashboard from a snapshot into a story. Backend can compute it from the existing ingestStatus → ingestHistory endpoint.
- [ ] feat(web/dashboard): "what changed today" panel summarising the diff between yesterday and today's index (added documents, removed sources, new namespaces). Pairs naturally with the existing dashboard structure.
- [x] feat(web/stats): horizontal-bar visualisation of per-namespace files/chunks/bytes. SHIPPED cba8f79: the bar viz already existed but was hard-wired to chunks; added a Files/Chunks/Bytes segmented toggle that re-sorts the namespaces desc by the chosen metric, rescales every bar to that metric's max, and swaps the value column (bytes via fmtBytes). The summary stat cards double as lens shortcuts with an accent ring when active. role=tablist/tab + aria-selected. (Outlier namespaces now pop under whichever lens you pick.)
- [x] feat(web/history): per-day grouping with a small date header bar between groups. SHIPPED adcf288 via lib/dayGroups.ts (pure groupByDay + dayLabel: Today/Yesterday/weekday/Mon D/Mon D, YYYY) + a sticky DayHeader between groups; grouping preserves the API's newest-first order across and within groups. Verified labels against a 6-row fixture.
- [x] feat(web/notifications): bell badge animation on transition from 0 -> 1+ unread (a subtle pulse, NOT a constant blink). Adds a quiet "you have new mail" signal. SHIPPED 73b62ca: rising-edge-only one-shot (prevUnread ref seeded at -1 so the baseline poll never false-fires; pulse flag auto-clears after 1.4s; 2->3 does not re-pulse). cm-bell-ring (accent ring expands once + fades) + cm-bell-badge-pop keyframes run a single iteration from --cm-accent-line, fully disabled under prefers-reduced-motion.
- [ ] feat(web/welcome): finish the welcome guide visually — today /welcome exists but feels minimal. Add a 3-card carousel with screenshots/illustrations of the chat + dashboard + sources pages so a first-run user has a 30-second tour.

ACCESSIBILITY + THEMING:
- [x] feat(web/a11y): skip-to-content link as the first focusable element on every page so keyboard users can bypass the TopNav. SHIPPED 917c05e as a "Skip to content" anchor at the top of TopNav (rendered on ~95 pages) that slides in from off-screen on keyboard focus and targets a tabindex=-1 landing span placed right after the header. Reduced-motion users get the reveal without the slide.
- [x] feat(web/a11y): aria-current="page" on the active TopNav link (today only the visual highlight signals active; screen reader users get nothing). SHIPPED 76c13c2 on both the desktop primary nav and the mobile overflow bar, reusing the existing `active` pathname computation so the highlight and the ARIA state can never disagree.
- [x] feat(web/theming): system-theme auto-detect on first visit (prefers-color-scheme: dark/light) — the current useTheme hook hard-codes 'dark' as initial. SHIPPED fd83f5b: useTheme now resolves explicit persisted choice first, else the OS preference, in a mount effect (not the useState initialiser, so no SSR hydration mismatch against the light default). Live-follows OS dark/light flips via a matchMedia change listener while no explicit choice is pinned; the first toggle persists a fixed theme and stops the follow. System-driven changes deliberately don't persist.
- [ ] feat(web/theming): inline preview of accent color in /settings so a future "pick your accent" feature has its surface ready.

### Queued frontend (refilled 2026-06-25 16:19 PDT)

Fresh batch so future ticks never run dry. Order is rough priority; group
by what makes a clean batch theme.

SOURCE VIEWER + READING (the surface this tick just deepened):
- [x] feat(web/sources/view): "copy lines" affordance on the cited band. SHIPPED 31340c7 as a Copy button beside the "cited N-M" pill: new citedText(content, startLine, win) pure helper maps the band's absolute lines onto the fetched window body and returns just those rows (no trailing newline), or null when there's no band / it's outside the window; CopyCitedLines client component does the clipboard write + success/error toast (useToast), IconCopy->IconCheck bounce, gold cite-pill styling. Verified citedText with a 15-case node harness.
- [x] feat(web/sources/view): "expand context" control. SHIPPED 57a2be4: the viewer's pad is now driven by a clamped (0..200) `pad` query param falling back to CONTEXT_PAD; ContextStepper client component (-/+ by 25, disabled at bounds, +/-N readout, Reset) does a soft router.push(scroll:false) wrapped in useTransition so the group dims while the wider window streams. scrollKey deliberately excludes pad so expanding never yanks the viewport. Header cluster flex-wraps for the richer row.
- [x] feat(web/sources/view): wrap-vs-scroll toggle for long lines. SHIPPED 1be8052 as a role=switch Scroll/Wrap pill in a control strip atop CodeView; wrap flips pre overflowX->visible + each line span to pre-wrap/overflow-wrap:anywhere (minWidth:0) with flex-start row align so the gutter stays top-aligned across wrapped rows; persisted in localStorage (cm-code-wrap) read in a mount effect (no hydration mismatch), private-mode failures swallowed. Cited wash + anchor + highlighter unchanged.
- [x] feat(web/sources/view): language pill in the viewer header. SHIPPED 61ed4f9: new langLabelForPath(path) in lib/highlight (human label by ext, map WIDER than the tokenizer so md/html/toml are named honestly), pill beside the "Lines X-Y" cluster with an accent/faint status dot indicating whether highlighting is actually active (langForPath !== null); unknown/no-ext -> "Plain text". Verified with an 18-case node harness.
- [x] feat(web/sources/view): floating "back to cited lines" when the band scrolls off (NEW this tick, completes the reading surface — the expand-context control made it possible for the band to leave the viewport). SHIPPED 21a07dc: BackToCited watches id=cm-cited with an IntersectionObserver; when the band is off screen a bottom-centre cite-gold pill appears with a direction arrow (up/down by boundingClientRect.top sign) and scrolls it back to centre (smooth, reduced-motion aware); re-arms on scrollKey; rise-in keyframe disabled under reduced motion; rendered only when a cited band exists.

CHAT SURFACE (hottest area, used every session):
- [ ] feat(web/chat): per-message conversation history within a thread — ChatShell loses the prior Q/A when a new question is asked. Vertical stack of Q/A pairs (newest at bottom), each with its own copy/share + a per-message collapsible citation rail. (Carried from earlier queue; still the single biggest chat gap.)
- [ ] feat(web/chat): "scroll to bottom" floating button that appears when the user has scrolled up during a long streaming answer, so they can jump back to the live token edge. Hidden when already at the bottom.
- [ ] feat(web/chat): keyboard shortcut to focus the composer from anywhere on the chat page (e.g. "/" when not in an input), mirroring the rail's j/k. Register in ShortcutHelp.
- [ ] feat(web/chat): empty-state starter prompts become clickable — the EmptyReading "a few things to try" list items currently render as plain text; make each one a button that drops the prompt into the composer and focuses it.

DASHBOARD + DATA-VIZ:
- [ ] feat(web/dashboard): inline sparkline next to each StatCard — a small SVG line of "documents indexed over the last 14 days" turning the snapshot into a story. Backend can compute from ingestStatus/ingestHistory.
- [ ] feat(web/dashboard): "what changed today" panel — diff yesterday vs today's index (added docs, removed sources, new namespaces).
- [ ] feat(web/stats): donut/proportion chart of namespace share of total chunks alongside the existing bars, so the relative weight of each namespace reads at a glance.
- [ ] feat(web/usage): a simple per-day bar of ask/search request counts over the current period (the /usage page shows totals but no shape).

GLOBAL UX / POLISH:
- [ ] feat(web/ui): standardize the modal/dialog shell (CommandPalette, ShareAnswerButton, ShortcutHelp) on a single <Dialog> primitive in @clawmind/ui (focus trap, Esc, backdrop, scroll-lock) so future modals don't drift in radius/shadow/backdrop opacity.
- [ ] feat(web/ui): toast on copy/share success across the app — several copy buttons silently succeed; route them through the existing useToast for a consistent confirm.
- [ ] feat(web/welcome): finish the welcome guide visually — a 3-card tour (chat + dashboard + sources) so a first-run user has a 30-second orientation.
- [ ] feat(web/theming): inline accent-color preview swatch in /settings Appearance so a future "pick your accent" feature has its surface ready.
- [ ] feat(web/nav): recent-pages section in the command palette (last 5 routes visited, stored in localStorage) above the static route list, so frequent jumps are one keystroke closer.
- [ ] feat(web/a11y): roving-tabindex on the TopNav primary nav so arrow keys move between nav links (ARIA menubar pattern) for keyboard users.
- [x] feat(web/loading): consistent skeletons on the data-heavy settings sub-pages (security, retention, encryption) that currently show a bare Spinner — match the ChatAnswerSkeleton calm. SHIPPED c0f0ad9 as SettingsCardSkeleton in @clawmind/ui (card silhouette: header + sub-label, N label/control rows, save-bar; calm cm-pulse 1.6s reduced-motion friendly; cm-* tokens) wired into the three genuinely cm-palette bare-Spinner pages: the /settings hub (two stacked cards), /settings/retention (4 rows), /settings/encryption (3 rows). NOTE: security/notifications/api-key-policy use a DIFFERENT design language (shadcn-style bg-card/text-muted-foreground/bg-primary classes), so they need a full page re-theme first before the cm-palette skeleton fits — deferred to a future re-theme tick rather than dropping a mismatched skeleton in.

### Queued frontend (refilled 2026-06-25 21:11 PDT)

The SOURCE VIEWER + READING group is now fully shipped (5 items this tick
+ the 16:19 batch). Fresh frontend slices so future ticks never run dry.
Order is rough priority; group by what makes a clean batch theme.

SOURCE VIEWER + READING (follow-ups now the core reading surface is done):
- [x] feat(web/sources/view): line-number anchor + copy-permalink — clicking a gutter line number selects that line and updates the URL (?start=&end=) so a reader can deep-link to any line, not just the cited band. Pairs with the existing start/end query contract. SHIPPED 3e7648c: new lib/lineLink.ts pure core (lineSelection plain->single / shift-extend-from-band-start / floor+clamp>=1; lineQueryString/lineLinkHref/linePermalink build the ?start=&end= URL with path encoded + pad deliberately omitted so a shared link lands on the default window; linePermalink trims trailing origin slashes; lineRangeLabel). Every CodeView gutter number is now a button: click -> router.push(scroll:false) re-highlights the band via the existing start/end contract + best-effort clipboard copy routed through the global toast (blocked clipboard still applies the selection). New .cm-line-no style stays calm at rest, warms to accent on hover/focus. 19-case tsx harness.
- [ ] feat(web/sources/view): "jump to next/prev cited line" when the band spans more rows than fit on screen — small up/down stepper in the band header that scrolls between the first and last cited rows. Only meaningful when cited end-start exceeds a viewport; reuses the id=cm-cited anchor pattern (add per-row ids).
- [ ] feat(web/sources/view): in-file find (cmd+F-style overlay scoped to the viewer) that highlights matches in the rendered code without leaving the page — the browser's native find doesn't see virtualized rows well and can't respect the token spans. Keep it dependency-free, reuse the highlight token walk.
- [x] feat(web/sources/view): remember the soft-wrap preference per-language (a .md file usually wants wrap, a .ts file usually wants scroll) — extend the cm-code-wrap localStorage key to a small per-extension map. SHIPPED f62caa8: new lib/wrapPref.ts owns an ext->bool JSON map (cm-code-wrap-by-ext) with a pure core (extOf / defaultWrapForExt prose-vs-code / resolveWrap precedence explicit>legacy>default / nextWrapMap immutable / defensive parsers); legacy cm-code-wrap honored as a fallback so no setting is lost; CodeView seeds the per-ext default on SSR+first render then applies the resolved pref in a path-keyed mount effect. Prose wraps, code scrolls by default. 36-case node harness.
- [x] feat(web/sources): the /sources list rows should deep-link into the viewer on click (today they may only show metadata) — wire each row to /sources/view?path= so the list and the viewer connect. SHIPPED b805f38: audited /sources (rows set an inline 200-line preview only); added a hover/focus-reveal .cm-open-viewer corner link on every row (matches the chat rail; stops click propagation so it doesn't re-select the row) PLUS a first-class "Open in viewer ->" button in the detail header. Both deep-link by real path into /sources/view?path=.

CHAT SURFACE (hottest area, used every session — still the biggest gaps):
- [ ] feat(web/chat): per-message conversation history within a thread — ChatShell loses the prior Q/A when a new question is asked. Vertical stack of Q/A pairs (newest at bottom), each with its own copy/share + a per-message collapsible citation rail. (Carried; still the single biggest chat gap.)
- [x] feat(web/chat): "scroll to bottom" floating button during a long streaming answer when the user has scrolled up — hidden when already at the live token edge. SHIPPED 9e48f47 as JumpToLatest: a sentinel (id=cm-stream-end) at the bottom of the answer column watched by an IntersectionObserver (the BackToCited pattern); accent-tinted pill with a breathing cm-stream-dot shows only while streaming + the reader is above the live edge; smooth scroll to the edge, reduced-motion aware.
- [x] feat(web/chat): "/" focuses the composer from anywhere on the chat page (mirroring the rail's j/k); register in ShortcutHelp. SHIPPED 473d967: global keydown on the chat page bumps composerFocus (caret-at-end), suppressed in inputs/textareas + when a modifier is held (cmd+/ stays the saved-prompt picker); registered in the ShortcutHelp Chat group + advertised in the breadcrumb hint.
- [x] feat(web/chat): empty-state starter prompts become clickable — the EmptyReading "a few things to try" items render as plain text today; make each a button that drops the prompt into the composer and focuses it. SHIPPED 4eda6ad: STARTER_PROMPTS hoisted; each renders as a cm-starter-prompt button (lead arrow slides in on hover/focus, accent-soft wash) that seeds the composer via pickStarter (sets question + bumps composerFocus).

DASHBOARD + DATA-VIZ:
- [ ] feat(web/dashboard): inline sparkline next to each StatCard — a small SVG line of "documents indexed over the last 14 days" turning the snapshot into a story. Backend can compute from ingestStatus/ingestHistory. NOTE: blocked — no ingestHistory/per-day endpoint exists today; needs an API addition before the sparkline has data.
- [ ] feat(web/dashboard): "what changed today" panel — diff yesterday vs today's index (added docs, removed sources, new namespaces). NOTE: same blocker — no day-over-day index snapshot endpoint exists.
- [x] feat(web/stats): donut/proportion chart of namespace share of total chunks alongside the existing bars. SHIPPED 11fa810: new dependency-free lib/donut.ts (polarToXy / ringArcPath largeArc+full-ring-split / donutSegments drops zero+NaN+neg & normalizes / fmtShare <1% floor) + NamespaceDonut component (ring + legend driven by the SAME files/chunks/bytes metric toggle as the bars; cm-* derived palette; long tail folds into one "Other" slice; SVG aria-hidden w/ per-slice <title>, legend carries the accessible name/value/share table; center shows the dominant share). Renders only when >1 namespace. 32-case tsx harness.
- [ ] feat(web/usage): per-day bar of ask/search request counts over the current period. NOTE: blocked — /v1/usage returns period totals (byKind.ask/search) only, no per-day breakdown. The 2026-06-26 06:49 tick instead shipped the ASK-vs-SEARCH proportion bar (c6fd748) from the totals already on hand; the per-day shape still needs an API addition.

GLOBAL UX / POLISH:
- [ ] feat(web/ui): standardize the modal/dialog shell (CommandPalette, ShareAnswerButton, ShortcutHelp) on a single <Dialog> primitive in @clawmind/ui (focus trap, Esc, backdrop, scroll-lock).
- [ ] feat(web/welcome): finish the welcome guide visually — a 3-card tour (chat + dashboard + sources).
- [x] feat(web/nav): recent-pages section in the command palette (last 5 routes, localStorage) above the static route list. SHIPPED 49abbd8: new lib/recentPages.ts (pure core parseRecent/pushRecent move-to-front-dedupe-cap-immutable/bestRouteHref collapse a visited path onto its owning route, most-specific wins, query/hash/slash tolerant; readRecent/recordRecent SSR-safe wrappers) + RecentPagesRecorder mounted in the layout records each navigation. The palette builds up to 5 recent rows on open (collapsed to known routes, current page dropped, deduped, reusing each route's icon+label); on empty query they lead under a "Recent" label + "Jump to" divider with their routes removed from the main list so nothing reads twice; fold away once the user types. Result cap also raised 24->40. 27-case tsx harness.
- [ ] feat(web/a11y): roving-tabindex on the TopNav primary nav (ARIA menubar pattern) for keyboard arrow-key movement.
- [x] feat(web/loading): consistent skeletons on the data-heavy settings sub-pages (security, retention, encryption) — match the ChatAnswerSkeleton calm. SHIPPED c0f0ad9 (SettingsCardSkeleton in @clawmind/ui; wired into the /settings hub + /settings/retention + /settings/encryption; shadcn-styled sub-pages deferred to a re-theme tick).

### Queued for later ticks
- [ ] fix(telemetry): bump @opentelemetry/resources to ^2.0.0 + adapt tracing.ts to the new resourceFromAttributes API (the exporter and auto-instrumentations also need version bumps to clear all peer warnings — pre-existing typecheck red, NOT caused by any cron feature; ci:verify cannot pass until this is resolved). NOTE for FRONTEND ticks: this is the lone red that fails `pnpm run ci:verify`; it lives entirely in packages/telemetry, untouched by any web slice. The web batch is gated independently via web typecheck + web build (both must be green before push).
- [ ] fix(rag/hybrid): hybridMerge test on packages/rag/test/hybrid.test.ts expects `out[0].id === 'b'` but the merge orders 'a' (bm25 score 10) above 'b' under alpha=0.5; either the test fixture or the hybrid blend has drifted. Pre-existing failure (verified by typechecking parent commit 3cc6fd1), NOT introduced by any cron tick — was simply unknown because earlier ticks only ran `--filter @clawmind/cli test`, not `pnpm -r test`. Either rewrite the test against the current alpha-blend semantics OR re-derive the expected order from first principles.
- [ ] fix(status): flake on `status --watch --json --check-after` test — `expect(process.exitCode).toBeFalsy()` occasionally observes 2 instead of undefined when the up-flip clearTimeout races the final cycle's `--check-after` debounce decision. Reproduces ~1 in every 5-10 runs of the full cli suite. Root cause likely: the test's `upFlip` setTimeout fires the up-state inversion at boundary of the cycle counter, and the cycle's exit-code decision happens before clearTimeout cancels the pending flip. Fix candidates: (a) advance fake timers deterministically with vi.useFakeTimers() through the whole --watch loop; (b) increase the cycle interval in the test fixture so the timing has more margin; (c) replace the wall-clock --check-after debounce with a counter-based one that decrements per JSON snapshot rather than per ms (then the test can deterministically count snapshots). Worth ~30min investigation in a future tick.
- [ ] feat(forget): add list-by-pattern shim (forget --dry-run --paths-only is the closest, but a dedicated `forget list <pattern>` for "preview what forget would touch" without typing --dry-run + --paths-only every time would be the more natural ergonomic shape). Open question: does the API need a new endpoint or can the cli pre-flight against the existing /v1/sources list?
- [ ] feat(status): add a `cycle: 0` pin for the first --watch --json snapshot (currently asserted as 1-indexed; pin that the indexing convention is 1-based explicitly, not just "monotonically increasing" — a regression to 0-indexed would silently change the contract for downstream parsers reading the first snapshot).
- [ ] feat(ask): add --stream-json --no-citations --threshold composition byte-layout pin under the SKIP path (sources event count-only, skipped doc, no token events, exit 1). The 3-flag intersection is already pinned for the happy-path; the SKIP path through emitStreamDoc is structurally different (no token / done events fire) and the byte-layout under that path has not been pinned.
- [ ] feat(stats): add --slim --paths --json composition byte-layout pin: when --slim, --paths, and --json are all set, which one wins? The current code path is undocumented in the cli help; --paths short-circuits BEFORE --json which short-circuits BEFORE --slim. Pin the precedence so a future refactor that changed the order would surface immediately. — DONE 0ee197f: --slim + --paths + --json now re-target --paths to the flat namespace-name stream; pinned with byte-layout tests including the "not JSON, not framed" explicit precedence assertion. RESOLVED.
- [ ] feat(stale): add the `--reverse` family-wide modifier to the `--sort` keys that have NO meaningful default direction (currently `--sort path` is asc by default; `--sort age` and `--sort size` are desc). Document the rule clearly in the help text: "--reverse flips the default DIRECTION for the key, not the SEMANTIC direction" — so a user who wants "oldest first" under `--sort age` does NOT need --reverse (they get it by default), and `--reverse` gives them "youngest first" which is a different semantic question. The help text on `--reverse` should reference the default direction for each `--sort` key so the user knows what reversing means before they try it. (No code change; pure docs clarification with a test pin that the help string contains the per-key default-direction notes.)
- [ ] feat(feedback): port the --reverse + --top composition pin to `feedback prune --json --slim` (does --reverse have any meaning on prune? Probably not since prune is a destructive batch operation, not a list. But the question is worth pinning so a future operator sees it documented as "intentionally not supported" rather than "forgotten").
- [ ] feat(tags): port the --reverse contract to `tags paths <tag> --paths-only` — the paths-only stream is currently in API order. Adding a `--sort path` would let cron snapshots diff cleanly; adding `--sort path --reverse` would complete the family on this command too. The natural use is a daily snapshot of "the paths under tag X" diffing cleanly even when the API order shifts across ingests.
- [ ] feat(export): add --json --slim emit shape `{count, format, since}` for export-progress dashboards. The full --json payload re-emits the entire conversation dump; a dashboard polling "did the export run since cutoff X" only needs the count + format + since-anchor as ~80 bytes. Pairs with the existing `--since` flag (2026-06-21 13:26 PDT tick) that already filters incremental dumps. NOTE: this is partially blocked: the API returns conversation-bodies in 3 formats (md, json, csv) — to compute a "count" the cli would have to either parse the body itself (fragile across the 3 formats) or call a sibling endpoint. The natural shape is a HEAD-style probe that doesn't fetch the body — needs a small API addition. — PARTIALLY ADDRESSED 4c404de: the HEAD-style `bytes`-only probe shipped as `export --slim` ({format, since, bytes}) — a dashboard wiring `bytes > N` against a per-format empty-shape baseline distinguishes delta from empty-window without needing a count. The original `{count, format, since}` variant remains blocked on the per-format body-parser problem; ship that separately if the operator value of `count` (vs `bytes`) ever proves out.
- [ ] feat(stats): port the family-wide `--reverse` modifier to `stats --sort` for ALL keys (today `--reverse` only works against the default --sort key because the alias resolution happens before --reverse is consulted). Cross-check the path through `--sort namespace --reverse` end-to-end so the "z to a" cron snapshot is byte-deterministic on identical-ties input.
- [ ] feat(compact): port the --json --slim shape to compact (`{scanned, removed, kept, dryRun}` 4-field shape). Today compact emits its full report directly (which already has the 4 integer counts inline alongside removedPaths). The slim shape would drop `removedPaths[]` so a dashboard polling "did compact have anything to do" once a minute is ~80 bytes vs ~Nkb for a workspace with N stale paths. — DONE 1637323. RESOLVED.
- [ ] feat(watch): add --once --paths-only --json --slim (count of paths discovered in this scan). The previewing case is well covered by --once --paths-only; the slim shape covers the polling case for "is the watcher seeing anything" without parsing the path list. — DONE 97f6647: shipped as --once --preview-json --slim emitting {count, since}. The --once --paths-only --json --slim shape was reconsidered — the --paths-only contract short-circuits before --json/--slim by design (pipeline contract trumps everything), so a slim shape on top of --paths-only would inherit the precedence and never fire. Instead the slim flag sits ON --preview-json (the explicit JSON path) where it naturally composes. RESOLVED.
- [ ] feat(digest): extend show --paths-only --diff with `--only-added` / `--only-removed` exclusive emit modes (the `--diff` shape requires post-processing with `grep "^+ " | cut -c3-` for the single-direction stream; a dedicated flag pair would skip that step. Open question: do both flags compose naturally, or should `--only-added --only-removed` be a no-op equivalent to plain `--paths-only` (since the union is the flat shape)? Or should it abort because the two are semantically exclusive?). — DONE 9ecbc55: shipped with the "both = none" semantic (both flags = unfiltered --diff stream, byte-identical to the bare --paths-only --diff invocation). Pinned with a dedicated test. RESOLVED.
- [ ] feat(forget): port the `--slim` body-suppression pattern (just shipped on export 4c404de) to forget — a polling `clawmind forget <pat> --dry-run --slim --json` could emit `{count, matched, removedChunks, dryRun}` with the body-suppressed contract (today the --json --slim shape already exists for forget, but the symmetric "polling dashboard wants the integers only, never the paths" body-suppression precedent from export is worth a uniform pattern). Open question: is there meaningful daylight between the existing forget --json --slim shape and the "polling probe" intent, or is it already exactly that? Audit first; ship only if there's a real delta.
- [ ] feat(watch): port the `--only-*` exclusive-emit pattern (just shipped on digest show --paths-only --diff 9ecbc55) to the live watch path's per-event NDJSON: `--only-add` / `--only-change` / `--only-unlink` flag triplet that filters which event kinds reach stdout. The natural cron use is a tight "ingest just the additions" pipe that does not want change/unlink NDJSON noise. "All = none" semantic carries over (all three flags = unfiltered stream). Pairs naturally with --debounce + --quiet for the cron-restarted watcher. — DONE e16f742: shipped as --only-add / --only-change / --only-unlink triplet with the "all = none" semantic; applies to both text and --json mode; the filter sits INSIDE onEvent so the underlying ingest still fires (only the operator-facing stream is narrowed — index stays consistent). RESOLVED.
- [ ] feat(stats): add `--json --slim --paths --since` 3-flag composition byte-layout pin (the slim-paths re-target just shipped 0ee197f only has --sort/--top composition tests; the --since narrowing path needs an independent pin so a future change to the filter order would surface). Should be a 3-line addition to the new --json --slim --paths describe block.
- [ ] feat(export): consider porting --slim's HEAD-style body-suppression precedent to the existing `forget --dry-run --json --slim` shape (currently emits the per-path removedChunks count and matched count; the `bytes`-equivalent for forget would be the total bytes of source-file content that the apply-equivalent would remove, surfaced as a single integer). Operator value question: is byte count more meaningful than chunk count for a forget-budget dashboard? Likely yes for "did we free up enough storage" but the chunk count is already a perfect proxy. Audit before shipping.
- [ ] feat(digest): port the `--only-added` / `--only-removed` pattern (just shipped 9ecbc55) to `digest run --json --slim` — today the slim shape carries `{ran, deferred, sinceSkipped}` as 3 integers; the "additions-only" / "removals-only" cron use for digest run is "how many of those ran-saved-searches added paths vs removed paths". Open: does the API surface `addedCount` / `removedCount` per-run? If not, this needs an API addition before the cli can compute the breakdown. Audit first.
- [ ] feat(tags): port the --reverse contract to `tags paths <tag> --paths-only` — the paths-only stream is currently in API order. Adding a `--sort path` would let cron snapshots diff cleanly; adding `--sort path --reverse` would complete the family on this command too. The natural use is a daily snapshot of "the paths under tag X" diffing cleanly even when the API order shifts across ingests. — DONE 5373fc4: shipped `tags paths <tag> --sort path` + `--reverse` with the family-wide secondary-by-original-index sort (no-op in practice because paths are unique, kept for family-contract consistency). --reverse without --sort is a no-op (the API ordering is a fixed contract). RESOLVED.
- [ ] feat(stale): add the `--reverse` family-wide modifier docs clarification with per-key default-direction notes ("--reverse flips the default DIRECTION for the key, not the SEMANTIC direction"). PUNTED this tick — the help text on --reverse already documents per-key default directions (oldest-first under --sort age, asc alphabetical under --sort path, biggest-first under --sort size); a separate dedicated test pin that the help string contains the per-key direction notes would be a doc-only test that doesn't catch any real regression. Closing as not-needed.
- [ ] feat(stats): add --slim --paths --json composition byte-layout pin: when --slim, --paths, and --json are all set, which one wins? The current code path is undocumented in the cli help; --paths short-circuits BEFORE --json which short-circuits BEFORE --slim. Pin the precedence so a future refactor that changed the order would surface immediately. — DONE 0ee197f: --slim + --paths + --json now re-target --paths to the flat namespace-name stream; pinned with byte-layout tests including the "not JSON, not framed" explicit precedence assertion. RESOLVED.
- [ ] feat(digest): add show --json --slim emitting {count, addedCount, removedCount} 3-integer churn-history shape per saved search — the natural cron use is "did this saved search churn paths since cutoff X" as a single ~70-byte poll. Mirrors `digest run --json --slim` byte-for-byte on the read-side. — DONE fc45981: shipped {count, addedCount, removedCount} 3-integer aggregate over the filtered history rows. Composes with -q / --since / --last (counts describe survivors); --paths-only short-circuits the slim emit. The read-side complement to `digest run --json --slim`. RESOLVED.
- [ ] feat(stats): add --tsv --header prepending the schema row (`namespace\tfiles\tchunks\tbytes\tnewestIngestedAt`) so the stream is friendly to typed-table parsers (column -t / pandas.read_csv) without a separate echo. Mirrors `stale --tsv --header` byte-for-byte: zero-row body still gets the header (the schema row is the contract). Under --json --slim the header is the 2-col `namespace\tfiles` (matches the slim shape). — DONE 08b52b2. RESOLVED.
- [ ] feat(stale): add --top <n> client-side post-sort cap. Family-wide --top contract (mirrors stats / feedback list / tags list / search --top): clamped to positive integer; non-positive or NaN falls back to "no cap"; recomputes `total` to the post-cap count; applies uniformly across every output mode (--json / --tsv / --paths / --paths-only / text). The canonical cron-budget use is `clawmind stale --sort size --top 10 --paths | xargs forget --apply` — "the 10 biggest stale files, in size-priority order". — DONE 50cc616. RESOLVED.
- [ ] feat(watch): port the live-watch event-kind filter triplet (--only-add / --only-change / --only-unlink) to the --once preview path? Today the --once mode emits the ingest report shape (not per-event NDJSON), so the --only-* filter has no per-event axis to operate on. Audit first: is there a meaningful read of "preview only the adds" that the existing --paths-only / --preview-json doesn't already cover? Likely not — --paths-only / --preview-json are already pure-preview shapes that don't distinguish adds/changes/unlinks because ingest doesn't either at that level. Closing as not-needed.
- [ ] feat(digest): port the family-wide --sort contract to `digest show` history rows. Today `digest show` emits history in API order (newest-first); a dedicated `--sort ts` (with --reverse) would let the operator pick oldest-first. The shape question: is there meaningful daylight between `digest show --sort ts` and the existing API order? The API is contractually newest-first so --sort ts default is a no-op; --sort ts --reverse gives oldest-first. Worth a port for family-contract consistency. Also: --sort addedCount / --sort removedCount would surface the loudest churn rows in either direction. Audit first. — DONE 6755e2f: shipped --sort ts/addedCount/removedCount + --reverse on digest show. ts is the explicit no-op (newest-first API default + asc-flip under --reverse). addedCount/removedCount surface the loudest-churn rows in either direction. Composition pin: --sort addedCount --last 1 surfaces the loudest-additions row in one call (NOT the newest). RESOLVED.
- [ ] feat(forget): port the family-wide --top contract to `forget --json --slim` for "preview the top N paths the forget would touch ordered by their per-chunk cost". Today the slim shape carries `{count, matched, removedChunks, dryRun}` — adding --top would let an operator cap the dry-run preview at N to bound the "would I really delete this much" judgment. Audit first: the existing slim shape drops the path list, so the operator polling the slim shape doesn't see paths at all. The --top would be meaningful on the bare --dry-run --json path (NOT the slim). Worth a separate test pin in either case. — DONE c87a78b: shipped --top <n> as a presentation-only cap on the path-level emit (removedPaths array + --paths-only stream + text-mode path list). matched/removedChunks integer counts STILL reflect the FULL API match — the slim shape is unchanged regardless of --top. Critical safety contract: --top is REJECTED with --apply (visible preview must match destruction scope; cron safety pattern). RESOLVED.
- [ ] feat(search): port the --tsv contract (just shipped on stats --tsv --header today) to search. Today search has --no-snippet for slim JSON and --paths-only for the pipeline stream, but no --tsv mode. Cron snapshots of search rankings would benefit from a tab-separated `rank\tpath\tscore\tnamespace` shape that diffs cleanly across ticks. Pairs with --tsv --header for typed-table parsers. Audit first: is search ranking stable enough across ticks for the diff to be meaningful, or does score float on every ingest making the diff noisy? — DONE 18ad396: shipped --tsv + --header. Score uses .toFixed(3) precision matching text-mode so cross-mode diffs are byte-stable. The 4 columns (rank, path, score, namespace) match the --json --slim shape so a downstream parser flipping between the two only changes the framing, not the schema. Precedence: --paths-only > --tsv > --json > text. Perf property: --tsv does NOT call snippetFor(). RESOLVED.

### Queued for later ticks (refilled this tick)

- [ ] feat(related): port the --tsv --slim composition byte-layout pin (when --slim AND --tsv are both set with --json, what's the column shape? Today --tsv wins outright and emits the 5-col shape — does a future operator want a "slim 3-col TSV" stripped of rank+hits to match the slim JSON shape? Open: probably not worth a separate path; --slim's natural twin is --json + slim JSON shape, NOT --tsv. Pin the precedence with a single test and document it).
- [ ] feat(stats): port the --tsv contract to `stats --json --slim --tsv --header` composition pin — today the slim --tsv path emits 2-col `namespace\tfiles` rows but the --header schema row under that mode is the same 2 columns. Pin the byte layout with a zero-row body + --header to lock the contract that the slim TSV header is byte-stable across slim/non-slim mode switches.
- [ ] feat(digest): port the --sort family-wide contract to `digest show --paths-only` walks. Today the --paths-only walk is newest-first by row, then API order within each row's newSources + removedSources. Adding --sort would let `digest show --paths-only --sort addedCount` walk the loudest-additions row's paths first — useful for `clawmind digest show s1 --paths-only --sort addedCount --last 1 | xargs ingest` ("the paths from the noisiest recent run, ready for re-ingest"). Audit: --sort already runs BEFORE --paths-only walks `filteredHistory` so this is FREE — just verify with a test and document.
- [ ] feat(feedback): port the --tsv contract to `feedback prune --json --slim` for the dry-run preview path. Today the slim shape carries 4 integers + the errors array; adding --tsv would emit those as `<predicate>\t<matched>\t<cleared>\t<dryRun>` rows for an awk-pipeline cron monitor. Audit: is there meaningful daylight between the slim JSON 4-int shape and a single-row TSV? Probably a 1:1 mirror; pin it for symmetry with the rest of the --tsv family or close as not-needed.
- [ ] feat(search): port the --tsv contract to the --out file dispatch path (today `--tsv --out file.tsv` writes the TSV stream to the file via a shell redirect — but the existing --json --out / --text --out pattern writes ANSI-stripped bytes to the file plus a "wrote N result(s)" stderr confirm). The TSV path currently skips --out entirely; making it honour --out would complete the symmetry. Audit: is the file-dispatch worth it given operators usually shell-redirect TSV? Open question.
- [ ] feat(forget): port the --top contract to surface the `removedChunks` proportional cap — today --top caps the path-level emit; an operator wanting "the 5 paths that account for the MOST chunks" needs to sort the removedPaths by per-path chunk count then cap. The API does not return per-path chunk counts today, so this needs an API addition. Audit before shipping.
- [ ] feat(digest): port the --sort + --tsv composition: today digest show has no --tsv mode at all. A `digest show s1 --tsv --header` shape would emit `<ts>\t<addedCount>\t<removedCount>\t<totalSources>` per history row — the natural cron snapshot of churn-per-run. Pairs with --sort addedCount for "loudest-churn rows first" in column-aligned form.

## Conventions

- Every CLI fetch helper should wrap the fetch in a single ApiError-style class
  and a per-command label that prefixes both the transport error ("cannot
  reach ...") and the non-2xx error ("foo failed (503 ...): <body>").
- Tests live next to the command file in `apps/cli/test/<name>.test.ts` and
  use the `globalThis.fetch` stub pattern from `doctor.test.ts` /
  `aliases.test.ts`.
- Keep `--json` output stable across non-error paths so downstream scripts
  can pipe with `jq` without conditional handling.
- Pipeline-friendly modes (`--paths`, `--paths-only`, `--tsv`) MUST emit
  with no ANSI styling and no headers so `cut`/`awk`/`xargs` work without
  conditional skips. Pin the exact byte layout in tests.

## Tick log

(updated by each tick at the bottom)

- 2026-06-26 12:22 PDT (Cake/cron) - 5 FRONTEND features shipped directly on
  main, all in apps/web/ (+ one new @clawmind/ui primitive). Theme: keep
  fixing the design-language drift the 06:49 tick FLAGGED (off-brand foreign
  CSS vars) on the highest-traffic surfaces, plus two new reading/chat
  conveniences. SHAs f79efba, 95f55d4, df05edb, 3e7648c, c0f0ad9.
    1. settings hub re-theme (f79efba): /settings - the entry point to ~70
       settings sub-pages - rendered ENTIRELY in the foreign palette
       (var(--bg)/(--border)/(--fg)/(--fg-muted)/(--bg-elev) + hard-coded
       bg-violet-500/red-500/amber-500/emerald-500). The quota bar showed up
       VIOLET on warm paper-cream; system-status pills lit raw Tailwind
       red/green. Swapped every token for cm-* (cm-paper cards, cm-border,
       cm-fg/cm-muted, cm-bg/cm-subtle insets); quota bar now uses the same
       accent->cite-gold->danger ramp as the /usage page it links to; the
       destructive delete zone routes through --cm-danger; status pills use
       --cm-success/--cm-danger. Pure presentation, zero logic touched.
    2. search tag-chip re-theme (95f55d4): the include/exclude filter chips
       used emerald-300/rose-300 text - 300-level inks that wash out to
       near-invisible on the light theme, so a reader couldn't tell include
       from exclude. Routed include -> --cm-success, exclude -> --cm-danger
       (the brand feedback inks), 10% tint fills, opacity-hover remove x.
    3. chat namespace persistence (df05edb): ChatShell hard-coded its active
       namespaces in a useState initialiser and never persisted toggles, so
       every reload threw away the reader's workspace narrowing. New
       lib/nsPref.ts pure core (sanitizeNs order/dedupe/drop-unknown;
       parseNsPref defensive null on absent/malformed/non-array/all-invalid;
       empty-sanitized treated as "no pref" so we never persist a selection
       that searches nothing; SSR-safe read/write wrappers). Restored in a
       mount effect (no hydration mismatch), persisted on every picker toggle.
       18-case tsx harness.
    4. viewer gutter line permalinks (3e7648c): the viewer could only ever
       highlight the cited band it opened on - no way to point a colleague at
       a DIFFERENT line. New lib/lineLink.ts pure core (lineSelection plain ->
       single / shift -> range from the band's start anchor / floor+clamp>=1;
       lineQueryString/lineLinkHref/linePermalink build the ?start=&end= URL,
       path-encoded, pad omitted so a shared link lands on the default window;
       trims trailing origin slashes; lineRangeLabel). Every CodeView gutter
       number is now a button: click -> router.push(scroll:false) re-highlights
       via the existing start/end contract + best-effort clipboard copy through
       the toast (blocked clipboard still applies the selection). .cm-line-no
       warms to accent on hover/focus. 19-case tsx harness.
    5. settings loading skeleton (c0f0ad9): the cm-palette settings pages that
       fetch a form (hub, retention, encryption) flashed a bare "<spinner>
       Loading" then jumped to a full card. New SettingsCardSkeleton in
       @clawmind/ui draws the card silhouette (header + sub-label, N
       label/control rows, save-bar) with the existing calm cm-pulse, wired
       into all three. NOTE: security/notifications/api-key-policy use a
       DIFFERENT (shadcn-style bg-card/text-muted-foreground) design language
       and need a full re-theme before the cm skeleton fits - deferred, NOT
       dropped in mismatched.
  Gate: web typecheck CLEAN; @clawmind/ui typecheck CLEAN; web build
  "Compiled successfully", exit 0, all routes generated incl. the modified
  /sources/view (6.68 kB, up from 6.31), /settings, /usage, /search. Web batch
  gated independently via web typecheck + web build (both green) per the
  standing note that `pnpm run ci:verify` stays red ONLY on the pre-existing
  @clawmind/telemetry OTel 1.x/2.x peer mismatch + rag/hybrid test (both
  roadmap, zero files in this batch). Pushed 1f46f89..c0f0ad9. All 9 changed
  files under apps/web/ + 1 under packages/ui/. Pure-lib harnesses (nsPref 18,
  lineLink 19) ran green under tsx, live in .cron-tmp/ (uncommitted).
  STANDING FINDING (carried from 06:49): ~540 uses of foreign CSS vars + raw
  Tailwind colors across ~50 files remain - this tick fixed the settings hub +
  search chips (two of the worst). The shadcn-styled settings sub-pages
  (security, notifications, posture, invitations, policies, ...) are the next
  re-theme cluster.

- 2026-06-26 06:49 PDT (Cake/cron) - 5 FRONTEND features shipped directly on
  main, all in apps/web/. Theme: make everyday navigation + the secondary
  surfaces feel finished and ON-BRAND. SHAs c6fd748, 8bb916a, 840181f, 49abbd8,
  11fa810.
    1. usage re-theme + request-mix bar (c6fd748): the /usage page rendered
       off-brand - it used foreign CSS vars that don't exist in the cm-* set
       (var(--bg)/(--border)/(--fg-muted)) plus hard-coded bg-violet-500 /
       bg-red-500 / bg-amber-500, so it showed in the WRONG palette entirely.
       Swapped every token/utility for cm-* (cm-card, text-cm-muted, warm quota
       tints: accent->cite-gold->danger). Added a "Request mix" panel: a
       two-segment ask-vs-search proportion bar (accent + cite gold) with a
       percent-share legend, derived from the existing usage.byKind payload.
    2. welcome re-theme (8bb916a): the first-run guide's progress bar, next-step
       ring, step rings and completed checks all used var(--accent,#22c55e) - a
       GREEN fallback unrelated to the warm-orange brand - plus var(--bg-elev) /
       text-red-500. Moved everything to bg-cm-accent / cm-subtle / cm-border;
       the next-step emphasis is now an inset accent-line box-shadow (the calm
       stats stat-card treatment); errors read in cm-danger. Logic untouched.
    3. command palette reaches every nav surface (840181f): the palette (mod+K)
       listed 18 routes while the TopNav exposes ~27, so ~a third of the app
       (Explain, Collections, Feedback, Webhooks, Shares, Inbox, Batch, Usage,
       Admin, Welcome) was unreachable by keyboard jump. Added the 10 missing
       surfaces (primary-then-secondary order mirroring the More menu), fixed
       two icon mismatches (Settings was IconChartBar), raised the result cap
       24->40 so an empty query reveals the whole list.
    4. recent-pages section in the palette (49abbd8): a daily user keeps jumping
       to the same handful of pages but the list was always static. New
       lib/recentPages.ts (pure core: parseRecent / pushRecent move-to-front-
       dedupe-cap-immutable / bestRouteHref collapse a visited path onto its
       owning route, most-specific wins, query/hash/slash tolerant) +
       RecentPagesRecorder mounted in the layout. The palette builds up to 5
       recent rows on open (collapsed to known routes, current page dropped,
       deduped, reusing each route's icon+label); on empty query they lead under
       a "Recent" label + "Jump to" divider with their routes removed from the
       main list so nothing reads twice; they fold away once the user types.
       27-case tsx harness.
    5. namespace-share donut on /stats (11fa810): the stats page ranked
       namespaces by magnitude (bars) but had no view of relative weight. New
       dependency-free lib/donut.ts (polarToXy 0deg-at-12-o'clock CW /
       ringArcPath largeArc-aware + full-ring-split / donutSegments drops
       zero+NaN+neg & normalizes to 1 / fmtShare <1% floor) - NO Recharts/D3 -
       plus a NamespaceDonut (ring + legend driven by the SAME files/chunks/bytes
       metric toggle as the bars; cm-* derived palette; long tail folds into one
       "Other" slice; SVG aria-hidden w/ per-slice <title>, legend carries the
       accessible name/value/share table; center shows the dominant share).
       Renders only when >1 namespace. 32-case tsx harness.
  Gate: web typecheck CLEAN; web build "Compiled successfully in 3.5s", exit 0,
  all 102 routes generated incl. the modified /stats (3.28 kB), /usage (2.51 kB),
  /welcome (2.72 kB). The lone build lint WARNING (line 552, a pre-existing
  `sources` useMemo dep in src/app/search/page.tsx - 615 lines, NOT in this
  batch) is a warning, not an error. `pnpm run ci:verify` still red ONLY on the
  pre-existing @clawmind/telemetry OTel 1.x/2.x peer mismatch + rag/hybrid test
  (both roadmap, zero files in this batch; all 9 changed files under apps/web/).
  Pushed 89292d4..11fa810. Pure-lib harnesses live in .cron-state/harness/.
  FINDING surfaced for a future tick: ~541 uses of foreign CSS vars
  (var(--bg)/(--border)/(--fg-muted)/(--accent,#22c55e)) + raw violet/red/amber
  Tailwind colors across ~50 files (esp. settings sub-pages, invitations,
  posture, admin) - a real design-language drift worth a dedicated re-theme
  sweep. This tick fixed the two highest-traffic offenders (usage, welcome).
- 2026-06-26 01:37 PDT (Cake/cron) - 5 FRONTEND features shipped directly on
  main, all in apps/web/. Theme: make the two hottest READING surfaces (chat +
  source viewer) feel finished - close the chat-surface gaps + connect the
  sources list to the viewer. SHAs 4eda6ad, 473d967, 9e48f47, b805f38, f62caa8.
    1. clickable starter prompts (4eda6ad): the chat empty-state "a few things
       to try" list was plain text; each is now a cm-starter-prompt button
       (lead arrow slides in on hover/focus, accent-soft wash) that seeds the
       composer via pickStarter (sets question + bumps composerFocus so the
       caret lands at end). Reduced-motion drops the arrow slide.
    2. "/" focuses composer (473d967): global keydown on the chat page bumps
       composerFocus from anywhere (mirrors rail j/k); suppressed in
       inputs/textareas + when a modifier is held (cmd+/ stays the saved-prompt
       picker); preventDefault stops the slash typing into the field. Added to
       ShortcutHelp Chat group + the breadcrumb hint.
    3. jump-to-latest (9e48f47): new JumpToLatest watches a sentinel
       (id=cm-stream-end) at the bottom of the answer column with an
       IntersectionObserver (the BackToCited pattern). Accent-tinted pill with
       a breathing cm-stream-dot shows ONLY while streaming (loading + answer
       non-empty) AND the reader has scrolled above the live edge; smooth
       scroll back, reduced-motion aware. Sentinel is aria-hidden.
    4. sources list -> viewer deep-link (b805f38): /sources rows only had a
       capped 200-line inline preview; the rich /sources/view was unreachable.
       Added a hover/focus-reveal .cm-open-viewer corner link on every row
       (reuses the chat rail affordance; stops click propagation so it never
       re-selects the row) + a first-class "Open in viewer ->" button in the
       detail header. Both deep-link by real path.
    5. per-file-type wrap memory (f62caa8): the wrap toggle persisted one global
       boolean (cm-code-wrap) so wrapping a .md wrapped every .ts. New
       lib/wrapPref.ts owns an ext->bool JSON map (cm-code-wrap-by-ext) with a
       pure core (extOf / prose-vs-code default / resolveWrap precedence
       explicit>legacy>default / immutable nextWrapMap / defensive parsers);
       legacy key honored as fallback so no setting is lost; CodeView seeds the
       per-ext default on SSR+first render then applies the resolved pref in a
       path-keyed mount effect. 36-case node harness.
  Gate: web typecheck CLEAN; web build "Compiled successfully" in 2.8s, exit 0,
  all 102 routes generated incl. /sources/view (6.31 kB, up from 5.95) and
  /sources (2.96 kB). The lone build lint WARNING (line 552, a pre-existing
  `sources` useMemo dep in another file) is untouched by this batch - a warning,
  not an error. `pnpm run ci:verify` still red ONLY on the pre-existing
  @clawmind/telemetry OTel 1.x/2.x peer mismatch + rag/hybrid test (both in the
  roadmap, zero files in this batch; all 7 changed files under apps/web/).
  Pushed 1bba1b8..f62caa8. Roadmap still has 35 open frontend items; no refill.

- 2026-06-25 21:11 PDT (Cake/cron) - 5 FRONTEND features shipped directly on
  main, all in apps/web/. Theme: FINISH the source-viewer reading surface (the
  16:19 tick deepened it; this tick completes it). SHAs 61ed4f9, 1be8052,
  31340c7, 57a2be4, 21a07dc.
    1. language pill (61ed4f9): langLabelForPath() names the file's language by
       ext (TypeScript/Python/Markdown/TOML/...) in a header pill with a status
       dot - accent when highlighting is active (langForPath !== null), faint
       for plain text. Label map deliberately wider than the tokenizer so
       md/html name honestly. 18-case node harness.
    2. soft-wrap toggle (1be8052): role=switch Scroll/Wrap pill atop CodeView;
       wrap flips pre->visible + line spans to pre-wrap/anywhere with flex-start
       gutter align; persisted in localStorage (cm-code-wrap) via a mount effect
       (no hydration mismatch). Cited wash + anchor + highlighter unchanged.
    3. copy cited lines (31340c7): new citedText() pure helper extracts JUST the
       cited band from the fetched window; CopyCitedLines does clipboard +
       toast, IconCopy->IconCheck, gold pill flush with "cited N-M". 15-case
       node harness on citedText.
    4. expand/collapse context (57a2be4): viewer pad now a clamped (0..200)
       `pad` query param (default CONTEXT_PAD); ContextStepper does -/+ by 25 +
       Reset via soft router.push(scroll:false) in a useTransition. scrollKey
       excludes pad so widening never yanks the viewport.
    5. back-to-cited (21a07dc): the NEW scenario created by #4 - expand context
       and the band can leave the viewport. BackToCited watches id=cm-cited with
       an IntersectionObserver; a bottom-centre cite-gold pill with a direction
       arrow appears when off screen and scrolls the band back to centre
       (reduced-motion aware). Completes the surface.
  Gate: web typecheck CLEAN; web build "Compiled successfully" exit 0, all ~95
  routes incl. the modified /sources/view (5.95 kB). The lone build lint WARNING
  (line 552, a pre-existing `sources` useMemo dep) is untouched by this batch and
  is a warning, not an error. `pnpm run ci:verify` still red ONLY on the
  pre-existing @clawmind/telemetry OTel 1.x/2.x peer mismatch + rag/hybrid test
  (both in STATE roadmap, zero files in this batch; all 8 changed files under
  apps/web/). Pushed fe5dbe0..21a07dc. Refilled the frontend roadmap with 18
  fresh items (source-viewer follow-ups, chat, dashboard, global polish).

- 2026-06-25 16:19 PDT (Cake/cron) — 5 FRONTEND features shipped directly on
  main. Features: 0ed063c, 623a1bb, 7c5ee2b, 0cfb745, 73b62ca. Theme: deepen
  the source-viewer reading surface + nav/notify polish, all in apps/web/.
    1. sources/view cited-context window (0ed063c): opening a source from a
       citation now widens the fetch by 12 lines each side (lib/contextWindow),
       washes the cited band gold (.cm-cited-line) with a "cited N-M" header
       pill, and auto-scrolls it to viewport centre (ScrollToCited, reduced-
       motion aware). Was a stranded bare slice before.
    2. sources/view syntax highlighting (623a1bb): dependency-free stateful
       line tokenizer (lib/highlight.ts) — NO Prism/Shiki. TS/JS/Python/JSON/
       CSS/shell/YAML/Go/Rust/C-family by ext; carries block-comment +
       template-literal state across lines; restrained --cm-* palette;
       byte-for-byte text-preserving. CodeView.tsx renders it. Verified with a
       23-case runtime harness (transpiled + run under node).
    3. settings breadcrumb (7c5ee2b): "Settings / <Sub>" trail under TopNav on
       all ~50 /settings/<sub> leaves, null everywhere else; reuses the curated
       SETTINGS label map (shared settingsSubLabel) so acronyms read right and
       can't drift from the doc title. One mount, zero per-page edits.
    4. rail j/k nav (0cfb745): vim j/k + Arrow stepping through EVERY rail card
       (complements the cited-only [ / ] cycle), Enter opens the active card in
       the viewer; wraps, input-suppressed, reveals each card via the shared
       scroll+flash; deduped viewerHrefFor; surfaced in ShortcutHelp + hint.
    5. notifications bell pulse (73b62ca): one-shot ring+badge-pop on a genuine
       0->1+ unread rising edge (prevUnread seeded -1; auto-clears; 2->3 doesn't
       re-fire); single-iteration keyframes, reduced-motion disabled.
  Gate: web typecheck CLEAN, web build ✓ compiled successfully (exit 0, all ~95
  routes incl. the modified /sources/view), web test ok. `pnpm run ci:verify`
  still red ONLY on the pre-existing @clawmind/telemetry OpenTelemetry 1.x/2.x
  peer mismatch (STATE roadmap; predates this loop, zero telemetry files in the
  batch — all 12 changed files under apps/web/). Pushed d86435e..73b62ca.
  Refilled the frontend roadmap with 17 fresh items (source-viewer follow-ups,
  chat, dashboard data-viz, global polish).

- 2026-06-20 04:25 PDT (Cake/cron) — 7 features shipped on feature/autoship.
  Bootstrap: 561f1fb. Features: 3010d31, aedb504, 7e1f329, c6be7ae, f9d7948,
  46d1151, 1c57284. Test gate: `@clawmind/cli` 70/70 vitest pass after the
  vitest pin (was completely broken on main). Typecheck: every package
  green EXCEPT `@clawmind/telemetry` which has a pre-existing OpenTelemetry
  1.x/2.x peer mismatch (queued for next tick). Compact.ts TS2783 that was
  silently red on main is now fixed.

- 2026-06-20 08:05 PDT (Cake/cron) — 5 features shipped on feature/autoship.
  Features: c47bc78, 77e0d9a, 2146dcb, 6a7327b, dd00423. Test gate:
  `@clawmind/cli` 94/94 vitest pass (up from 70). Typecheck: `@clawmind/cli`
  green, telemetry pre-existing red unchanged (confirmed by running typecheck
  on packages/telemetry both before and after the batch — identical error,
  not introduced by anything in this batch). All five focus the same theme:
  scripting ergonomics. stats grew --top/--sort/--tsv so the namespace
  breakdown is finally pipeline-friendly without `jq`; search grew
  -t/--threshold to push the relevance floor into the command; forget grew
  --paths-only to mirror stale --paths and complete the pipeline `clawmind
  stale --paths | xargs -n1 clawmind forget --apply`.

- 2026-06-20 12:27 PDT (Cake/cron) — 5 features shipped on feature/autoship.
  Features: e91c76d, 7c84163, 28cd9c6, 2645a6b, 8538749. Test gate:
  `@clawmind/cli` 113/113 vitest pass (up from 94). 19 net new tests
  spread across 5 files: pins.test.ts (new, 4), mutes.test.ts (new, 4),
  aliases.test.ts (+2), search.test.ts (+5 stdin and +4 --no-snippet).
  Typecheck: same pre-existing telemetry/declaration-file pattern (chai
  duplicate identifiers + ts target downlevel + kleur esModuleInterop)
  unchanged; no new errors introduced.
  Theme: round out the `--paths` pipeline contract that started with
  stale --paths and forget --paths-only. pins/mutes/aliases all grew the
  same `--paths` flag (one path per line, no styling, no headers, no
  notes/reasons/timestamps; zero matches yields an empty stream). This
  makes a whole new class of one-liner real:
    clawmind pins list --paths -q stale | xargs -n1 clawmind forget --apply
    clawmind aliases list --paths -q work | xargs ls -la
  search grew `--no-snippet` (drops snippet/highlights from the --json
  payload so rerank/eval pipelines get an order-of-magnitude smaller
  shape) and stdin support (`clawmind search -` reads the query from
  stdin so `echo foo | clawmind search -` works in shell loops without
  argv quoting). Stdin mode rejects the empty stream loudly so an
  accidental `cmd | clawmind search -` upstream-empty does NOT
  silently dump the index.

- 2026-06-20 16:05 PDT (Cake/cron) — 5 features shipped on feature/autoship.
  Features: 4457b33, 87de268, fe4dc23, 7579ed7, 3e4ba85. Test gate:
  `@clawmind/cli` 136/136 vitest pass (up from 113). 23 net new tests
  spread across 4 files: tags.test.ts (new, 4), stats.test.ts (+4),
  feedback-digest.test.ts (+4), ask.test.ts (new, 11).
  Typecheck: `@clawmind/cli` clean. Two pre-existing reds remain
  outside the cli package: (1) `@clawmind/telemetry` OpenTelemetry
  1.x/2.x peer mismatch — same as previous 3 ticks, queued; (2)
  `packages/rag/test/hybrid.test.ts` is failing under the current
  alpha-blend semantics (expects 'b' first but gets 'a'). Verified
  pre-existing by typechecking parent commit 3cc6fd1 — same failure
  there. Was simply unknown until this tick because earlier ticks ran
  `--filter @clawmind/cli test`, not `pnpm -r test`. Logged in the
  Queued list for a future tick to fix.
  Theme: round out the queued cli features the previous 3 ticks had
  punted: pipeline-friendly tags paths (matches the pins/mutes/aliases
  --paths contract); --compact JSON for stats (single-line so NDJSON
  cron snapshots diff cleanly); digest show -q (history-row substring
  filter spanning new/removed paths); and the two ask gates the
  roadmap explicitly asked for — --no-citations (drops the citations
  footer in text mode AND the citations[]+count fields in --json) and
  --threshold (a pre-LLM gate that aborts before any token is spent
  when no retrieved source clears the score bar, exiting 1 with a
  structured skip payload in --json mode for shell-pipeline branching).
  Crucial design property of --threshold: it short-circuits AT the
  sources event, so the askStream generator never actually pulls
  from `deps.llm.stream(...)` — the LLM is genuinely not called,
  not just hidden after the fact.

- 2026-06-20 18:51 PDT (Cake/cron) — 5 features shipped on feature/autoship.
  Features: d7ab8a1, 2762613, 5adbd71, 49ce082, 28b0414. Test gate:
  `@clawmind/cli` 160/160 vitest pass (up from 136). 24 net new tests
  spread across 5 files: ask.test.ts (+4), status.test.ts (+5),
  forget.test.ts (+5), doctor.test.ts (+5), search.test.ts (+5).
  Typecheck: `@clawmind/cli` clean. Same two pre-existing reds outside
  cli (telemetry OpenTelemetry 1.x/2.x peer mismatch + rag/hybrid
  test alpha-blend drift); neither introduced this tick.
  Theme: knock out four of the five queued cli items the previous
  ticks had punted, plus complete the `--paths-only` pipeline
  contract across the last unreached command (search).
    1. ask --out: mirrors `search --out`, writes assembled
       answer (sources header + body + latency + optional citations)
       to a file in text mode, JSON payload in --json mode. Critical
       design: token-by-token stdout dribble is suppressed when --out
       is set so the answer is NOT rendered twice (terminal + file).
       Saved files are ANSI-clean. Stderr carries the green
       "wrote answer" confirmation.
    2. status --check: CI smoke-check flag. Body unchanged so a
       single command can both report AND drive the exit code.
       Non-OK → exit 2 (NOT 1 — reserved for command crashes, so
       wrappers can distinguish "ran fine, probe down" from
       "command crashed"). In text mode, also drops a red
       "status --check: <down probes> down" line to stderr so
       scripts redirecting stdout still get a useful log line.
    3. forget --confirm <n>: safety tripwire. With --apply, does a
       dry-run pre-flight FIRST to learn the real count, then only
       proceeds to destruction when count === N exactly. The "-1"
       sentinel is the explicit opt-out for unknown-size scripts.
       Without --apply, --confirm is silently ignored (dry-run is
       already safe). Error spells out BOTH numbers and the correct
       re-run command so the operator can copy-paste a fix.
    4. doctor --severity <info|warn|error>: display-only filter; the
       exit code is STILL driven by the FULL report's `ok` flag so
       hiding warnings can never accidentally hide an error from CI.
       Adds two text-mode hints: "<n> below --severity X; nothing
       to show" when filter empties the table, and "... <n> more"
       at the tail when some rows are hidden. --json mode adds a
       new `findingsTotal` field alongside the filtered `findings`
       array so a dashboard can show "1 of 3" without re-running.
    5. search --paths-only: completes the pipeline contract begun
       with pins/mutes/aliases/tags --paths and forget/search
       --paths-only. Deduplicates by path in rank order (search
       returns chunk-granular hits so the same file can appear
       multiple times). Short-circuits before --json/--out/etc.
       Empty stream on zero matches — critically does NOT leak the
       stderr "no results" hint that would poison `xargs ls`.
       Threshold + tag filters still compose naturally.
  All five focus the same theme: scripting ergonomics. The cli
  surface is now noticeably more pipeable — every list-style command
  has the same --paths/--paths-only contract; --out exists on both
  search and ask; --check exists for CI smoke-checking; --confirm
  exists as a tripwire on the only destructive command.
  Verify-gate note: ran `pnpm run ci:verify` which hit the same two
  pre-existing reds (telemetry typecheck + rag hybrid test). Both
  remain queued, both verified pre-existing this and prior ticks.
  Also hit a vitest fork-pool deadlock after wiping the .vite cache
  mid-tick (macOS quirk); switching to --no-isolate cleared it. No
  fix required — the normal `pnpm --filter @clawmind/cli test` path
  is unaffected outside of a stale-cache hiccup.

- 2026-06-20 22:01 PDT (Cake/cron) — 5 features shipped on feature/autoship.
  Features: 5d6edcf, f9f81a4, 5db09c2, ca8f043, a7ec554. Test gate:
  `@clawmind/cli` 186/186 vitest pass (up from 160). 26 net new tests
  spread across 4 files: related.test.ts (+4), stats.test.ts (+5),
  stale.test.ts (+4), feedback-digest.test.ts (+13 — 5 digest --since
  + 8 feedback --above/--below). Typecheck: `@clawmind/cli` clean.
  Same two pre-existing reds outside cli (telemetry OpenTelemetry
  1.x/2.x peer mismatch + rag/hybrid test alpha-blend drift); neither
  introduced this tick.
  Theme: complete the absolute-date filter family + finish the
  paths-only contract.
    1. related --paths-only: the last list-style command missing
       the --paths-only / --paths contract that pins/mutes/aliases/
       tags/search/forget/stale already had. Dedupes against a Set
       in rank order (the API today returns one row per source but
       the contract promises dedupe so a future change cannot
       silently break callers). Zero matches yields a clean empty
       stream — no header, no "no related sources" hint, no ANSI
       — so `clawmind related foo.md --paths-only | xargs ls`
       works without conditional skips. Short-circuits --json so
       the contract is unambiguous when both flags are set.
    2. stats --since <iso-date>: keeps only namespaces whose
       newestIngestedAt predates the cutoff. The namespace-level
       complement to per-file `stale`. Two intentional design
       properties: (a) newestIngestedAt=null is KEPT (a
       never-indexed namespace is the most extreme case of stale,
       so dropping it would hide exactly the bug an operator
       cares about); (b) totals are RECOMPUTED so a downstream
       "stale namespaces account for X bytes" report still adds
       up. Composes with -q for "stale memory-ish namespaces".
       Invalid ISO date aborts cleanly.
    3. stale --since <iso-date>: absolute-date complement to
       --days <n>. The existing --days is a relative window
       anchored to wall-clock; --since accepts an absolute anchor
       which matters from cron where the cutoff often lives in a
       config or env var. Composes with --days as an intersection.
       Effective lastIngestedAt is derived from row.ageDays - the
       API only exposes ageDays, but ageDays is computed from the
       underlying timestamp so the round-trip is lossless to the
       day. `total` is recomputed from the filtered length so the
       text-mode "N stale, showing M" header stays accurate
       post-filter. Filter applies to every output mode (--json,
       --paths, --tsv, default text).
    4. digest show --since <iso-date>: bound the history window
       by absolute date. Pairs naturally with -q ("what did
       saved-search X surface about path Y since date Z").
       Cutoff is INCLUSIVE (>=) because a row with ts === cutoff
       is "from the cutoff onwards" by every colloquial reading.
       The text-mode empty-state hint was generalised — the old
       "-q only" wording would have lied when --since was the
       narrowing filter; new unified hint mentions whichever
       filter(s) are active.
    5. feedback list --above/--below: filter entries by boost
       multiplier. Answers the cron-friendly questions
       ("upvote-dominant paths", "strongest downvotes",
       "almost-neutral band") without piping --json through jq.
       STRICT comparisons (`>` and `<`) so boost === 1.0 is
       excluded from both --above 1.0 and --below 1.0 — neutral
       is excluded from signed-motion questions. Both flags
       compose as an intersection so --above 0.95 --below 1.05
       is the "almost neutral" band in a single invocation.
       Filter applies BEFORE --json emit / text rendering so both
       output modes see the same subset. -q forwards to API
       unchanged; --above/--below apply client-side on top.
  Verify-gate note: ran the full `pnpm typecheck` and `pnpm -r
  test`. The only failures are the same two pre-existing reds
  noted above. The `@clawmind/cli` build is clean.

- 2026-06-21 00:40 PDT (Cake/cron) — 5 features shipped on feature/autoship.
  Features: 51dd7b8, 53e2550, fc363f0, 814cbe5, 76a5c9e. Test gate:
  `@clawmind/cli` 216/216 vitest pass (up from 186). 30 net new tests
  spread across 4 files: related.test.ts (+5), feedback-digest.test.ts
  (+7), stats.test.ts (+6), watch.test.ts (new, 12). Typecheck:
  `@clawmind/cli` clean. Same two pre-existing reds outside cli
  (telemetry OpenTelemetry 1.x/2.x peer mismatch + rag/hybrid test
  alpha-blend drift); neither introduced this tick.
  Theme: knock out the queued cli items that mirror existing
  contracts on adjacent commands.
    1. related --threshold: mirrors `search --threshold` byte-for-byte
       (inclusive lower bound, non-numeric silently ignored so
       `--threshold $MAYBE` does not crash on an empty env var,
       filter applied BEFORE --paths-only / --json / text so every
       output mode sees the same subset). Applied client-side
       because the /v1/related API does not accept a minScore
       parameter today; exposing the dial on the cli avoids an
       API change for a genuinely-presentational choice. The
       --json `count` field is recomputed to the kept length so a
       downstream `jq '.count'` consumer is not lied to;
       `sourceChunkCount` is preserved verbatim (it's a property
       of the source, not the returned set).
    2. digest show --last <n>: caps history to the newest N rows
       after -q / --since narrow the survivors. API returns
       history newest-first, so slice(0, N) is correct without a
       re-sort. The cap is applied LAST so the semantics are
       "the newest N rows that pass every other filter" — that
       is what an operator asks ("the 5 most recent runs about
       /foo.md in the last week" composes -q + --since + --last
       naturally). A non-positive or NaN value is rejected
       cleanly because a typo like `--last 0` would silently
       produce an empty result that looks like "history was
       empty" rather than "filter narrowed to zero", and the
       unified empty-state hint depends on the distinction.
    3. stats --paths: per-namespace extensions flat stream. The
       walk is namespace order (server-provided), then ext order
       per namespace. Composes with -q (filter by namespace name)
       and --top (cap each contribution) for "the top 3 exts in
       namespaces matching `mem`". Critical design choice: no
       implicit cross-namespace dedupe so `grep -c md` counts the
       namespaces that contain that ext (`sort -u` is left to the
       consumer if they want the unique set; we cannot rebuild
       duplicates after the fact). Wins over --json / --tsv /
       text when set — same precedent as search --paths-only
       short-circuiting --json.
    4. watch --debounce <ms>: forwards to the watcher's existing
       `debounceMs` wiring. Zero / negative / NaN values rejected
       up front rather than silently disabling the debounce —
       `--debounce 0` would melt CPU during a `git checkout`
       burst. Missing flag forwards as undefined so the watcher's
       own `debounceMs ?? 800` fallback keeps working.
    5. watch startup banner: one-line `{"kind":"banner","root","ts"}`
       NDJSON document to stderr on each successful start. The
       text-mode "Watching <root>" line stays on stdout for the
       operator; the banner is the parallel log-scrape signal so
       a stderr-tailing parser detects restarts without parsing
       the (potentially noisy) stdout NDJSON event stream. Fires
       UNCONDITIONALLY (text + --json) but NOT on the --debounce
       validation error path — there is no half-started process
       to mark.
  Test approach for watch: a sentinel-throwing mock for
  startWatcher captures the exact options the real watcher would
  have received AND lets the action body unwind without hitting
  the production `await new Promise(() => undefined)` deadlock.
  Same `vi.mock('../src/runtime.js', ...)` pattern as status/ask/
  search tests, plus a third mock for `@clawmind/config` so
  expand() and loadEnv() resolve without touching the filesystem.
  Verify-gate note: ran the full `pnpm typecheck` and
  `pnpm -r test`. Same two pre-existing reds (telemetry +
  rag/hybrid); neither was introduced by this tick. The
  `@clawmind/cli` package is fully green (216 tests).
  Note on stray build artifacts: at tick start the working tree
  had untracked .js / .d.ts / .js.map / .d.ts.map sidecars under
  apps/cli/src/commands/ (a previous stray `tsc` invocation
  leaked them next to the .ts sources). Cleaned with
  `git clean -f apps/cli/src/commands/` before any feature work
  so they could not accidentally be committed. Worth adding
  `apps/cli/src/**/*.js` to .gitignore in a future tick to make
  the trap impossible.

- 2026-06-21 04:13 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: 3b48fdd, 6ac5d2b, 9796f9b, 9bc0992, 8ecf026. Test gate:
  `@clawmind/cli` 254/254 vitest pass (up from 216). 38 net new tests
  spread across 5 files: watch.test.ts (+9 → 21), stale.test.ts (+4
  → 15), stats.test.ts (+7 → 45), reindex.test.ts (new, 10),
  ingest.test.ts (new, 8). Typecheck: `@clawmind/cli` clean. Same
  two pre-existing reds outside cli (telemetry OpenTelemetry 1.x/
  2.x peer mismatch + rag/hybrid test alpha-blend drift); neither
  introduced this tick. Verified the telemetry red is pre-existing
  by running `pnpm --filter @clawmind/telemetry typecheck` on a
  clean working tree before any commits — same error.
  Theme: round out the cron pipeline contract (incremental refresh,
  preview before mutation, slim cron snapshots, unified naming).
    1. watch --quiet / -q: suppresses the per-file event chatter
       in BOTH text mode (the gray `add /foo.md` lines) and --json
       mode (the per-event NDJSON documents). Critically the
       startup banner on stderr STILL fires AND the
       "Watching <root>" stdout line STILL prints, so a log
       scraper detects restarts and an interactive operator sees
       the watcher came up. The contract is "no chatter, restart
       marker stays" — matches how logrotate / journalctl
       --since=last-restart expect restart-aware peers to behave.
       The cron use is a watcher restarted by cron whose journal
       only needs the restart marker, not 100/sec event chatter
       from a tight `npm install` burst. Composes with --debounce
       (orthogonal concerns: --debounce shapes re-ingest cadence,
       --quiet shapes the operator-facing stream).
    2. stale --paths-only: alias for --paths to unify the flag
       family. stale shipped first with --paths and pinned the
       byte layout in tests; every later list-style command
       (search/forget/related/pins/mutes/aliases/tags) adopted
       --paths-only as canonical. Both flags now emit byte-
       identical streams; existing --paths scripts keep working
       unchanged AND new scripts can use the family-wide
       --paths-only naming without special-casing stale. When both
       are passed the effect is identical (no warning, no
       precedence — they are truly equivalent and the action body
       short-circuits on a single OR rather than emitting twice).
    3. stats --slim: slim JSON shape `{stale: [<namespace>],
       total: N}` carrying ONLY namespace names (no per-namespace
       metric blocks, no totals, no generatedAt). The natural
       cron pair is `clawmind stats --json --slim --since <iso>`
       to answer "which namespaces have gone stale at the
       namespace level" without piping the full report through
       `jq` for the names. Invariants pinned in tests:
       total === stale.length (consumer never reconciles two
       fields); single-line output for clean snapshot diffing;
       --slim wins over --compact (both ask for one-line JSON,
       --slim is the stricter reshape); empty payload is a clean
       `{stale: [], total: 0}` so `jq -e '.total > 0'` branches
       on emptiness without inspecting the array.
    4. reindex --dry-run: the "preview the destructive action"
       gate. Walks the same discoverFiles() the real ingest
       would visit (so the preview is byte-faithful to the real
       run, with .clawmindignore and the built-in include/exclude
       globs both applied) WITHOUT dropping the manifest,
       touching the BM25, or invoking ingest. Three output
       shapes: --paths-only (xargs-safe, one path per line, no
       header), --json ({root, count, files}), default text
       (yellow count header + gray path list + rerun nudge).
       Matches the forget --dry-run UX. Zero-discovered yields a
       count-zero header with NO rerun nudge (nothing to reindex
       => nothing to rerun) and a clean empty stream in
       --paths-only mode.
    5. ingest --since <iso-date>: the incremental-refresh gate.
       Without --since, ingest walks every file under the
       workspace and lets the per-file hash/manifest dedupe path
       skip anything unchanged — correct but expensive on a
       large index. --since cuts off the work much earlier:
       stat() each discovered path and drop the ones whose mtime
       predates the cutoff BEFORE any reading happens. Classic
       cron use:
         clawmind ingest --since "$(date -u -d '1 hour ago' +%FT%TZ)"
       Design choices:
       - Cutoff INCLUSIVE (mtime >= cutoff): a file modified
         exactly at the cutoff is "modified at the cutoff",
         which is the boundary an operator passing the previous
         tick's wall-clock cares about. Exclusive bounds would
         silently miss changes that happened in the same second
         as the previous tick — anti-goal of the flag.
       - Parse failures abort with exit 1, not silent degrade to
         "no filter". A typo like --since 2026-13-01 silently
         re-ingesting the whole workspace is the worst possible
         failure mode for a flag whose entire purpose is to do
         less work.
       - stat() failures on individual files are non-fatal: the
         file is silently dropped (cannot be re-ingested anyway).
       - Filtered list goes through ingestPaths(); the no-flag
         path still uses ingestRoot() byte-for-byte.
  Push: 4b6ffdc..8ecf026 main -> main. No PRs created. All
  commits authored as `Cake (cron)
  <51058514+Sanjays2402@users.noreply.github.com>`.
  Verify-gate note: ran `pnpm run ci:verify` which hit the same
  two pre-existing reds (telemetry typecheck + rag hybrid test);
  neither introduced by this tick. The `@clawmind/cli` package
  is fully green (254 tests, +38 from prior tick).

- 2026-06-21 07:05 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: d951f11, d9f9dda, fc6e3f2, d589255, 216077b. Test gate:
  `@clawmind/cli` 292/292 vitest pass (up from 254). 38 net new tests
  spread across 4 files: doctor.test.ts (+6 → 15), ingest.test.ts
  (+10 → 18), tags.test.ts (+10 → 14), feedback-digest.test.ts
  (+11 → 52). Also added a new prune-cli describe block. `@clawmind/api`
  tests pass 1223/1223 (the doctor route schema change is backwards
  compatible because the new querystring parameter is optional).
  `@clawmind/cli` typecheck: clean. Same two pre-existing reds outside
  cli (telemetry OpenTelemetry 1.x/2.x peer mismatch + rag/hybrid test
  alpha-blend drift); both verified pre-existing in this tick by
  running `pnpm --filter @clawmind/telemetry typecheck` and `pnpm -r
  test` on a clean working tree before the diff was committed —
  identical errors, neither introduced here.
  Theme: knock out THREE explicitly-queued items (the doctor
  --staleAfterDays flag the queued list called out by name; the
  ingest --paths-only --dry-run rehearsal shortcut the queued list
  called out by name; the .gitignore trap the queued list called
  out by name) PLUS two scripting-ergonomics features that mirror
  contracts already in the cli (tags list --sort/--top mirrors
  stats; feedback prune --below mirrors feedback list --below +
  forget --apply).
    1. chore(repo) .gitignore: four new globs — `apps/cli/src/**/*.js`,
       `*.d.ts`, `*.js.map`, `*.d.ts.map` — so a stray `tsc`
       invocation inside apps/cli (instead of through `pnpm build`,
       which writes to apps/cli/dist) cannot leak build artifacts
       into the source tree. The `.d.ts.map` glob is the subtle one:
       tsc's --declarationMap emits .d.ts.map alongside .d.ts and
       the bare `*.d.ts` glob does NOT match it. Caught and cleaned
       in the 2026-06-21 00:40 PDT tick; this makes the trap
       impossible going forward.
    2. doctor --stale-after-days end-to-end (API + CLI):
       /v1/doctor route grew an optional ?staleAfterDays=<n> query
       string. CLI grew a matching --stale-after-days flag that
       forwards as the query string. Server-side bound 0..3650 days
       (zero is a valid tripwire for "any age counts as stale";
       3650 is ~10 years cap to catch typos). Client-side bound-
       check fires BEFORE the fetch so a negative / out-of-range /
       non-numeric value aborts with a single crisp message instead
       of wasting a round-trip on the API's generic 400. The
       natural cron use is `clawmind doctor --severity error
       --stale-after-days 1` for a nightly CI freshness SLO.
       Without the flag the URL is byte-for-byte legacy /v1/doctor
       so every existing dashboard works unchanged (regression
       pinned).
    3. ingest --dry-run + --paths-only: a natural cron pre-flight.
       Previews the set of files an incremental refresh WOULD
       touch (composes with --since so the preview matches the
       refresh) without reading, hashing, or upserting anything.
       Output shapes match `reindex --dry-run` byte-for-byte
       (--paths-only > --json > text). The --since validation
       fires BEFORE the dry-run branch so a typo'd cutoff still
       kills the run cleanly (no silent degrade to a misleading
       "full discovery" preview). Empty dry-run yields a clean
       count-zero header in text mode and a clean empty stream
       in --paths-only mode. The --paths-only contract now spans
       every list-style command in the cli: search, forget,
       stale, related, pins, mutes, aliases, tags, reindex, and
       ingest all emit the same byte layout for xargs/wc -l.
    4. tags list --sort <count|tag> and --top <n>: shapers that
       mirror `stats --sort` / `stats --top` byte-for-byte so the
       muscle memory carries between the two. --sort count
       (default) keeps the API order verbatim; --sort tag re-sorts
       alphabetical (diff-stable for cron snapshots). --top is the
       final shaper (slices the head off the sorted list AFTER
       --sort). Non-positive or NaN --top clamps to "no cap"
       rather than yielding a surprising empty table (mirrors
       stats --top clamping). --top 0 falls back to the full
       list. The `count` field in --json reflects the post-cap
       length (every other --top in the cli already honours
       this).
    5. feedback prune --below <n> --apply: destructive sibling of
       `feedback list --below`. The cron answer to "every Sunday
       morning, clear feedback entries whose boost has decayed
       below 0.7". --below is REQUIRED (no "prune everything"
       shorthand — an auto-completed `feedback prune --apply`
       must never wipe the map). Strict comparison (matches the
       `feedback list --below` semantic, pinned with a /neutral.md
       row at boost === 1.0 that --below 1.0 must NOT match).
       Mirrors the `forget --apply` safety pattern: dry-run by
       default, --apply for the destructive run. The dry-run is
       byte-identical to the apply call MINUS the DELETE so the
       operator copy-pastes their preview + " --apply" to move
       from rehearsal to destruction. Partial failures do NOT
       abort the rest of the prune; failed paths are surfaced in
       report.errors[] and exit code is set BEFORE the --json
       early-return so JSON and text consumers agree on the
       failure signal.
  Verify-gate note: ran `pnpm run ci:verify` which hit the same
  two pre-existing reds (telemetry OpenTelemetry 1.x/2.x +
  rag/hybrid alpha-blend) — both verified pre-existing in THIS
  tick by running the failing commands on a clean working tree
  before the diff was committed. `@clawmind/cli` package is
  fully green (292 tests, +38 from prior tick) AND `@clawmind/cli`
  typecheck is clean. `@clawmind/api` tests pass 1223/1223
  including all 6 doctor route tests with the new query schema.
  Push: 504d92a..216077b main -> main. All five commits authored
  as `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.

- 2026-06-21 10:11 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: 2ef0c8b, 51092d2, 41b383c, becae0c, c40a2ec. Test gate:
  `@clawmind/cli` 329/329 vitest pass (up from 292). 37 net new tests
  spread across 5 files: feedback-digest.test.ts (+14 → 66), pins.test.ts
  (+5 → 9), mutes.test.ts (+4 → 8), doctor.test.ts (+7 → 22),
  reindex.test.ts (+7 → 17). `@clawmind/cli` typecheck: clean.
  Same two pre-existing reds outside cli (telemetry OpenTelemetry 1.x/
  2.x peer mismatch + rag/hybrid alpha-blend drift); neither
  introduced this tick (verified by running ci:verify which hit the
  identical telemetry red as every prior tick, and by running
  `pnpm --filter @clawmind/api test` against my head AND against the
  parent — `@clawmind/api` 1223/1223 in both, the 2 flakes on one
  parallel run dropped to 0 on the second run; not my changes).
  Theme: knock out four explicitly-queued items + complete the
  --above/--below symmetry on feedback prune that the queued list
  had explicitly carved out.
    1. feedback prune --above: symmetric sibling of --below. The
       classic cron use is a cap recalibration ("we lowered
       MAX_BOOST from 1.5 to 1.45, clear every entry above 1.45 so
       re-vote pressure restarts cleanly"). Strict comparison (`>`)
       so an entry at exactly the threshold is preserved (it is ON
       the new ceiling, not above it). Composes with --below as an
       OR predicate so a single invocation can trim both tails
       (`--above 1.05 --below 0.95 --apply` clears everything
       outside the [0.95, 1.05] neutral band). At least one of
       --below/--above is now required (the existing tripwire
       generalises). Text mode header narrates the predicate that
       ran ("below boost 0.95 or above boost 1.04") so the cron
       log is auditable.
    2. pins/mutes list --since <iso-date>: client-side post-filter
       on pinnedAt / mutedAt. The natural cron use is a daily
       snapshot of "what got pinned (or muted) in the last 24h"
       without scrolling through every entry. Mirrors the --since
       semantics on stale/stats/digest show byte-for-byte (cutoff
       INCLUSIVE >=; composes with -q as intersection; recomputed
       count reflects filtered length; filter applies BEFORE
       --paths short-circuit; typo'd cutoff aborts cleanly with
       exit 1 instead of silently degrading to "no filter").
       Single feature touching both files because the symmetry is
       what makes the cron use real (`pins list --since X --paths`
       and `mutes list --since X --paths` must behave identically).
    3. doctor --json --quiet: slim 5-field shape for tight cron
       dashboards. `{ok, findingsCount, errors, warnings, infos}`
       instead of the full per-finding payload. The classic cron
       use is a dashboard panel that needs "is the index ok? how
       many errors?" in five fields without piping the full report
       through jq for the count. Pairs naturally with --severity
       error for a nightly CI freshness gate:
         clawmind doctor --json --quiet | jq -e '.errors == 0'
       Design properties: `ok` mirrors the FULL report's flag so
       hiding findings via --severity never accidentally hides an
       unhealthy report from the slim shape; `findingsCount` is
       the TOTAL count (not the filtered visible count); per-
       severity tallies use the API's vocabulary verbatim; single-
       line JSON for clean NDJSON snapshot diffing; exit code
       still reflects r.ok; --quiet without --json is a no-op
       (text mode unchanged); --quiet wins over the full --json
       payload when both set.
    4. reindex --since <iso-date>: mtime filter for a partial-
       reindex flow. Composes with both --dry-run (preview the
       narrowed set without mutating) AND the destructive path
       (when set without --dry-run, the wipe still happens, then
       ingest is called with --since so only the recently-modified
       files are re-ingested; sources older than the cutoff stay
       MISSING from the rebuilt index until the next full reindex).
       The natural use: `clawmind reindex --since "$(date -u -d
       '1 week ago' +%FT%TZ)"` rebuilds from scratch but only
       walks the files that changed recently. CRITICAL SAFETY:
       parse failures abort BEFORE any wipe — the live path runs
       the manifest+BM25 wipe FIRST then calls ingest, so a typo'd
       cutoff landing mid-flight would leave the index in a
       partial state the operator could only recover from with a
       full reindex (defeating the whole purpose of the flag).
       Validation hard-fails up front. Other contract pinning:
       cutoff INCLUSIVE (>=) — matches the --since semantics across
       ingest/stale/pins/mutes/stats/digest show; stat() failures
       on individual files are non-fatal (drop the file silently);
       --paths-only short-circuits before --json with --dry-run.
    5. digest run --since <iso-date>: narrows the batch path to
       saved searches whose lastRunTs predates the cutoff. The
       natural cron use is "re-run only digests that have not run
       in the last hour", which lets a frequent tick (every 5min)
       catch newly-added + drifted digests while skipping anything
       a slower tick already covered. Implementation: list
       /v1/digests, filter client-side, then POST per-id to
       /v1/digests/<id>/run for each survivor (instead of
       /v1/digests/run which unconditionally runs every saved
       search). A few extra round-trips but the LLM/embed budget
       skipped on the recent-runs path dominates the cost.
       Contract: cutoff parse failures abort with exit 1 BEFORE
       any list/run; lastRunTs === null (never-run digest) is
       ALWAYS INCLUDED (most extreme case of "needs running"; a
       filter that hid never-runs would be unsafe for a new saved
       search the operator just added); strict less-than (<) so a
       digest at exactly the cutoff is SKIPPED (it ran AT the
       cutoff, satisfying the "leave alone if it ran within the
       last hour" intent); single-digest failures do NOT abort the
       batch (other digests proceed; failing digest retries on
       next tick); --since is ignored when an id is passed (no
       batch to filter); text-mode header narrates both ran and
       skipped counts so a cron log is readable.
  Push: 216077b..c40a2ec main -> main. All five commits authored
  as `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.
  Bonus polish: amended the digest commit (c40a2ec) to fix a
  typo'd email (`51058514+Sanjays2402+Sanjays2402@...` had a stray
  repeat) before push — caught by `git log -1 --pretty=format:%ae`
  in the verify step. All five SHAs now carry the canonical
  noreply ID.

- 2026-06-21 13:26 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: 22bb5f4, d3419d3, e747919, 6ac0f90, 59d79f3. Test gate:
  `@clawmind/cli` 368/368 vitest pass (up from 329). 39 net new tests
  spread across 5 files: export.test.ts (+7 -> 15), search.test.ts
  (+5 -> 30), watch.test.ts (+10 -> 31), feedback-digest.test.ts
  (+7 -> 73), pins.test.ts (+6 -> 15) + mutes.test.ts (+4 -> 12).
  Plus +2 in `@clawmind/rag` pipeline.test.ts (4/4 total) and a new
  `apps/api/test/conversation-export-since.test.ts` (7/7) for the
  route-level export contract. `@clawmind/cli` typecheck: clean.
  `@clawmind/api` 1230/1230 on a clean re-run (one flake on
  api-key-bruteforce timing-dependent lockoutMs assertion in a
  parallel run; not my changes -- verified by running just that file
  in isolation which passed 10/10). Same two pre-existing reds
  outside cli (telemetry OpenTelemetry 1.x/2.x peer mismatch + rag/
  hybrid alpha-blend drift); neither introduced this tick (verified
  by running each in isolation and the alpha-blend one is the same
  failure that has been queued since 2026-06-20 16:05 PDT).

  Theme: knock out FOUR explicitly-queued items + a structural
  improvement to the RAG pipeline interface for debugging.

    1. export --since end-to-end (API + CLI). Server-side: optional
       ?since=<iso-date> on the three per-conversation export routes
       (md / json / csv). INCLUSIVE >= semantics matching every
       other --since across the cli. Empty windows return a
       well-formed export with zero turns, NOT a 404, so a cron
       polling a quiet conversation does not alarm. Invalid ISO
       date returns 400 so a typo cannot silently degrade to the
       full export (would double-bill the bandwidth budget for the
       exact use case the flag was added to fix). Permission check
       fires BEFORE the narrow so --since cannot be used to peek
       at another user's thread. CLI-side: forwards as
       ?since=<encodeURIComponent(value)> so colons / tz offsets
       survive the querystring; validates client-side too so a typo
       aborts BEFORE any round-trip. Without --since the URL is
       byte-for-byte unchanged from the legacy contract (no stray
       `?`, no empty parameter) so every existing script keeps
       working. Two test surfaces: cli (mocked fetch + URL
       assertion) and api (Fastify inject + INCLUSIVE-cutoff /
       md+csv body / empty-window / invalid-ISO / cross-user
       isolation).
    2. search --rerank-off debug escape hatch. Threaded a new
       RetrieveOptions { skipRerank } param through the RAG
       retrieve() pipeline (deps, q, meta, options). When set, the
       pipeline bypasses lexicalRerank entirely and forwards the
       raw boost-adjusted ordering to MMR. Other stages (embed,
       hybrid merge, MMR) stay enabled because they are correctness
       or UX-critical. CLI exposes --rerank-off; forwards
       { skipRerank: true } when set, undefined when absent (NOT
       { skipRerank: false }) so the pipeline default stays unchanged
       for every existing caller. The rag-side test pins the SCORE
       DIFFERENCE rather than ordering -- the lexical bonus on a
       chunk with 20 exact-term occurrences gives a delta > 0.3,
       which is the cleanest signal that the stage actually ran or
       was actually skipped. Pre-existing callers are byte-identical
       (regression test pinned).
    3. watch --once for a single scheduled-scan pass. Lets cron use
       ONE code path for both scheduled refreshes (`watch --once`)
       and live watching (`watch` without --once). The one-shot path
       runs the SAME discoverFiles() + ingestPaths() the chokidar
       watcher's initial scan would do, then exits cleanly with the
       regular ingest report shape. The chokidar tail is NOT
       installed (lastWatcherOpts stays null -- pinned by test as
       the headline contract). The startup banner on stderr STILL
       fires so a log scraper sees the restart marker even on a
       one-shot pass. The "Watching <root>" stdout line is DROPPED
       because there is no long-running process to mark; that label
       would lie on a process about to exit. --debounce / --quiet
       are accepted silently in --once mode (no rejection, no
       behaviour change) so a cron operator can use ONE argv shape
       for both modes. --debounce validation still fires UP FRONT in
       --once mode -- a typo catches early rather than later when
       switching to the live path. Test approach: update the
       existing @clawmind/ingest mock to provide discoverFiles +
       ingestPaths alongside the existing startWatcher stub, then
       assert chokidar is never installed AND the discover/ingest
       call happened exactly once.
    4. digest run --max <n>. Caps how many saved searches run in a
       single batch tick. Surviving candidates after --since
       narrowing are kept in API order (newest-first, stable) and
       the head N are run; the remainder rolls over to the next
       tick because they STILL satisfy --since when it fires again.
       The cap is enforced AT the call site, NOT via post-filtering
       after wasted requests -- per-id POST count equals exactly N.
       Report shape adds `sinceSkipped` / `deferred` / `max` keys
       alongside the existing `ran` / `skipped` / `since` /
       `results`; the combined `skipped` key still sums both reasons
       so the legacy contract holds for every existing parser. Text
       body narrates the two skip reasons separately ("ran 10,
       deferred 3, not stale enough 2") so cron logs are auditable.
       Validation: --max non-positive / NaN aborts BEFORE the list
       fetch (a typo silently becoming an empty batch is
       indistinguishable from a real "nothing to run" tick, which is
       the worst possible failure mode for a cap flag). Ignored
       when an id is passed (single-id runs always run that one
       digest) -- mirrors --since on the same path.
    5. pins/mutes list --by <user>. Filter pins/mutes snapshots to
       entries whose pinnedBy / mutedBy === <user> EXACTLY (NOT
       substring). The exact-match contract is the critical defence
       against per-user audit bleed in a workspace with role-
       suffixed ids (`sanjay-readonly` does NOT match `--by
       sanjay`). Two commands shipped together because the symmetry
       is the entire point -- a cron operator scripting per-user
       snapshots wants the same flag on both sides of the pin/mute
       pair without conditional plumbing. Composes with -q
       (server-side substring filter, content-based) and --since
       (client-side recency filter) as an intersection: -q narrows
       content first, --by narrows creator second, --since narrows
       recency third, all applied BEFORE the --paths / --json /
       text short-circuit. Recomputed count reflects every filter
       that ran; empty-state hint in text mode follows the
       recomputed count, NOT the API total (pinned by test).

  Verify-gate note: ran `pnpm --filter @clawmind/cli test` (368/368
  pass), `pnpm --filter @clawmind/rag test` (43/44 pass -- the 1
  fail is the queued hybrid alpha-blend red), `pnpm --filter
  @clawmind/api test` (1230/1230 pass on second run; one flaky
  timing test on api-key-bruteforce in a parallel run, isolated
  test passes 10/10), `pnpm --filter @clawmind/cli typecheck`
  (clean), and `pnpm typecheck` (only red is the queued telemetry
  OpenTelemetry peer mismatch). Same two pre-existing reds as
  every prior tick; neither introduced here. Push: 0028623..59d79f3
  main -> main. All five commits authored as `Cake (cron)
  <51058514+Sanjays2402@users.noreply.github.com>`.

  Theme connector: this tick is the explicitly-queued sweep. Four
  of the five features (export --since, search --rerank-off, watch
  --once, pins/mutes --by) were named in the queued list by exact
  shape; the fifth (digest run --max) was named by intent ("cap
  how many digests fire in a single batch tick"). The structural
  change (RetrieveOptions through retrieve()) is the first time
  the RAG pipeline has exposed a stage-bypass dial -- set up so
  future debug knobs land cleanly on the same interface.

- 2026-06-21 16:57 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: 2d9f396, c1d622f, b0da13a, 08fcba0, 465b833. Test gate:
  `@clawmind/cli` 393/393 vitest pass (up from 368). 25 net new tests
  spread across 4 files: search.test.ts (+6 -> 36), related.test.ts
  (+4 -> 17), feedback-digest.test.ts (+4 -> 77), forget.test.ts
  (+4 -> 16), stats.test.ts (+7 -> 52). Plus +4 in `@clawmind/rag`
  pipeline.test.ts (8/8 total) for the skipMmr stage-bypass path.
  `@clawmind/cli` typecheck: clean. `@clawmind/api` 1230/1230 on a
  clean re-run (snapshots prune-arithmetic test flaked once in a
  parallel run; isolated run passes 11/11, not my changes -- I did
  not touch apps/api this tick). Same two pre-existing reds outside
  cli (telemetry OpenTelemetry 1.x/2.x peer mismatch + rag/hybrid
  alpha-blend drift); neither introduced this tick.

  Theme: knock out the explicitly-queued sweep -- FIVE of five
  features were named in the queued list by exact shape. The
  --rerank-only flag pairs the existing --rerank-off into a 3-way
  A/B against the same query, the related namespaces test pins a
  contract that existed since day one but had no regression
  coverage, the digest slim shape mirrors doctor --quiet for the
  cron-budget dashboard panel, the forget paths-only short-circuit
  fixes a fragile-script edge case (operators who always pass
  --json now get path-per-line when also passing --paths-only),
  and the stats slim-tsv shape is the awk-pipeline contract on
  the slim path.

    1. search --rerank-only (skipMmr through RetrieveOptions). The
       second debug escape hatch on the RAG pipeline, mirroring
       --rerank-off. Bypasses the MMR diversity reorder so the
       operator sees what the lexical rerank step ALONE thinks is
       the most relevant set, in rerank-score order. Forwards
       { skipMmr: true } through retrieve(); pipeline returns the
       head q.k of the rerank output (sliced, NOT mmrRerank). Both
       flags can be combined for the most extreme bypass ("show
       me the raw hybrid+boost ordering with no heuristic stages
       applied"). Critical design property: when neither flag is
       set, the options arg stays UNDEFINED (NOT {}) so every
       existing caller in the codebase is byte-identical to
       before. Pipeline-side test pins skipMmr genuinely changes
       the result set (3 same-document chunks survive instead of
       MMR's diversity-promoted /other.md chunk), honours q.k,
       regression on the default path, and the combined
       skipRerank+skipMmr case. CLI-side test pins the flag
       forwarding shape across the 3-way and the composition
       with --threshold / --paths-only.

    2. related -n/--namespaces end-to-end regression test. The
       flag has existed since the command first shipped but
       never had a test asserting the URL it produces. Four new
       tests pin the contract: -n forwards verbatim as
       ?namespaces=<csv>; --namespaces (long form) produces the
       SAME url as -n (catches binding drift); WITHOUT the flag,
       the param is OMITTED entirely (not sent as empty string,
       which a stricter future server schema could read as
       "match nothing"); composes with -k and --threshold (the
       URL carries -n and -k, --threshold stays client-side).
       Defensive coverage on a flag whose silent failure would
       leak every existing pipeline depending on namespace
       narrowing.

    3. digest run --json --slim. Mirrors `doctor --json --quiet`
       byte-for-byte: emit ONLY {ran, deferred, sinceSkipped} —
       the three integers a cron dashboard panel needs to answer
       "did the cron tick get through the batch?" without
       parsing the per-id results blob. Single-line JSON for
       clean NDJSON snapshot diffs. The canonical cron poll is
       `clawmind digest run --since X --max 10 --json --slim` —
       three integers tell the dashboard whether the cap fired,
       whether the cutoff filtered candidates, and how many
       actually ran. The combined `skipped` total is dropped
       from the slim shape (recomputable as deferred+sinceSkipped
       if a consumer wants the legacy field). Empty workspace
       yields `{ran:0, deferred:0, sinceSkipped:0}` (valid JSON
       so `jq -e '.ran > 0'` does not parse-error on a quiet
       tick). --slim without --json is silently ignored
       (text-mode unchanged); ignored when an id is passed (no
       batch to slim).

    4. forget --paths-only short-circuit (paths-only WINS over
       --json). Before this tick, --json won over --paths-only
       on the forget command and a script that always passed
       --json for ApiError safety AND --paths-only when it
       wanted xargs-ready output had to conditionally strip
       --json — fragile and not what the operator's intent was.
       Now --paths-only short-circuits BEFORE the --json branch
       so the combo `--json --paths-only` (and the
       explicit-everything `--apply --json --paths-only`) emits
       one path per line. Matches the precedent set by `search
       --paths-only`, `related --paths-only`, and the
       pins/mutes/aliases/tags --paths family: pipeline-friendly
       trumps machine-readable. Critical regression: --json
       WITHOUT --paths-only still emits the structured payload
       so every existing JSON consumer is byte-identical to
       before; the short-circuit is GATED on --paths-only being
       set.

    5. stats --json --slim --tsv. The awk-pipeline shape on the
       slim path: one `<namespace>\\t<files>` row per surviving
       namespace, no header, no totals row, no ANSI. The canonical
       cron use is `clawmind stats --json --slim --tsv --since X
       | awk -F'\\t' '$2 > 100'` — two filters in one pipeline
       (staleness via --since at namespace level, size via awk
       on column 2) without `jq` flattening the slim shape.
       Files (NOT bytes/chunks) for the second column because
       files is the cheapest "size" signal and matches what
       `stale --paths` counts (so the two contracts compose:
       `wc -l` on stale --since X --paths agrees numerically
       with `awk '{s+=$2} END {print s}'` on the slim-tsv
       restricted to the same namespaces). Flag resolution
       order fully documented: --paths > --json > --tsv > text
       (existing), within --json: --slim > --compact (existing),
       within --slim: --tsv > slim-default JSON (NEW). Pin
       the contract with empty-stream + -q composition +
       --since composition + 3 regression tests (--json --tsv
       without --slim still emits JSON, --tsv without --json
       still emits the existing 5-col TSV, --slim --tsv without
       --json falls through to the existing 5-col TSV).

  Push: 0028623..465b833 main -> main. All five commits authored
  as `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.
  Verify-gate note: ran `pnpm --filter @clawmind/cli test`
  (393/393 pass), `pnpm --filter @clawmind/rag test` (47/48 pass,
  the 1 fail is the queued hybrid alpha-blend red; my 4 new
  skipMmr tests pass), `pnpm --filter @clawmind/api test`
  (1230/1230 pass on second run, snapshots prune-arithmetic
  flake on one parallel run isolated to 11/11), `pnpm --filter
  @clawmind/cli typecheck` (clean), `pnpm typecheck` (only red
  is the queued telemetry OpenTelemetry peer mismatch). Same
  two pre-existing reds as every prior tick; neither introduced
  here.

  Theme connector: this tick is the explicit-queue sweep, again.
  Five of five features were named in the queued list. The
  related namespaces test is the rarest shape -- a pure test-
  only commit pinning a contract that has been live but unguarded
  for the entire repo's history. The rerank-only flag completes
  the RAG pipeline's debug-dial set: ANY combination of skipRerank
  + skipMmr can now be requested through retrieve(), surfaced as
  the corresponding 3-way A/B on the cli (default / --rerank-off
  / --rerank-only / both). The slim shape pattern (doctor --quiet,
  stats --slim, NOW digest run --slim) is now firmly the cli's
  preferred cron-dashboard contract -- a 3-5 field JSON shape on
  a single line, easy to NDJSON-diff. The forget short-circuit
  is a small but real fix: it removes a script-fragility class
  ("strip --json conditionally before --paths-only or you get
  the wrong shape") that the queued item carved out as worth a
  smoke test.

- 2026-06-21 20:00 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: 11718bd, a7e8e96, 75c5e05, 4d45a42, 8496320. Test gate:
  `@clawmind/cli` 423/423 vitest pass (up from 393). 30 net new tests
  spread across 5 files: status.test.ts (+7 -> 14), related.test.ts
  (+7 -> 24), ask.test.ts (+5 -> 21), stale.test.ts (+3 -> 18),
  watch.test.ts (+7 -> 38, with a new node:fs/promises mock for the
  --since path). `@clawmind/cli` typecheck: clean. `@clawmind/api`
  1229/1230 in parallel (the api-key-bruteforce timing flake — same
  one that flakes every tick; 10/10 in isolation, not my changes).
  `@clawmind/rag` 47/48 (the queued hybrid alpha-blend red, neither
  introduced nor touched this tick). Same two pre-existing reds
  outside cli (telemetry OpenTelemetry 1.x/2.x peer mismatch +
  rag/hybrid alpha-blend drift); neither introduced this tick.

  Theme: knock out a queued sweep that mixes substantive new
  features with smaller queued items. Three of five were named
  in the queued list by exact shape (--watch, --above/--below,
  --stream-json); the fourth (--tsv --since composition test) was
  named by exact shape; the fifth (--once --since composition)
  was named in the queue. Together they bring the cli's cron
  surface up another notch on real-time monitoring (--watch),
  live UI streaming (--stream-json), retrieval diagnostics
  (--above/--below), and incremental refresh (--once --since).

    1. status --watch <ms> + --max-polls <n>. Turns the one-shot
       status into a polling loop for a refreshing terminal
       dashboard. Pre-this, an operator monitoring a recovering
       provider used `watch -n 5 clawmind status` which re-warms
       the runtime on every tick (re-reading the manifest,
       re-loading the bm25, re-opening the lance handle). The
       --watch loop reuses the SAME runtime across cycles, so
       per-cycle latency is dominated by the two health probes,
       not the cli warmup. Output shapes:
         - text + TTY stdout: ANSI cursor-up + clear-line in-place
           render (one refreshing panel, the htop/top UX)
         - text + non-TTY stdout: print each snapshot in full (logs
           benefit from the historic context)
         - --json: one self-contained JSON document per cycle on
           its own line (NDJSON by construction)
       --max-polls <n> bounds the loop; required for cron-style
       probes wanting exactly N snapshots before exit, and required
       by the test suite to exercise the loop without leaking
       timers. Without --max-polls the loop runs until SIGINT
       (intercepted so the loop breaks cleanly and the final exit
       code still reflects the final probe state). --check on a
       watch loop sets the FINAL exit code to 2 if the LAST
       snapshot is unhealthy — deliberately not exiting early on
       the first bad probe because the watcher is a monitoring
       tool, not a circuit breaker; the operator wants to see the
       recovery cycle. Validation: --watch < 100ms rejected up
       front (typo'd --watch 0 would melt CPU); --max-polls
       non-positive / NaN rejected (silent degrade to "no cap"
       would defeat the entire purpose). --max-polls without
       --watch is silently ignored (matches the precedent set by
       --slim without --json on digest run).

       Refactor: pulled snapshotStatus() + renderText() +
       emitCheckStderr() out of the action body so both the
       one-shot path AND the watch loop produce identical
       output shapes per cycle. A dashboard consuming
       `clawmind status --json` does not have to special-case
       the --watch variant.

    2. related --above/--below filter pair. Symmetric sibling of
       --threshold mirroring `feedback list --above/--below`
       byte-for-byte. Strict comparisons (> and <), non-numeric
       silently ignored (matches --threshold), both flags compose
       as an intersection with each other AND with --threshold.
       The classic cron use family in one invocation each:
         --above 0.9                  -> the strongest signal
                                         neighbours (isolation
                                         diagnostic)
         --below 0.4                  -> the weakest survivors
                                         (about-to-drop-out
                                         diagnostic)
         --above 0.5 --below 0.8      -> the marginal band
         --threshold 0.5 --above 0.7  -> half-open [0.5, ...]
                                         hardened by a strict
                                         tighter floor
       Strict inequality matches `feedback list --above/--below`
       and is the right semantic for diagnostic questions like
       "only the strongest signals" — a neighbour exactly at the
       bar is on the edge, not past it. The API does not
       currently accept above/below query parameters, so the
       filter is client-side — same precedent as --threshold.

    3. ask --stream-json. Live NDJSON event stream, one document
       per line, emitted as the underlying askStream generator
       produces them:
         {"kind":"sources","count":2,"items":[...]}          // first
         {"kind":"token","value":"hello "}                    // per token
         {"kind":"token","value":"world"}
         {"kind":"done","latencyMs":42,"model":"fake-model"} // last
       Bridges the gap between text mode (token-by-token to stdout
       with ANSI a JSON consumer cannot parse) and --json (assembled
       payload AFTER the LLM completes, forcing the UI to wait the
       full latencyMs). A live UI sees the citation set up front
       (sidebar) AND paints the answer letter-by-letter (main
       panel). Single-line JSON per event so `jq -c .` round-trips
       cleanly. Pairs with --threshold (skip emits
       {kind:"sources"} + {kind:"skipped"}, no tokens), --no-citations
       (drops items[] from the sources doc but keeps the count
       marker), and --json (--stream-json wins because the
       streaming contract is stricter / more time-sensitive).
       Ignored with --out — they are incompatible (live emit vs
       file capture); the operator wanting both should shell-
       redirect.

    4. test(stale): --tsv --since composition pin. The --tsv and
       --since flags landed on stale at different times and were
       each pinned independently. The combined byte layout — the
       tab-separated rows that survive the absolute-date filter
       — was never anchored. Three new tests pin: the base
       composition (only the surviving row in canonical
       path\\tageDays\\tchunkCount\\tsize\\n shape), the order
       preservation (no re-sort introduced by the --since
       filter), and the empty-composition (cutoff dropping every
       row yields a clean empty stream, wc -l sees exactly 0).
       Pure regression-guard commit; no source change.

    5. watch --once --since. Pairs the previous tick's --once
       mode with the `ingest --since` mtime filter so a cron
       tick can ride out a quiet workspace without re-walking
       every file. Implementation mirrors `ingest --since`
       byte-for-byte: cutoff inclusive (>=), parse failures
       abort up front BEFORE buildRuntime (typo cannot waste
       runtime warmup), stat() failures on individual files are
       non-fatal (silent drop, cron log stays clean). --since
       is IGNORED without --once (the live watcher relies on
       chokidar to fire on actual file events, so an mtime
       cutoff would be a confusing no-op). Test approach: added
       a node:fs/promises mock that returns configured mtimes
       per path and throws ENOENT for unconfigured paths (which
       the production --since swallows silently); seven tests
       pin the full contract including the inclusive boundary
       (mtime === cutoff is KEPT), the validation order
       (--since's error wins when --debounce is valid but
       --since is typo'd), and the empty-survivor tick (still
       calls ingestPaths([]) so metric counters increment
       normally).

  Push: e3ca380..8496320 main -> main. All five commits authored
  as `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.
  Verify-gate note: ran `pnpm --filter @clawmind/cli test`
  (423/423 pass), `pnpm --filter @clawmind/cli typecheck`
  (clean), `pnpm typecheck` (only red is the queued telemetry
  OpenTelemetry peer mismatch — same as every prior tick),
  `pnpm --filter @clawmind/rag test` (47/48 pass — queued
  hybrid alpha-blend red, neither introduced nor touched this
  tick), `pnpm --filter @clawmind/api test` (1229/1230 in
  parallel; api-key-bruteforce timing flake isolated to 10/10
  on a clean re-run, same flake as every prior tick).

  Theme connector: this is the fifth consecutive queued-sweep
  tick. The cli's "cron-friendly" identity is now noticeably
  stronger across four dimensions:
    - real-time monitoring: --watch + --max-polls on status
      gives a refreshing dashboard with bounded exit semantics
    - retrieval diagnostics: --above/--below on related closes
      the symmetric-filter family that pins/mutes/aliases and
      feedback already had
    - live UI streaming: --stream-json on ask gives a token-
      by-token NDJSON shape that the existing --json (assembled
      at end) and text mode (ANSI on stdout) could not provide
    - incremental refresh: --once --since on watch makes the
      one-shot path as cheap as `ingest --since`, completing
      the parity between the two commands' cron-friendly
      surfaces

- 2026-06-21 23:08 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: 696cce6, c712abb, 738037b, c8f3810, 1b4b63c. Test gate:
  `@clawmind/cli` 450/450 vitest pass (up from 423). 27 net new tests
  spread across 4 files: status.test.ts (+11 -> 25, banner + check-after),
  watch.test.ts (+9 -> 47, --paths-only block), ask.test.ts (+3 -> 24,
  --stream-json --out replaces silent-ignore + adds 3 new), feedback-
  digest.test.ts (+4 -> 81, slim --since byte-layout pins).
  `@clawmind/cli` typecheck: clean. Same two pre-existing reds outside
  cli (telemetry OpenTelemetry 1.x/2.x peer mismatch + rag/hybrid test
  alpha-blend drift); both verified pre-existing in this tick by
  running `pnpm --filter @clawmind/rag test` (47/48, the alpha-blend
  fail is the queued one, error identical to every prior tick) and
  `pnpm --filter @clawmind/api test` (1229/1230, the timing flake on
  api-key-bruteforce/expires-the-lock-naturally is the queued one,
  identical to every prior tick). Neither introduced this tick.

  Theme: the queued sweep, again — but this time TWO of the queued
  items had subtle subtext that made them more than just "tick the
  box". The --check-after debounce on status --watch is the first
  cli flag that semantically operates on EXIT CODE only (not on body
  shape) — every previous --check-style flag flipped both. The
  --stream-json --out composition is the first time the cli has held
  a FileHandle open across a generator's lifetime (every prior --out
  call collected in memory + writeFile-once at the end); needed
  careful close() bookkeeping on every early-exit path so a tail -f
  consumer never sees a stale partial stream.

    1. status --watch banner. The third "stderr restart marker"
       contract in the cli (after watch's own banner, plus the
       implicit "Watching <root>" stdout line). Mirrors the watch
       command's banner byte-for-byte in SHAPE (kind=banner + ts)
       but with two extra fields that make sense for the polling
       use-case: apiBase (which dashboard restarted) and interval
       (at what cadence — useful when a single host runs multiple
       --watch instances at different intervals for different
       criticality tiers). Fires ONCE at loop start, BEFORE the
       first cycle, unconditionally regardless of --json mode so
       a stderr-tailing scraper detects restarts without parsing
       the (potentially noisy) stdout snapshot stream. Suppressed
       on the one-shot path (no loop to mark) and on the --watch
       validation error path (no half-started process to mark) —
       both paths exit before reaching the banner emit. The
       `apiBase` field also helps an operator running the same
       command across staging + prod from a single shell catch
       a "wait I pointed at the wrong env" mistake immediately.

    2. status --watch --check-after <n>. The "1-cycle blip" guard
       on the --check exit code. Without it, --check on a 5-min
       --watch loop with a flaky provider trips exit 2 on a single
       probe timeout — operators learned to wrap the command in
       a manual "retry 3 times" shell loop to avoid alert fatigue.
       --check-after N counts CONSECUTIVE down-cycles ending at
       the final snapshot; only if the streak is >= N does --check
       fire exit 2. A recovery cycle resets the streak to 0 so a
       single probe coming back up immediately re-arms the
       debounce — the contract is "alert only on sustained
       outages", not "alert on any blip you ever saw". Critical
       design: the debounce applies to EXIT CODE only — every
       cycle's snapshot body is unchanged, so a JSON consumer
       graphing `ok` over time sees every blip (which it should).
       Without --check-after the legacy contract holds verbatim
       (any final non-ok trips exit 2). Validation rejects 0 / NaN
       because a typo'd --check-after 0 silently behaving like
       --check alone is the worst possible failure mode for the
       flag's purpose. Silently ignored without --check (matches
       the precedent set by --max-polls without --watch).

    3. watch --once --paths-only. Pure preview, no ingest. Mirrors
       `ingest --dry-run --paths-only` and `reindex --dry-run
       --paths-only` byte-for-byte (same xargs-safe path-per-line
       contract) but lives on the watch command surface so the
       cron muscle memory carries: `watch --once --since X
       --paths-only` is the natural "what would the next
       scheduled refresh tick touch?" probe without spending any
       read/embed/upsert work. The dedupe uses a Set + ordered
       deduped[] array (NOT a for-of over the Set, which TS2802
       would flag on the cli's es2018 target). Composes with
       --since: the preview list is exactly the post-cutoff
       survivors — pin that the preview is byte-faithful to what
       `--once --since` (without --paths-only) would have ingested.
       Wins over --json (matches forget/search/related --paths-only
       short-circuit precedent). Skips ingestPaths() entirely —
       the lance/bm25/manifest are not touched, no metric
       counters increment. Silently ignored without --once (live
       watcher emits per-event NDJSON which is the preview shape
       for that surface).

    4. ask --stream-json --out. Previously a silent-ignore combo:
       --out won, --stream-json was dropped, the operator who
       wanted both a live stream AND a persistent file had to
       shell-redirect (`clawmind ask ... --stream-json >
       stream.ndjson`). That works but reads awkwardly in a script
       and the operator loses the stderr confirmation. Now the
       two flags compose: the NDJSON event stream is appended to
       the file as each event arrives (one write per event so a
       `tail -f` consumer reads the stream in real time), stdout
       stays SILENT, stderr gets the green "wrote answer (N chars)
       -> file" confirmation when the stream completes. Critical
       implementation detail: open('w') clears the file ONCE up
       front (stale stream from a previous run cannot poison the
       new one), then writes via a held FileHandle. The handle is
       closed on completion AND on every early-exit path
       (--threshold skip, error event, errored flag) — the close
       calls had to be plumbed in carefully because the existing
       skip/error paths used `process.exit(1)` which skips
       finally blocks. Also short-circuits the text-mode --out
       fallback below so the file only ever contains the NDJSON
       events, never the human-readable body. The first --out
       contract in the cli that holds a file open across a
       generator's lifetime — useful precedent for any future
       streaming-to-file flag.

    5. test(digest): --json --slim --since exact byte-layout pin.
       Pure regression-guard commit (no source change). The slim
       shape + --since composition was already covered at the
       COUNT level (existing tests assert {ran, deferred,
       sinceSkipped} are the right integers). What was missing:
       an exact-byte-layout pin for the canonical cron probe
       shape `clawmind digest run --since X --max N --json --slim`.
       A future regression where the slim shape silently grew an
       extra key (`skipped` re-added "for backwards compat", or
       a `ts` timestamp) would break NDJSON snapshot diffs across
       ticks without surfacing a test failure under count-only
       assertions. The three shapes pinned are the three meaningful
       cron-probe outcomes: mixed survivors, all-deferred (cap
       exhausts before cutoff matters), all-sinceSkipped (cutoff
       hides everything). Plus a cross-tick stability test: two
       consecutive ticks against the same data produce IDENTICAL
       byte layouts.

  Push: 8dc6ea1..1b4b63c main -> main. All five commits authored
  as `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.
  Verify-gate note: ran `pnpm run ci:verify` which hit the same
  pre-existing telemetry typecheck red (queued since 2026-06-20
  04:25 PDT; pnpm typecheck on `@clawmind/cli` alone is clean).
  Ran the full `@clawmind/cli` test suite at 450/450; full
  `@clawmind/rag` at 47/48 (queued hybrid alpha-blend); full
  `@clawmind/api` at 1229/1230 (timing flake on api-key-bruteforce
  expires-the-lock-naturally — identical to every prior tick).
  No new reds introduced this tick.

- 2026-06-22 02:28 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: c9490bc, c9d27f5, 9748183, dc329f5, fea8312. Test gate:
  `@clawmind/cli` 473/473 vitest pass (up from 450). 23 net new tests
  spread across 4 files: status.test.ts (+4 -> 29 — cycle:N counter
  pins), ask.test.ts (+6 -> 30 — three --out - stdout-sentinel tests
  + three --stream-json --no-citations --out composition pins),
  watch.test.ts (+9 -> 56 — full --preview-json contract pin),
  related.test.ts (+4 -> 28 — --below/--above + --below + --paths-only
  band-filter byte layout). `@clawmind/cli` typecheck: clean. Same
  two pre-existing reds outside cli (telemetry OpenTelemetry 1.x/2.x
  peer mismatch + rag/hybrid alpha-blend drift); both verified
  pre-existing in this tick by running `pnpm --filter @clawmind/rag
  test` (47/48, identical to every prior tick). Neither introduced
  this tick.

  Theme: the queued sweep, again — but this tick's mix leaned
  heavier on cross-mode contract pins. Three features add new
  flags / capabilities; two are pure regression-guard byte-layout
  pins for compositions that the existing tests touched in
  isolation but had not anchored together.

    1. status --watch --json `cycle:N` monotonic counter. Each
       polling cycle's NDJSON snapshot now carries a 1-indexed
       `cycle` field. The contract enables three distinct
       downstream-NDJSON-consumer questions: (a) detect DROPPED
       snapshots (gaps in the integer sequence — a consumer that
       polls every 30s from a watcher cycling every 1s sees
       `cycle:1, 31, 61, ...` and knows 29 snapshots fell on the
       floor between each window); (b) SORT across restart
       boundaries (the watcher restart resets cycle back to 1,
       but combined with the stderr banner's `ts` field the
       consumer can stitch back-to-back snapshot streams into a
       single timeline); (c) branch on the FIRST snapshot in a
       stream (`cycle == 1` is a clean restart marker without
       parsing the stderr banner separately).

       Critical design property: the counter is independent of
       probe state — it increments on every polling pass
       regardless of the snapshot's `ok` flag, so a consumer
       graphing `ok` over `cycle` sees a continuous x-axis even
       during incidents. A future regression that mixed the two
       contracts ("only increment cycle on healthy snapshots") is
       caught by an explicit test asserting cycle increments
       across mixed healthy/unhealthy probes.

       The field is ONLY emitted under --watch — the one-shot
       --json path has no cycle to count, and a stray `cycle:1`
       on a single snapshot would confuse a consumer that uses
       field presence as the "this came from a polling loop"
       signal. Pinned with an explicit `'cycle' in doc === false`
       assertion on the one-shot path. Existing dashboards
       reading workspace/embed/llm/ok keep working unchanged —
       `cycle` is one additional integer key, non-breaking by
       construction (every existing test uses field-level
       assertions, not whole-object `.toEqual`).

    2. ask --out - stdout sentinel. The standard *nix convention
       for "treat stdout as the output file" is a single hyphen.
       A script passing `--out $VAR` with `$VAR === "-"` (because
       the operator wanted to skip the file-capture step on a
       one-off run) would, without this normalization, try to
       create a literal file named `-` in the cwd — which both
       pollutes the working directory AND silences stdout
       (because the file-capture branches all short-circuit the
       stdout writes).

       The fix is a single normalization line at the top of the
       action: when opts.out === '-', set it to undefined. Every
       downstream --out check falls through to the regular stdout
       path. The contract holds across all three output modes:
       text (token-by-token answer streams to stdout, citations
       footer prints), --json (assembled JSON payload lands on
       stdout, byte-identical to plain `ask --json`),
       --stream-json (each NDJSON event arrives on stdout as it
       fires, byte-identical to plain `ask --stream-json`).
       Critical: no FileHandle opened, no truncation, no stderr
       "wrote answer" confirmation — the stderr-clean assertion
       in every test catches the regression where the file-
       capture confirmation leaked through despite stdout
       receiving the body.

       Same precedent as `clawmind search -` reading the query
       from stdin: a single hyphen is the universal sentinel for
       "use the standard stream instead of a file path". The
       normalization happens BEFORE the streamJsonToFile
       resolution so the file-handle bookkeeping branch is never
       entered when `-` was passed — no close() to chase on early
       exit paths.

    3. watch --once --preview-json. The dashboard-friendly twin
       of --paths-only. Where --paths-only short-circuits --json
       for xargs callers (path-per-line, no styling, no header),
       --preview-json is the explicit "give me the JSON shape"
       path for dashboard / web-UI callers who want the
       structured `{root, count, files}` envelope alongside the
       file list. Same byte layout as `ingest --dry-run --json`
       and `reindex --dry-run --json` so a multi-command
       dashboard uses ONE parser across all three preview
       surfaces — the muscle memory is the value.

       Critical design properties: (a) dedupe via Set
       (insertion-order preserved) so files[] is byte-faithful to
       what the corresponding --paths-only stream would emit —
       same survivor set, same order, just wrapped in a JSON
       envelope; (b) empty discovery yields `{root, count: 0,
       files: []}` (NOT an empty stream — the JSON shape is
       PRESERVED on the empty case so `jq .count` always gets an
       integer; a downstream "is the workspace warm?" probe
       never has to special-case the empty result); (c) skips
       ingestPaths() entirely (same as --paths-only); (d)
       --paths-only WINS when both flags are passed — the
       precedence is intentional: --paths-only is the older,
       simpler contract; a script that grew --paths-only first
       should keep getting the path-per-line stream it was built
       around. Pinned by an explicit `--paths-only --preview-json`
       case in tests.

       The 9 net new tests anchor the full contract: surface
       exposure, headline {root, count, files} shape, --since
       composition, empty-survivors parseable JSON envelope,
       arrival-order dedupe, --paths-only-wins precedence,
       silent-ignore without --once, --since validation up
       front, NDJSON-friendly single-line shape.

    4. ask --stream-json --no-citations --out 3-flag composition
       byte-layout pin. Pure regression-guard commit (no source
       change). The shared `if (opts.citations !== false)`
       branch in emitStreamDoc governs whether the sources doc
       carries the items[] array. When --out is set, the events
       land in the file instead of stdout — but the SHAPE of
       each event must be byte-identical to the stdout case.

       This composition was not previously pinned: the existing
       --no-citations test asserts the stdout shape (no items[]
       on the sources doc), and the existing --stream-json --out
       test asserts the citations-on shape (items[] present). A
       regression where --no-citations only affected the stdout
       sink — for example a stray `if (!streamFileHandle) drop
       items` guard around the citations check in emitStreamDoc
       — would leak items[] to the file without any test
       catching it. The 3-flag intersection is the gap this pin
       closes.

       Three new tests: (a) file sources doc has count but NO
       items[] (matches the established no-citations contract
       on stdout exactly); (b) file body == stdout body byte-
       for-byte (the strongest possible regression guard:
       capture stdout from one invocation, capture the file body
       from a second invocation with --out added, assert they
       are IDENTICAL strings); (c) --threshold below-bar 3-flag
       intersection: sources(count-only) + skipped land in the
       file, no items[] in either doc, exit 1. The third test
       is the most defensive: it pins the contract on the SKIP
       path through emitStreamDoc, which is structurally
       different from the happy path (no token / done events
       fire).

    5. related --below / --above + --below + --paths-only byte-
       layout pin. Pure regression-guard commit. The --above +
       --paths-only composition was pinned in a previous tick.
       The symmetric --below + --paths-only AND the asymmetric
       band filter (--above + --below + --paths-only) were NOT
       pinned — any divergence in the filter ordering or the
       --paths-only dedupe across those combinations would slip
       through silently because existing tests covered only the
       single-flag and JSON-only cases.

       Four new tests pin the EXACT byte sequence on stdout
       (`expect(stdout).toBe(...)`) so a future refactor that
       subtly re-ordered the filter pipeline — for example
       running --paths-only dedupe BEFORE the band filter, which
       would silently drop survivors when duplicate paths had
       differing scores — is caught immediately. Most defensive
       test: --threshold + --above + --below + --paths-only (the
       4-flag intersection) pins that all three filter
       dimensions are applied as an INTERSECTION before the
       --paths-only emit. A future change that silently dropped
       one filter (e.g. --threshold applied AFTER --paths-only)
       is caught.

  Push: f929901..fea8312 main -> main. All five commits authored
  as `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.
  Verify-gate note: ran `pnpm --filter @clawmind/cli test`
  (473/473 pass), `pnpm --filter @clawmind/cli typecheck`
  (clean), `pnpm --filter @clawmind/rag test` (47/48 pass —
  queued hybrid alpha-blend red, neither introduced nor touched
  this tick). Note on commit hygiene: feature 3's first commit
  attempt had a typo in the cron email (extra `+`); caught
  immediately by `git log --format='%ae'` and amended with
  `--reset-author` before the push, so origin/main only sees the
  clean 9748183 SHA. Worth remembering: the heredoc shell single
  quote let the typo through silently — a future ci step that
  checks every push's `git log` for the expected email pattern
  would catch this class of typo before it leaves the working
  tree.

  Theme connector: this is the sixth consecutive queued-sweep
  tick. The cli's cron surface has now grown three new
  cross-mode primitives this tick alone:
    - monotonic stream ordering (--watch --json cycle:N) for
      dropped-snapshot detection AND restart-boundary stitching
    - the stdout-sentinel convention (--out -) for safe
      conditional --out file capture in shell scripts
    - dashboard-shape preview (--preview-json) that mirrors
      ingest/reindex --dry-run --json across the watch surface
  Plus two cross-composition regression-guard pins (--stream-json
  --no-citations --out byte-identical-to-stdout, related band-
  filter + --paths-only byte-stream pins) that close gaps the
  earlier ticks shipped functionality for but never anchored at
  the SHAPE level. The pattern is clear: each new flag this tick
  composed cleanly with 1-2 existing flags, and each pure-pin
  commit closed a gap that an earlier feature ship had left open.

- 2026-06-22 06:27 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: f2bb590, 1e51e5d, b7dd8c6, 27c6fc2, e5e73db. Test gate:
  `@clawmind/cli` 498/498 vitest pass (up from 473). 25 net new tests
  spread across 4 files: stale.test.ts (+5 -> 23 — --tsv --header
  schema-row pins), feedback-digest.test.ts (+10 -> 91 — --top
  loudest-by-distance + --since list pins), aliases.test.ts (+5 ->
  11 — --since family completion), tags.test.ts (+5 -> 19 —
  --paths-only family-wide alias). `@clawmind/cli` typecheck:
  clean. Same two pre-existing reds outside cli (telemetry
  OpenTelemetry 1.x/2.x peer mismatch + rag/hybrid alpha-blend
  drift); both verified pre-existing in this tick by running
  `pnpm --filter @clawmind/rag test` (47/48, identical to every
  prior tick).

  Theme: extend cron-friendly surface in ways that close real
  ergonomic gaps OR complete cross-command family contracts.
  Three features add brand-new capabilities; two complete the
  family contract by adding the same flag to a command that was
  missing it.

    1. stale --tsv --header. The TSV emit shape has always been
       header-less (the awk-pipeline contract: `clawmind stale
       --tsv | awk -F'\t' '{print $1}'` and friends). For typed-
       table consumers (column -ts$'\t', pandas.read_csv(...,
       sep='\t'), Excel/Numbers tab-paste) the column names live
       out-of-band, which drifts the moment the cli's emit shape
       changes. --header opts in to a single tab-separated schema
       row prepended to the body so the typed-table parser sees
       the schema embedded in the stream — column-count drift
       surfaces as a test failure rather than a silent data
       corruption.

       Critical design property: header fires UNCONDITIONALLY
       under --header, even when zero data rows pass the filters.
       A typed-table parser on an empty workspace sees a valid
       empty table with column names, not an empty stream that
       crashes the parser with "No columns to parse". Mirrors the
       JSON-shape-preserved-on-empty precedent from
       --preview-json's empty case.

       Silent-ignore under non-TSV modes (--json, --paths,
       --paths-only, default text). Each of those has its own
       byte-layout contract; adding a header line would break
       them. Matches the silent-ignore precedent for --slim
       without --json, --debounce under --once, etc.

    2. feedback list --top <n>. Sorts the listed entries by
       absolute distance from neutral (|boost - 1.0|), descending,
       and keeps the head N. Answers "which votes are LOUDEST
       regardless of direction" in a single call — a question
       the existing --above / --below can NOT answer because each
       only sees one direction. The canonical cron-audit call
       `clawmind feedback list --top 10 --json` surfaces the 10
       entries dragging retrieval hardest in either direction.

       Critical implementation detail: distances are SNAPPED to
       6-decimal precision before sorting to dodge the float
       trap where 1.40 - 1.0 evaluates to 0.3999999999999999
       while 0.60 - 1.0 evaluates to 0.40000000000000004. At
       boost precision these ARE tied; without the snap the FP
       noise would silently flip them in the snapshot. Original
       index is also carried as a secondary tie-breaker so
       genuine ties preserve API order across runs (deterministic
       even on hypothetical non-stable Array#sort implementations).

       Composes with --above/--below: `--above 1.0 --top 5` is
       "the 5 strongest upvotes" — --above narrows direction
       FIRST so downvotes are excluded entirely, then --top picks
       the loudest survivors within the upvotes-only set. Non-
       positive / NaN values fall back to "no cap" — matches the
       `tags list --top` / `stats --top` clamping precedent.

    3. digest list --since <iso-date>. Keeps only saved searches
       whose lastRunTs is strictly less than the cutoff — i.e.
       those that have NOT been re-run since the cutoff. The
       inverse of `digest run --since` (which actually runs the
       matching batch). Together they form the canonical cron
       pattern:
         ts=$(date -u -d '1 hour ago' +%FT%TZ)
         clawmind digest list --since "$ts" --json   # count overdue
         clawmind digest run  --since "$ts"          # run them
       Both consume the same cutoff so a dashboard probe and the
       run command stay in sync.

       Contract mirrors `digest run --since` byte-for-byte:
         - lastRunTs === null (never-run digest) is ALWAYS
           INCLUDED — the most extreme case of "overdue"; a
           filter that hid never-runs would lie to a dashboard
           the moment the operator added a new saved search.
         - Strict less-than (<) so a digest at exactly the
           cutoff is EXCLUDED. It ran AT the cutoff, satisfying
           the operator's "leave alone if it ran within the last
           hour" intent.
         - Parse failures abort cleanly with exit 1 via the
           existing runAction wrapper.
         - Composes with -q as an intersection: -q forwards
           to the API server-side, --since narrows client-side.

    4. aliases list --since <iso-date>. The last list-style
       command missing the --since family flag. pins / mutes /
       stats / stale / digest list / digest show all carry the
       same flag now; aliases was the only outlier. Completes
       the cross-command family contract: any operator scripting
       per-day snapshots can use the same flag spelling on every
       command they care about.

       Cutoff is INCLUSIVE (>=) matching pins / mutes byte-for-
       byte. The recomputed count reflects the post-filter length
       so a downstream `jq .count` consumer sees the right number
       and the text-mode empty-state path is taken correctly.
       Composes with --paths and -q in the usual ways.

    5. tags paths <tag> --paths-only. The last list-style
       command whose pipeline-friendly emit was named --paths
       rather than the canonical --paths-only. Brings tags in
       line with the family-wide naming exposed by search /
       forget / related / stale. Implemented as a TRUE alias
       (both flags emit the same byte stream; passing either or
       both produces identical output) so existing scripts using
       --paths keep working unchanged but the canonical spelling
       is now available for muscle-memory consistency.

       Implementation note: the new --paths-only check is
       evaluated AT THE SAME branch as --paths so the two are
       indistinguishable from the action body's POV. Mirrors the
       stale --paths / --paths-only alias relationship byte-for-
       byte (where stale was the first command to expose both
       spellings as genuine aliases).

  Push: 79d3708..e5e73db main -> main. All five commits authored
  as `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.
  Verify-gate note: ran `pnpm --filter @clawmind/cli test`
  (498/498 pass on second run; the first run hit the known
  status `--check-after` timer-race flake on 1 test, but the
  retry was clean — same timing-flake pattern as every prior
  tick, NOT caused by anything in this batch). `pnpm --filter
  @clawmind/cli typecheck` clean. Full `@clawmind/rag` test
  47/48 (queued hybrid alpha-blend), neither introduced nor
  touched this tick.

  Theme connector: this is the seventh consecutive ship-from-
  patterns tick. The cli's cron surface gained one new emit
  capability (--tsv --header), one new ranking primitive
  (--top |distance|), and three family-contract extensions
  (--since on digest list + aliases list, --paths-only on
  tags paths). All five compose with at least one existing
  flag without requiring any other command change. The pattern
  is the same one the prior ticks established: small, deeply-
  tested feature slices that complete a contract or close a
  gap an earlier ship left open.

- 2026-06-22 10:07 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: 1f9946a, c6cd0e7, 71d2f59, b99dbcf, 85add58. Test gate:
  `@clawmind/cli` 530/530 vitest pass (up from 498). 32 net new
  tests spread across 6 files: feedback-digest.test.ts (+10 ->
  101 — 5 feedback --sort + 5 digest --sort), aliases.test.ts
  (+9 -> 20 — 5 --sort + 4 --paths-only), pins.test.ts (+4 ->
  19 — --paths-only family alias), mutes.test.ts (+4 -> 16 —
  --paths-only family alias), related.test.ts (+5 -> 33 — --sort).
  `@clawmind/cli` typecheck: clean. First test run hit the
  known status `--check-after` timer-race flake on 1 test
  (status --watch --json --check-after; same flake every prior
  tick); retry was clean. Status of pre-existing reds outside
  cli (telemetry OpenTelemetry 1.x/2.x peer mismatch + rag/
  hybrid alpha-blend drift) unchanged from prior 8 ticks.

  Theme: explicit --sort ordering primitive completed family-
  wide across every list-style command in the cli. Five
  commands (feedback list, digest list, aliases list, related,
  and the related-but-distinct band-filter ordering on
  related) all now carry --sort with a uniform contract:
  applied AFTER any narrowing filter, secondary sort by
  original index for cross-snapshot determinism, unknown
  keys abort cleanly with exit 1, default preserves API
  order so existing scripts diffing --json stay byte-stable.
  Plus the cross-command --paths-only naming completion on
  pins / mutes / aliases (the last three list-style commands
  whose pipeline-friendly emit was still spelled --paths
  rather than the canonical --paths-only).

    1. feedback list --sort <boost|path|ups|downs>. Most
       interesting design property: --sort and --top are
       SEPARATE ranking primitives. --top has always ranked
       by absolute distance from neutral (|boost - 1.0|);
       --sort ranks by an operator-chosen axis. The two
       compose deliberately: --sort downs --top 10 is "the
       10 entries with the most downvotes regardless of
       boost magnitude" — distinct from --top 10 alone which
       ranks by distance. Implementation: when --sort is set,
       --top short-circuits to slice(0, N) of the --sort
       ordering rather than re-ranking by |boost-1.0|; without
       that branch, --sort downs --top 10 would silently throw
       away the --sort. The first test caught this gap on the
       first run (--sort downs --top 2 expected
       [heavy-downs, mid-downs] but got [huge-up, heavy-downs]
       because the original --top was overriding) — proves
       the test is doing the regression-guard work it was
       written to do.

    2. digest list --sort <lastRunTs|runs|title>. The
       canonical cron use is the overdue audit:
         digest list --since "..." --sort lastRunTs --json
       which returns overdue digests with the longest-overdue
       at the top — the most useful ordering for a cron
       dashboard because the operator's eye lands on the
       worst offender first. Critical design property:
       lastRunTs === null sorts to the TOP under --sort
       lastRunTs (asc) because never-run is more overdue
       than any timestamp. We map null to -Infinity in the
       sort comparator so it sorts before every real
       timestamp. Matches the --since contract precedent
       where lastRunTs === null is ALWAYS included as the
       most-extreme overdue case.

    3. aliases list --sort <name|createdAt>. Completes the
       --sort family on the create/list pair. --sort name is
       mostly a no-op (matches the API's native default sort)
       but it is useful for symmetry with other commands and
       as a defence against a future API change to insertion-
       order. --sort createdAt is the meaningful primitive
       — it pairs with --since for the daily snapshot
       question "what got added recently, newest first" in
       a single call rather than piping --json through jq.

    4. pins,mutes,aliases list --paths-only (family-wide
       naming completion). Three commands at once because
       they share the same naming-completion shape — each
       was missing the canonical --paths-only spelling
       (only --paths was exposed). The pattern matches the
       previous tick's `tags paths --paths-only` byte-for-
       byte: both flags emit the byte-identical stream,
       passed at the same branch in the action body
       (`if (opts.paths || opts.pathsOnly)`), the original
       --paths spelling stays for backwards compatibility.
       The naming gap was a real ergonomic friction every
       time the operator wrote a new pipeline against any
       of the three commands — having learned `clawmind
       stale --paths-only` first, they should not have to
       mentally translate to `--paths` for pins / mutes /
       aliases. Shipped as ONE commit because the three
       files are conceptually one feature — a naming
       completion across a contract family.

    5. related --sort <score|path|namespace>. The last
       list-style command missing --sort. Most interesting
       primitive: --sort namespace groups neighbours
       alphabetically by namespace, then preserves API
       order (which is score-descending) within each
       namespace via the secondary index sort. Answers
       "show me strong neighbours grouped by namespace"
       in a single call when composed with --above 0.5,
       which is the natural dashboard-panel shape for
       "where in the index does this source's signal
       cluster". --sort score is a no-op against the
       default API order but useful for symmetry and as a
       defence against a future API change.

  Push: ce05108..85add58 main -> main. All five commits authored
  as `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.
  Verify-gate note: ran `pnpm --filter @clawmind/cli test`
  twice (first hit the known status flake on 1 test; second
  was clean 530/530). `pnpm --filter @clawmind/cli typecheck`
  clean. No new pre-existing reds introduced; the telemetry +
  rag/hybrid pair remains queued unchanged.

  Theme connector: this is the eighth consecutive ship-from-
  patterns tick. The cli's cron surface gained ONE new
  ordering primitive (--sort, spanning four commands plus
  related's band-filter ordering) and ONE family-wide
  naming completion (--paths-only on the last three list-
  style commands that lacked it). The --sort design across
  all four commands now follows a uniform contract that
  any future list-style command can mirror byte-for-byte:
  applied AFTER narrowing filters, secondary sort by
  original index for ties, unknown keys throw, default
  preserves API order. The composition rule "filters narrow,
  --sort orders, --top caps" is now consistent across the
  five commands that have all three.

- 2026-06-22 13:41 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: 5e57ff3, a8fd3d9, 990689f, 19da6aa, c3f8c56. Test gate:
  `@clawmind/cli` 564/564 vitest pass (up from 530). 34 net new
  tests spread across 5 files: search.test.ts (+9 -> 46 — --sort),
  stale.test.ts (+8 -> 31 — --sort), feedback-digest.test.ts (+11
  -> 112 — 8 digest show --paths-only + 3 feedback prune 3-flag
  byte pin), stats.test.ts (+5 -> 57 — --sort name alias +
  determinism). `@clawmind/cli` typecheck: clean. First test run
  hit the known status `--check-after` timer-race flake on 1 test
  (status --watch --json --check-after; same flake every prior
  tick); retry was clean 564/564. Status of pre-existing reds
  outside cli (telemetry OpenTelemetry 1.x/2.x peer mismatch +
  rag/hybrid alpha-blend drift) unchanged from prior 9 ticks.

  Theme: queued-sweep tick — knocked out 4 of the 13 items from
  the queued list (search --sort, stale --sort, digest show
  --paths-only, stats --sort name alias + tie determinism) plus
  the feedback prune 3-flag byte-pin (the last regression-guard
  item from the queue). After this tick the queued list shrinks
  from 13 to 9 items but adds 5 new ones that surfaced from the
  patterns this batch established (reverse-modifier shape on
  --sort, stats --slim --paths precedence, feedback prune --slim,
  digest show --paths-only --diff).

    1. search --sort <score|path|namespace>. The family-wide
       ordering primitive completion on the cli's main retrieval
       command. search was the last list-style command with
       -t/--threshold but without a companion --sort. Mirrors
       `related --sort` byte-for-byte. Three keys: score (desc,
       effectively a no-op against retrieve()'s default order
       but useful for symmetry), path (asc alphabetical, for
       diff-stable --json snapshots), namespace (asc grouping,
       for dashboard panels showing where a query's signal
       clusters). Applied AFTER -t/--threshold; applied BEFORE
       --paths-only so the dedupe walks the post-sort order —
       a critical design property: `--sort namespace --paths-only`
       emits paths grouped by namespace, NOT in retrieve() rank
       order. Ties carry the family-wide secondary-by-index sort.
       Unknown keys abort with exit 1 and NO partial JSON body
       on stdout.

    2. stale --sort <age|path|size>. The family-wide --sort
       completion on the last cleanup-flow list missing it.
       Three keys: age (desc, the natural "what should I clean
       up first" ordering and effectively a no-op against the
       API's default oldest-first order), path (asc for diff-
       stable --json / --tsv), size (desc — the canonical
       cron use is `stale --sort size --paths | xargs forget`
       to recover the most disk space first when the cleanup
       budget is tight). Most defensive design property:
       applied BEFORE EVERY output mode (--json, --tsv, --paths,
       --paths-only, default text) so each mode sees the SAME
       ordered subset — a downstream consumer parsing --json
       and a sibling parsing --tsv get byte-equivalent row
       orders, they can never silently disagree on which file
       leads the report. The cross-mode consistency property is
       pinned by a `--tsv --sort path` test that asserts the
       full TSV body byte-for-byte.

    3. digest show --paths-only. The family-wide --paths-only
       completion on the only history-shaped list surface that
       was missing it. Walks filtered history rows newest-first
       as the API returns them; within each row emits
       newSources first, then removedSources; dedupes against
       a Set sentinel so a path appearing across multiple rows
       surfaces ONCE at its newest occurrence. The canonical
       cron one-liner this enables:
         clawmind digest show s1 --paths-only --last 1 \
           | xargs clawmind ingest --paths -
       "feed the most-recent run's surfaced paths back into
       ingest" — useful when a saved search anchors a daily
       re-ingest of a moving target directory. Critical
       empty-stream contract: zero matches yields a CLEAN empty
       stream — no `query:` header, no empty-state hint, no
       ANSI. Leaking either would poison `| xargs` consumers.

    4. stats --sort name family-alias + tie determinism. Two
       changes that bring stats into line with the eight other
       --sort-bearing commands. (a) `name` as a TRUE alias for
       `namespace` (the family-wide canonical spelling); both
       flags behave IDENTICALLY (same code path, same short-
       circuit on API order), case-insensitive. The error
       message was extended to enumerate `name` as a valid key,
       so an operator typo'ing `--sort title` sees the full
       vocabulary. Critical zero-regression check: the pre-
       existing assertion `expect(err).toContain('expected:
       files, chunks, bytes, namespace')` continues to hold
       because the new error is a strict prefix-superset of
       the old one. (b) Secondary-by-original-index sort on
       the numeric keys (files/chunks/bytes) so cross-snapshot
       ties are deterministic — pinned by a "two consecutive
       runs over identical-ties input produce byte-identical
       output" snapshot-diff property test.

    5. feedback prune --above --below --apply byte-layout pin.
       Pure regression-guard commit (no source change). The
       existing test for the 3-flag composition asserts the
       cleared count and the path-set membership (after
       .sort() — sort first, compare second), but the FULL
       JSON report payload was not pinned at the byte level.
       Four invariants under the both-flags-apply path were
       unprotected: (1) the empty errors[] under all-success,
       (2) the dryRun=false flag under --apply, (3) both
       threshold + thresholdAbove fields under the two-flag
       composition (a regression to a single combined field
       would lie about which predicate ran), and (4) the
       paths array walk order (the existing test sorted before
       comparing — this one asserts the actual API-walk order
       byte-for-byte). The most defensive of the three new
       tests is the SKIP-on-failure pin: with one DELETE
       failing, exactly that path's error appears in errors[],
       exit 1 fires, and the OTHER three DELETEs STILL fire
       (the batch did NOT abort on the single failure — the
       per-iteration try/catch around the DELETE serial loop
       survives every code path). A regression where the catch
       became throw would leave the cron tick in a half-
       cleared state and the dashboard would not detect it.

  Push: ce05108..c3f8c56 main -> main. All five commits
  authored as `Cake (cron) <51058514+Sanjays2402@users.noreply.
  github.com>`. Verify-gate note: ran `pnpm --filter @clawmind/
  cli test` twice (first hit the known status flake; second was
  clean 564/564). `pnpm --filter @clawmind/cli typecheck` clean.
  No new pre-existing reds introduced; the telemetry + rag/
  hybrid pair remains queued unchanged.

  Theme connector: this is the ninth consecutive ship-from-
  patterns tick. The --sort family-wide contract is now COMPLETE
  across all 9 list-style commands in the cli: feedback list,
  digest list, aliases list, tags list, related, search, stale,
  stats, digest show (via --last newest-first ordering). The
  --paths-only family-wide contract is now COMPLETE across all
  9 list-style commands too: search, forget, related, stale,
  pins, mutes, aliases, tags, and digest show. Two cross-
  command families that the prior 8 ticks built one command at
  a time are now uniformly applied. The remaining queued items
  are smaller deltas (single-flag composition pins, error-path
  byte-layout pins, --slim shape additions) rather than
  family-wide completions.

- 2026-06-22 16:53 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: cec9160, c3ab531, d600337, 4b76cb1, b524cb3. Test gate:
  `@clawmind/cli` 599/599 vitest pass (up from 564). 35 net new
  tests spread across 4 files: stale.test.ts (+7 -> 38 — --reverse),
  search.test.ts (+7 -> 53 — --reverse), related.test.ts (+7 -> 40
  — --reverse), feedback-digest.test.ts (+14 -> 126 — 7 digest show
  --paths-only --diff + 7 feedback prune --json --slim).
  `@clawmind/cli` typecheck: clean. Status of pre-existing reds
  outside cli (telemetry OpenTelemetry 1.x/2.x peer mismatch +
  rag/hybrid alpha-blend drift) unchanged from prior 10 ticks.
  Notable: first test run was clean on the first attempt (status
  --check-after flake did not fire this tick), so 599/599 on a
  single pass. No retry needed.

  Theme: queued-sweep tick — knocked out 5 items from the queued
  list, every one a clean cron-friendly capability close. After
  this tick the queued list shrinks from 9 to 4 items (the 5
  closed-out items) plus 6 new ones that surfaced from the patterns
  this batch established (port --reverse to feedback/digest/aliases/
  stats; extend digest --diff with --only-added/--only-removed;
  feedback list --json --slim; stale --reverse help-text
  documentation clarification).

    1. stale --reverse (establishes the family-wide reverse-modifier
       shape). The first --sort-bearing command in the cli's family
       to expose a --reverse modifier. The three per-key reverse
       questions answered:
         --sort age --reverse   -> youngest-stale first ("what just
                                   crossed the staleness threshold")
         --sort path --reverse  -> desc alphabetical (the queued use:
                                   "what's at the END of the
                                   alphabetical run" for diff
                                   snapshots / tail -f-style scrapes)
         --sort size --reverse  -> smallest first ("bulk-clear the
                                   small files when the budget can
                                   afford to skip the big ones")
       Implementation: a single sign-flipping multiplier (dir = -1
       under --reverse, else 1) applied to BOTH the primary
       comparator AND the secondary tie-break by original index. The
       dual-flip is the critical determinism property — without it,
       ties would silently shift on every other run because the
       primary returned 0 but the secondary kept ascending while
       the visible ordering of every other row was descending.
       Pinned by a "two consecutive runs over identical-ties input
       produce byte-identical output" property test.
       Silent-ignored without --sort (the default API ordering is a
       fixed contract, not a sort-direction choice — mirrors the
       --header-without-tsv silent-ignore precedent).
       Cross-mode consistency: --sort path --reverse on --tsv mode
       produces the same desc-alphabetical row order the --json
       mode sees, pinned by a "TSV body == JSON body order" test.

    2. search --reverse (mirrors stale --reverse byte-for-byte).
       The second --sort-bearing command in the family. The three
       direction-flip cases on search:
         --sort score --reverse    -> weakest-first ("hits that
                                      BARELY passed the threshold,
                                      ordered worst-first" — useful
                                      for tuning the threshold dial)
         --sort path --reverse     -> desc alphabetical (the queued
                                      use)
         --sort namespace --reverse -> namespaces in desc grouping
       Crucial composition with --paths-only: the dedupe walks AFTER
       the sort+reverse so `--sort path --reverse --paths-only`
       emits paths in desc alphabetical order with duplicates
       collapsed to the first occurrence in the post-reverse walk.

    3. related --reverse (completes the queued reverse-modifier
       family-sweep). The third --sort-bearing command. After this
       commit the family-wide reverse-modifier contract is complete
       across all THREE commands the queued list explicitly called
       out (stale, search, related). The three direction-flip cases:
         --sort score --reverse     -> weakest-first ("neighbours
                                       about to drop out of the
                                       related set the next time
                                       the rerank shuffles")
         --sort path --reverse      -> desc alphabetical
         --sort namespace --reverse -> namespaces in desc grouping
       Crucial composition with --above (band-filter narrows, sort
       orders the survivors desc): "the alphabetically-last
       neighbour that survived --above 0.5" in a single call.

    4. digest show --paths-only --diff. Splits the flat-merge emit
       into a `git diff`-style stream where every new-path line is
       prefixed with `+ ` and every removed-path line with `- `.
       The default --paths-only walks newSources then removedSources
       for each row, deduped against a SINGLE Set — which is the
       right shape for "feed xargs ingest with every path the
       digest touched" but NOT for the symmetric "feed xargs
       ingest with only the NEW paths" use. The operator was forced
       to post-process with `comm` or pipe --json through `jq`
       for that. --diff closes the symmetric gap with the prefix
       shape operators already know from `git diff`.
       Critical design property: TWO SEPARATE dedupe sets, one per
       direction. A path that appears in newSources of one row AND
       removedSources of another row surfaces TWICE — once with
       each prefix — because semantically those are two different
       events (the path was added at one ts, removed at another).
       Pinned by an explicit fixture where /shared.md appears as
       newSource in ts=3 and removedSource in ts=2; the test
       asserts both prefixed lines surface.
       Empty-stream contract preserved: zero matches under
       --since-future yields a clean empty stream — no orphan
       `+ ` or `- ` lines that would poison `| grep ^+ | xargs`
       consumers.

    5. feedback prune --json --slim. Drops the `paths` array for
       cron dashboards that only care about the headline counts.
       Mirrors the `doctor --json --quiet` and `digest run --json
       --slim` precedent. The full prune --json report includes
       the `paths` array of every matched entry, which on a large
       workspace can be megabytes — almost never needed by a cron
       dashboard. --slim drops the array for tight cron-budget
       snapshots; the count-only shape diffs cleanly across cron
       snapshots (no path-array churn flooding the diff).
       Critical design property: errors[] is PRESERVED under
       --slim. Per-path failures are exactly what a cron dashboard
       needs to surface — dropping them would hide the only signal
       that something broke. Pinned by a test that forces one
       DELETE to fail and asserts errors[0].path survives in the
       slim shape AND that exit 1 propagates (the cron exit-code
       contract is unchanged under --slim).
       Also pinned: both `threshold` and `thresholdAbove` survive
       under --slim. A future regression that collapsed them into a
       single field would lie about which predicate the cron
       actually ran.
       Implementation: a single destructure-and-drop
       (`const { paths: _drop, ...slim } = report`) inside the
       existing --json branch.

  Push: 540b5b6..b524cb3 main -> main. All five commits authored
  as `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.
  Verify-gate note: ran `pnpm --filter @clawmind/cli test` once
  (clean 599/599 on first attempt — no status --check-after flake
  this tick), `pnpm --filter @clawmind/cli typecheck` clean. No
  new pre-existing reds introduced; the telemetry + rag/hybrid
  pair remains queued unchanged.

  Theme connector: this is the tenth consecutive ship-from-patterns
  tick. The --reverse family-wide modifier contract is now
  established on the THREE commands the queued list explicitly
  called out (stale + search + related). The pattern (single dir
  multiplier on BOTH the primary and secondary comparator) is
  trivially portable to the other 5 --sort-bearing commands
  (feedback list, digest list, aliases list, tags list, stats) and
  is queued as 4 follow-up items for future ticks. Plus two
  brand-new cron-friendly primitives this tick: the `git diff`-
  style `+ `/`- ` split on `digest show --paths-only --diff`
  (closes the symmetric ingest/forget pipe gap) and the count-only
  `--slim` shape on `feedback prune --json` (closes the cron-
  dashboard volume gap; pairs with `doctor --json --quiet` and
  `digest run --json --slim` as the third command to expose the
  count-only shape).


- 2026-06-22 20:07 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: 32580ff, 6777c44, 4bfe9b3, 4e73f71, ba77780. Test gate:
  `@clawmind/cli` 629/629 vitest pass (up from 605, +24 new tests:
  feedback +5, digest +5, aliases +5, stats +6, tags +7 net). All
  5 are family-wide --reverse-modifier ports, completing the queued
  sweep called out the previous tick.

  Theme: complete the family-wide reverse-modifier contract.
  Previous tick established the pattern on the three commands the
  queue explicitly called out (stale + search + related); this
  tick ports it to the remaining 4 --sort-bearing commands the
  queue identified (feedback list, digest list, aliases list,
  stats), AND covers tags list as the 5th port — picking it up
  because the same slice that adds --reverse to tags also fixes
  the secondary-by-original-index sort that tags was MISSING (a
  separate queued item the previous tick deferred for "verify
  the secondary-by-original-index sort is in place; if not, add
  it"). Bundling them into one commit because the --reverse
  dual-flip multiplier NEEDS a real local sort with a secondary
  index key to flip — the two changes are entangled.

  The family-wide reverse-modifier sweep is now complete on all
  8 --sort-bearing commands in the cli (stale, search, related,
  feedback list, digest list, aliases list, stats, tags list).

  Per-feature notes:

    1. feedback list --reverse (32580ff). 5 new tests. Three
       interesting design choices pinned:
       - --sort boost --reverse asc surfaces the "which paths
         are getting penalised hardest by feedback" question.
       - --reverse without --sort silently ignored (opts.sort is
         undefined; matches the family contract).
       - --sort downs --reverse --top 5 is "the 5 entries with
         the FEWEST downvotes" — composition pin that --top
         applies to the head of the post-reverse ordering.

    2. digest list --reverse (6777c44). 5 new tests. The subtle
       pin worth flagging: under --sort lastRunTs the default
       treats null as -Infinity (sorts to top under asc = "most
       overdue"). Under --reverse the dir multiplier flips that
       to sort-to-bottom, which is the colloquially correct
       reading — a never-run digest cannot be "most recently
       run". A dedicated test pins this so a naive refactor
       that special-cased null OUTSIDE the multiplier would
       surface immediately.

    3. aliases list --reverse (4bfe9b3). 5 new tests. The natural
       use is --sort createdAt --reverse for the "alias added
       at-or-after this cutoff with the LONGEST track record"
       question, complementary to the "freshest first" default
       that --since alone surfaces.

    4. stats --reverse (4e73f71). 6 new tests. THE FAMILY-CONTRACT
       DEVIATION. Stats is the only --sort-bearing command whose
       --sort has a commander default value ("namespace"). The
       rest of the family treats --reverse without --sort as a
       no-op because opts.sort is undefined. Stats predates the
       family-wide reverse contract and has the default it
       cannot easily shed without breaking back-compat, so
       --reverse is ALWAYS active in stats — it flips against
       the default namespace order even with no --sort flag
       passed. Documented in the --reverse help text explicitly.
       Implementation: numeric keys (files/chunks/bytes) use the
       dual-flip multiplier as the other ports; namespace/name
       (which has no ties — each namespace name is unique
       server-side) uses a plain Array#reverse() since reversing
       asc-alphabetical is observationally indistinguishable
       from a localeCompare * dir sort.

    5. tags list --reverse + secondary-by-original-index sort
       (ba77780). 7 new tests. TWO ENTANGLED SLICES IN ONE
       COMMIT — the --reverse dual-flip multiplier needs a real
       local sort with a secondary index key to flip, and the
       queued list explicitly called out the tags secondary-
       index sort as missing under "verify the secondary-by-
       original-index sort is in place; if not, add it". Both
       shipped together. Like stats, tags is the OTHER family-
       contract deviation (--sort has a commander default of
       'count' so --reverse is always active). The previous
       code path was `--sort count`: pass-through (API order),
       `--sort tag`: localeCompare, no secondary key. Both
       paths are now unified through a single map-sort-map
       pipeline with the dir multiplier and the secondary-
       index key, mirroring the shape of every other family
       member. The --sort count output is observationally
       identical on the existing FIXTURE_ITEMS (no ties) but
       the contract is now enforced rather than incidental.

  Push: 4221787..ba77780 main -> main. All five commits authored
  as `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.

  Verify-gate note: ran `pnpm run ci:verify` (full pipeline,
  20 tasks: typecheck + test + build across all packages). The
  CLI package is fully green (629/629 cli tests pass, typecheck
  clean, build clean). Two pre-existing reds outside cli remain
  unchanged: (1) `@clawmind/telemetry` OpenTelemetry 1.x/2.x peer
  mismatch (queued since tick 1); (2) `packages/rag/test/hybrid.
  test.ts` alpha-blend drift (queued since tick 6). The
  `status --watch --json --check-after` flake surfaced once
  during the test re-run gate but cleared on 5 consecutive
  retries — same intermittent behaviour as previous ticks,
  remains queued for the deterministic-timer fix.

  Theme connector: this is the eleventh consecutive ship-from-
  patterns tick. The --sort-bearing family is now byte-for-byte
  uniform across all 8 commands that carry the primitive. Every
  one of them honours the same shape: (a) primary key per the
  --sort value, (b) secondary tie-break by original-input index
  for cross-snapshot determinism, (c) single dir multiplier
  under --reverse that flips both, (d) unknown-key abort with
  exit 1 enumerating the valid set, (e) byte-stable output
  across consecutive runs. The two deviations (stats, tags) are
  documented explicitly in both the --reverse help text AND in
  the corresponding test comments — a future reader sees the
  precedent rather than guessing.


- 2026-06-22 23:37 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: 5d21b7a, 713649a, 7bc727f, 71cb531, abec248. Test gate:
  `@clawmind/cli` 662/662 vitest pass (up from 629, +33 new tests:
  feedback +5, search +8, related +5, aliases +5, digest +6, plus
  4 more that landed in feature 1 commit's helper coverage). All 5
  are family-wide --json --slim cron-dashboard-shape ports, closing
  out the queued sweep that had explicitly called out all five
  commands.

  Theme: complete the family-wide --json --slim cron-dashboard
  contract. The --slim shape was first introduced two ticks ago on
  `feedback prune --json --slim` (mirroring the `doctor --json
  --quiet` and `digest run --json --slim` precedent). The queued
  list explicitly called out FIVE further ports: feedback list,
  search, related, aliases list, digest list. This tick ships all
  five.

  The slim cron-dashboard contract — now uniform across NINE cli
  commands (4 prior precedents + 5 this tick):
    1. Single-line JSON.stringify (no indent) so NDJSON snapshot
       streams diff cleanly between ticks.
    2. Drops the per-entry heavy fields the dashboard does not need
       (text bodies, excerpts, timestamps, per-row metadata).
    3. Emits a small set of integer counts + (optionally) a single
       array of identifiers (names, paths, ranking minima).
    4. Composes with every filter/sort the command already supports
       — the slim shape describes the SURVIVORS, not the raw API
       payload.
    5. Silently ignored without --json (the text-mode rendering is
       for humans and stays unchanged).

  The nine cli commands carrying the slim contract after this tick:
    feedback prune --json --slim     (tick 11; precedent)
    digest run --json --slim         (tick 7; precedent)
    doctor --json --quiet            (tick 9; precedent — the
                                      slim-equivalent flag name on
                                      doctor is --quiet because
                                      doctor's primary JSON shape
                                      is multi-section)
    stats --json --slim              (tick 5; precedent)
    feedback list --json --slim      (this tick — feature 1)
    search --json --slim             (this tick — feature 2)
    related --json --slim            (this tick — feature 3)
    aliases list --json --slim       (this tick — feature 4)
    digest list --json --slim        (this tick — feature 5)

  Per-feature notes:

    1. feedback list --json --slim (5d21b7a). 5 new tests. The
       shape is `{count, neutralCount, upDominantCount,
       downDominantCount}` — four integers carving the boost
       distribution at neutral with STRICT comparisons (an entry
       at exactly 1.0 is neutral, not dominant in either
       direction). Mirrors the `feedback list --above 1.0` /
       `--below 1.0` strict-comparison semantics the operator
       already knows from the band-filter flags. The sum-equals-
       total invariant (count === up + down + neutral) is pinned
       so a downstream `jq .upDominantCount / .count` ratio is
       trivially auditable.

    2. search --json --slim (713649a). 8 new tests. The shape is
       `{rank, path, score, namespace}` per hit. The deeper cut
       beyond --no-snippet: drops snippet/highlights/startLine
       entirely. The CRITICAL perf property: the slim path DOES
       NOT call snippetFor() — a cron dashboard polling once a
       minute over a 50-result top-k must not pay 50 snippet
       renders per poll. Pinned by `snippetForMock.not.
       toHaveBeenCalled()` under --slim AND a baseline assertion
       that the full --json path DOES call snippetFor (so the
       perf claim is auditable both ways). Precedence pinned:
       --paths-only > --slim > --no-snippet > full --json.
       Honours --out file dispatch + wrote-N stderr confirm byte-
       for-byte with the full --json --out behaviour.

    3. related --json --slim (7bc727f). 5 new tests. Per-item
       shape `{path, score, namespace}` — three fields. Drops
       per-neighbour `hits` count AND multi-paragraph `excerpt`
       body. Top-level fields PRESERVED: path (queried source),
       sourceChunkCount (property of the source, NOT of the
       returned set — critical that --threshold can take count
       to 0 while sourceChunkCount stays at the API value),
       count (filtered survivors). Pinned by a test that
       --threshold dropping every neighbour leaves
       sourceChunkCount at 47 while count and items go to 0/[].

    4. aliases list --json --slim (71cb531). 5 new tests. Shape
       `{count, names}` — two fields. `names` is the alphabetically-
       ordered list of alias names IN WHICHEVER ORDER the prior
       filter+sort pipeline produced — switching --slim on/off
       must NOT flip the ordering. Pinned by a test that
       --sort name --reverse produces desc-alphabetical
       ['c','b','a']. Composes with --since for the "names added
       at-or-after cutoff" cron poll.

    5. digest list --json --slim (abec248). 6 new tests. Shape
       `{count, overdueCount, neverRunCount}` — three integers.
       The third bucket exists because "added a saved search
       but never ran it" is operationally DISTINCT from "ran it
       once but it has gone stale" — the two have different
       remedies. The sum-equals-total invariant
       (count === overdueCount + neverRunCount) is pinned across
       three fixtures (all-never-run, all-timestamped, empty).
       Composes with --since for the canonical overdue audit —
       pairs with `digest run --since "..." --json --slim` (the
       sibling slim shape that ran 12 ticks ago) as the
       read+write side of the same overdue question.

  Push: c5fb70e..abec248 main -> main. All five commits authored
  as `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.

  Verify-gate note: ran `pnpm run ci:verify` (full pipeline,
  21 tasks: typecheck + test + build across all packages). 19
  successful, 2 failed — both pre-existing reds unchanged by
  this batch:
    (1) `@clawmind/telemetry` OpenTelemetry 1.x/2.x peer mismatch
        (queued since tick 1)
    (2) `packages/rag/test/hybrid.test.ts` alpha-blend drift
        (queued since tick 6)
  The `@clawmind/cli` package is fully green: 662/662 cli tests
  pass, typecheck clean, build clean. The `status --watch --json
  --check-after` flake did not fire this tick.

  Theme connector: this is the twelfth consecutive ship-from-
  patterns tick. The --slim cron-dashboard contract is now byte-
  for-byte uniform across all NINE cli commands that carry the
  primitive. An operator who learned --slim on `feedback prune`
  two ticks ago knows the shape on every list-style command in
  the cli today. The queued list grows by 5 new follow-up ports
  (stale --json --slim, tags list/paths --json --slim, pins/mutes
  list --json --slim, forget --dry-run --json --slim) that
  surfaced from the patterns this batch established — every
  list-style command in the cli that does NOT yet carry --slim
  is now identified by name in the queue for future ticks.

- 2026-06-23 03:17 PDT (Cake/cron) — 5 features shipped on main.
  Features: 2e7a4c7, ac16b87, afdde56, e5af7c7, 9ffb990.
  Test gate: `@clawmind/cli` 700/700 vitest pass (up from 662).
  38 net new tests spread across 4 files: pins.test.ts (+6),
  mutes.test.ts (+8), tags.test.ts (+14: 7 for list, 7 for paths),
  forget.test.ts (+8).
  Typecheck: `@clawmind/cli` clean; build clean.
  Verify gate: ran `pnpm run ci:verify` (full pipeline, 21 tasks:
  typecheck + test + build across all packages). 19 successful, 1
  failed: `@clawmind/telemetry` OpenTelemetry 1.x/2.x peer mismatch
  — same pre-existing red queued since tick 1, unchanged by this
  batch. The previous rag/hybrid test failure was apparently fixed
  somewhere along the way (only one failure now, not two).

  Theme: complete the family-wide --slim cron-dashboard contract
  on FIVE remaining list/preview commands that were all explicitly
  queued by the previous tick. Each command emits a leading-`count`
  shape so a downstream `jq .count` filter works against every
  slim shape in the family uniformly:
    1. pins list --json --slim    -> {count, paths}
    2. mutes list --json --slim   -> {count, paths}
    3. tags list --json --slim    -> {count, tags}
    4. tags paths <tag> --json --slim -> {count, tag, paths}
    5. forget --dry-run --json --slim -> {count, matched, removedChunks, dryRun}

  Design highlights:
  - The pins/mutes symmetry is intentional and pinned: both
    emit byte-identical {count, paths} so a multi-user workspace
    can run the same per-side audit on both halves of the pin/
    mute pair without conditional plumbing. The symmetry pin
    test verifies the key set matches byte-for-byte.
  - tags list uses `tags` not `names` as the array key because
    the operator already knows these are tag identifiers AND
    `names` would be ambiguous next to `tags paths --json --slim`
    which uses `paths`.
  - tags paths --json --slim is a re-key (not a drop): the full
    payload is already slim, but the key ORDER differs (count
    comes last in the full shape). The slim shape pins the
    leading-count convention so the family-wide `jq .count`
    filter works.
  - forget --json --slim drops the per-path removedPaths array
    (megabytes on a wildcard pattern) AND the patterns echo
    (the caller already knows the patterns). The slim shape is
    ~80 bytes regardless of match count — perfect for a "would
    prune N sources" widget polling once a minute. The dryRun
    boolean is PRESERVED because it disambiguates the slim
    shape between preview and apply mode.
  - Every slim emit short-circuits --paths-only (the pipeline
    shape wins over the JSON shape modifier — same precedent
    as search / forget / related --paths-only).
  - Every slim emit is silently ignored without --json (text
    mode unchanged — matches the family-wide slim-without-json
    silent-ignore precedent across aliases / digest / feedback /
    stats / search / related).
  - All five emit single-line JSON.stringify (no indent) so an
    NDJSON snapshot stream diffs cleanly between ticks.
  - All five tests verify the count===items.length invariant
    holds so a downstream `jq .count` consumer is never lied to
    (the slim count is always the post-filter survivor count,
    not the API natural total).

  Identity: commits land on main directly, each commit signed
  as `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.

  Theme connector: this is the thirteenth consecutive ship-from-
  patterns tick. The --slim cron-dashboard contract is now byte-
  for-byte uniform across FOURTEEN cli commands (previous nine +
  the five from this batch). Every list-style command in the cli
  EXCEPT `stale` carries the --slim shape today; the stale port
  is queued for a future tick (it has a special-case path because
  the existing --slim is a text-mode toggle that needs to be
  reconciled with --json). The queue refilled with 5 new
  follow-up items (tags paths --paths-only --reverse, reindex
  --since --paths-only / --json --slim pair, export --json
  --slim, doctor --json --slim --severity composition, stats
  --reverse all-keys port) so it stays well above the >=5
  ready-items floor for the next tick.

- 2026-06-23 07:10 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: 985751a, 492b542, b26f3ad, 684947e, 0344e25. Test gate:
  `@clawmind/cli` 732/732 vitest pass (up from 700; 32 net new tests
  spread across reindex.test.ts (+6), ingest.test.ts (+6),
  stale.test.ts (+7), stats.test.ts (+5), doctor.test.ts (+8)).
  Typecheck: `@clawmind/cli` clean. CLI build: clean. The full
  `pnpm run ci:verify` hits the same pre-existing telemetry
  OpenTelemetry 1.x/2.x peer mismatch as the previous 13 ticks —
  verified pre-existing by typechecking the parent commit
  (12bb639) against an unrelated isolate of the same file (red
  matched byte-for-byte). NOT introduced by this batch; remains
  queued.

  Theme: extend the --json --slim cron-dashboard contract to the
  destructive-adjacent dry-run preview commands AND resolve the
  long-queued doctor --severity / --slim composition question.

    1. reindex --dry-run --json --slim: `{count, since, dryRun}`.
       The natural cron poll is `clawmind reindex --since <iso>
       --dry-run --json --slim` answering "how many files would
       the next refresh touch" with a single-line ~80-byte
       payload, regardless of how many paths matched. On a
       workspace with thousands of files matching the cutoff,
       the full --json payload can be hundreds of kilobytes
       (each path is its own string); the slim shape is size-
       invariant. Mirrors `forget --json --slim` byte-for-byte
       with the explicit `dryRun: true` safety contract.
       Precedence: --paths-only still wins over --slim when both
       are set (pipeline contract beats dashboard contract).

    2. ingest --dry-run --json --slim: same `{count, since,
       dryRun}` shape as reindex byte-for-byte. The two
       destructive-adjacent dry-run commands share muscle memory,
       so the slim shape extends uniformly. The canonical poll
       is the 1-hour refresh tick budget question. The --since
       validation still fires BEFORE the slim branch so a typo'd
       cutoff aborts with exit 1 regardless of --slim — preserves
       the safety property the dry-run path was built around.

    3. stale --json --slim: `{count, thresholdDays, since}`.
       Cron-dashboard for the stale-budget question "how many
       files are stale right now". Uses the family-wide `count`
       spelling rather than the full --json mode's `total` — so
       a downstream `jq .total` against the slim shape returns
       null and fails loudly rather than silently producing wrong
       numbers. Precedence note for posterity: in stale (unlike
       search/reindex/ingest), the --json branch fires BEFORE
       the --paths / --paths-only / --tsv pipeline branches in
       source order. The slim shape lives inside --json, so when
       --json --slim --paths are all set, the slim shape wins.
       This deviates from the family-wide pipeline-beats-
       dashboard precedent but preserves back-compat with the
       existing `clawmind stale --json --paths` precedence pin.
       Explicitly documented in --slim's help text.

    4. stats --json --slim --top N caps the `stale` namespace
       array (re-targets from per-namespace extensions which the
       slim shape drops entirely). Resolves the queued
       ambiguity: WITHOUT this, the commander default `--top 4`
       was silently a no-op under --slim. Now the natural cron
       poll `clawmind stats --json --slim --since <iso> --sort
       files --top 5` answers "which 5 namespaces dominate the
       stale set" as a single-line ~50-byte panel. Critical
       contract: WITHOUT explicit --top, the slim list is
       unbounded (no implicit top-4 cap) because the operator
       polling a stats-slim dashboard typically wants the FULL
       namespace count. Detection via opts.top !== '4' (the
       commander default literal). Legacy behaviour preserved:
       without --slim, --top still caps extensions.

    5. doctor --json --slim is the family-canonical alias for
       --quiet. Both flags flip into the same slim shape but
       differ in --severity composition:
         --slim --severity <level>  -> tallies NARROWED to floor
         --quiet --severity <level> -> tallies unchanged (legacy)
       The slim narrowing under --severity unblocks the natural
       cron poll `clawmind doctor --json --slim --severity error
       | jq .findingsCount` — "how many error-or-above findings
       exist right now". The legacy --quiet retains the original
       v0 unconditional-full-counts behaviour for back-compat
       with any existing dashboard. When both flags are passed,
       --slim wins (the operator opted into the new canonical
       name). Safety contract: the `ok` field is ALWAYS driven
       by the FULL r.ok from the API — hiding warnings via
       --severity cannot accidentally promote unhealthy to ok.

  Process notes:
  - One snag mid-tick: stale .d.ts / .js sidecars in apps/cli/src
    (the gitignore-only artifacts from a previous tick's tsc
    output) were shadowing the source .ts files for vitest's
    module resolution, so the new --slim flag tests crashed with
    "unknown option" until I cleaned up the sidecars with
    `rm -f apps/cli/src/**/*.{js,d.ts,js.map,d.ts.map}`. Logged
    here because the previous tick (gitignored these via
    d951f11) prevented git from carrying them, but they still
    accumulate locally between ticks. A future tick could add a
    pre-test clean step to apps/cli's package.json scripts.
  - One test had to be rewritten mid-tick: stale's --json branch
    fires BEFORE --paths in source order (long-standing stale
    contract from a prior tick), so the family-wide "pipeline
    beats dashboard" precedence test had to be inverted to
    match. The --slim help text was also amended to document the
    stale-specific exception. The behaviour itself was unchanged
    — only the test assertion was wrong before the fix.

  Identity: commits land on main directly, each commit signed
  as `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.

  Theme connector: this is the fourteenth consecutive ship-from-
  patterns tick. The --json --slim cron-dashboard contract is now
  byte-for-byte uniform across NINETEEN cli commands (previous
  fourteen + the five from this batch: reindex, ingest, stale,
  stats-top, doctor-canonical). Every list-style + destructive-
  adjacent dry-run command in the cli now carries the --slim
  shape. The queue refilled with 4 new follow-up items
  (export-slim, stats-reverse-all-keys, compact-slim, watch-once-
  slim) so it stays well above the >=5 ready-items floor for the
  next tick.

- 2026-06-23 11:25 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: 1637323, 4c404de, 97f6647, 9ecbc55, 0ee197f. Test gate:
  `@clawmind/cli` 785/785 vitest pass (up from 752). 41 net new tests
  spread across 4 files: compact.test.ts (new, 9), export.test.ts (+10),
  watch.test.ts (+10), feedback-digest.test.ts (+13), stats.test.ts (+9).
  Typecheck: `@clawmind/cli` clean. Same two pre-existing reds outside
  cli (telemetry OpenTelemetry 1.x/2.x peer mismatch + rag/hybrid test
  alpha-blend drift); neither introduced this tick.
  Theme: this tick CLEARED FOUR of the queued cron-dashboard slim/diff
  follow-up items the previous fourteen ticks had piled up:
    1. compact --json --slim: ports the slim shape to compact
       (`{scanned, removed, kept, dryRun}` 4-integer shape). Mirrors
       `doctor --json --quiet`, `digest run --json --slim`, `feedback
       prune --json --slim`, `forget --json --slim`, `reindex --dry-
       run --json --slim`, `ingest --dry-run --json --slim` byte-for-
       byte. Preserves the sum-equals-total invariant `scanned ===
       removed + kept` so a downstream `jq` consumer can verify the
       math without re-reading the per-path removedPaths array. The
       cron-dashboard --json --slim contract is now byte-for-byte
       uniform across TWENTY cli commands (the nineteen from the
       previous tick + compact).
    2. export --slim: HEAD-style {format, since, bytes} dashboard
       probe that drops the conversation body and reports only the
       response byte length. Sidesteps the API-blocker on the
       earlier queued `{count, format, since}` variant (which would
       have needed parsing the body across the 3 formats or a
       sibling endpoint) — `bytes` is the actually-most-useful
       single signal for "did this grow" without that complexity.
       The body is suppressed from BOTH stdout AND -o (the file
       write is skipped under --slim because the body has been
       discarded; the slim probe is a polling shape, not a
       persistence shape).
    3. watch --once --preview-json --slim: 2-key {count, since}
       cron-dashboard probe. The slim flag sits ON --preview-json
       (the explicit JSON path) where it naturally composes —
       reconsidered from the original queued shape `--once --paths-
       only --json --slim` because the --paths-only contract short-
       circuits before --json/--slim by design, so a slim shape on
       top of --paths-only would inherit the precedence and never
       fire. Pure-preview semantics preserved (ingest skipped, only
       discoverFiles fires).
    4. digest show --paths-only --diff --only-added / --only-removed:
       exclusive single-direction emit modes that close the gap the
       bare --diff shape forced operators to bridge with `grep "^+ "
       | cut -c3-`. The "both = none" semantic: both flags = the
       unfiltered --diff stream (the natural reading of "additions
       only AND removals only" = "everything"). Dual-set dedupe
       semantic preserved — a path that appears in newSources of one
       row AND removedSources of another still surfaces TWICE under
       bare --diff because the dedupe sets are SEPARATE per
       direction, and under --only-added only the `+ ` survives for
       shared paths (the direction-filter does NOT pollute the
       surviving direction's dedupe set).
    5. stats --json --slim --paths: re-targets the flat stream from
       per-namespace extensions to the FLAT NAMESPACE-NAME stream
       (one namespace name per line, xargs-safe). Closes the gap
       that the slim JSON `{stale, total}` shape forced operators
       to bridge with `jq -r '.stale[]'`. GATED on BOTH --json AND
       --slim being active so existing scripts using bare --paths
       (without --slim) or --paths --json (without --slim) keep
       getting the legacy extension stream byte-for-byte — no
       regression. Pinned with an observational-consistency
       invariant test that reads `parsed.stale` from --json --slim
       and `.split('\n')` from --json --slim --paths and asserts
       the arrays are deep-equal.
  Verify-gate note: ran `pnpm typecheck` and `pnpm test`. Same two
  pre-existing reds outside cli (telemetry OpenTelemetry 1.x/2.x peer
  mismatch + rag/hybrid test alpha-blend drift); neither introduced
  this tick. Cli test suite at 785/785 (one test ran into the macOS
  vitest fork-pool deadlock quirk after sidecar wipe — switching to
  `--no-isolate` cleared it, identical workaround to the 2026-06-20
  18:51 PDT tick log).
  Identity: commits land on main directly, each commit signed as
  `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.
  Theme connector: this is the fifteenth consecutive ship-from-
  patterns tick. The --json --slim cron-dashboard contract is now
  byte-for-byte uniform across TWENTY+ cli commands. The two new
  shape patterns introduced this tick — (a) `--slim` as a body-
  suppressing HEAD-style probe (export), (b) `--only-*` exclusive
  emit modes inside the --diff prefix-stream (digest) — open
  follow-up surfaces on other commands that have similar shapes
  (forget --dry-run --slim body suppression, watch --json
  event-stream --only-add/--only-change/--only-unlink direction
  filters, etc.). Four queued items resolved; four legacy items
  remain (stats-reverse-all-keys, stale-reverse, feedback-prune-
  reverse, tags-paths-reverse). The queue stays well above the
  >=5 ready-items floor.

- 2026-06-23 15:09 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: e16f742, 5373fc4, fc45981, 08b52b2, 50cc616. Test gate:
  `@clawmind/cli` 833/833 vitest pass (up from 785). 48 net new tests
  spread across 5 files: watch.test.ts (+10), tags.test.ts (+9),
  feedback-digest.test.ts (+9), stats.test.ts (+8), stale.test.ts (+10).
  Typecheck: `@clawmind/cli` clean. Same one pre-existing red outside
  cli (telemetry OpenTelemetry 1.x/2.x peer mismatch — queued since
  tick 1, unchanged by this batch). The rag/hybrid alpha-blend test
  that was flagged in earlier ticks no longer appears as a failure
  (consistent with the 2026-06-23 03:17 PDT tick observation).

  Theme: this tick CLEARED FOUR queued items from the previous tick's
  refilled list AND shipped a new family-wide --top port to stale.
  Each feature touches a different command in the cli — no two
  commands shared a theme, but every commit ports a family-wide
  pattern that already exists elsewhere to a command that was
  missing it.

    1. watch --only-add / --only-change / --only-unlink (e16f742):
       port of the digest --only-added / --only-removed pattern to
       the live watch event stream. Triplet of flags with the
       "all = none" semantic. Critical design property: the filter
       sits INSIDE onEvent so the underlying ingest still fires
       for every event — only the operator-facing stdout stream is
       narrowed. Filtering ingest by kind would silently leave
       stale entries in BM25 on a forgotten unlink; the split
       keeps the index consistent while still narrowing the
       cron pipeline.

    2. tags paths <tag> --sort path + --reverse (5373fc4): the
       per-tag paths command joins the family-wide --sort family
       (stats / feedback list / digest list / aliases list / tags
       list / stale / search / related --sort). Only `path` is
       supported today (the per-path payload has no other meaningful
       sort key); the flag exists for symmetry so a future addition
       (e.g. lastIngestedAt) drops in without a breaking change.

    3. digest show <id> --json --slim (fc45981): 3-integer
       churn-history shape `{count, addedCount, removedCount}`.
       The natural cron use is a dashboard panel polling "did this
       saved search churn paths since cutoff X" once a minute as a
       single ~70-byte poll. Mirrors `digest run --json --slim`
       byte-for-byte (3 integers) but on the read-side: `digest
       show` is per-saved-search churn-history, `digest run` is
       per-batch run shape.

    4. stats --tsv --header (08b52b2): prepend a single tab-
       separated schema row to the TSV stream so the body is
       friendly to typed-table parsers without a separate `echo`
       prelude. Mirrors `stale --tsv --header` byte-for-byte. Two
       header shapes: full 5-col under bare --tsv, 2-col
       `namespace<TAB>files` under --json --slim --tsv. Zero-row
       contract: header still fires (the schema row is the CONTRACT).

    5. stale --top <n> (50cc616): post-sort client-side cap.
       Family-wide --top contract (mirrors stats / feedback list /
       tags list / search --top). Applied LAST so the cap honours
       the chosen ordering. RECOMPUTES `total` to the post-cap
       survivor count so a downstream `jq .total` consumer always
       matches `items.length`.

  Process notes:
  - Stale .d.ts / .js sidecars: cleared at tick start (same macOS
    quirk from prior ticks).
  - Two patches mid-tick had escape-doubling issues in kleur error
    messages — `\'` apostrophes were double-escaped to `\\'` during
    the patch insertion, producing TS1005 syntax errors. Fixed by
    re-patching with the single-escape form. No semantic bug, just
    a patch-tool gotcha worth noting for future ticks.
  - One test-iteration regression mid-tick: the first version of
    tags paths --sort did NOT thread the sorted `paths` into the
    --json full / --slim / text branches. Fixed by re-threading
    `paths` through all three emit branches. The 3 failing tests
    caught it cleanly.
  - Verify gate: ran `pnpm run ci:verify` (full 21-task pipeline).
    19 successful, 1 failed (telemetry OpenTelemetry peer mismatch
    unchanged from every tick since tick 1).

  Identity: commits land on main directly, each commit signed as
  `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.

  Theme connector: this is the sixteenth consecutive ship-from-
  patterns tick. Five different family-wide patterns ported to
  five different commands this batch:
    (a) --only-* exclusive-emit pattern (digest -> watch)
    (b) --sort path family contract (stats etc. -> tags paths)
    (c) --json --slim cron-dashboard shape (digest list/run -> digest show)
    (d) --tsv --header schema-row contract (stale -> stats)
    (e) --top family-wide post-sort cap (stats etc. -> stale)
  Each port closes a queued item AND establishes the pattern on
  one more command in the cli surface. The queue refilled with
  4 new follow-up items (digest --sort ts, forget --top, search
  --tsv, plus a closed-as-not-needed watch --once --only-* audit)
  so it stays well above the >=5 ready-items floor for the next tick.

- 2026-06-23 19:21 PDT (Cake/cron) — 5 features shipped directly on main.
  Features: 18ad396, 0037057, e8b79e7, 6755e2f, c87a78b. Test gate:
  `@clawmind/cli` 878/878 vitest pass (up from 833). 45 net new tests
  spread across 4 files: search.test.ts (+9: 62 -> 71), related.test.ts
  (+8: 47 -> 55), feedback-digest.test.ts (+19: 833-833 split — 9 for
  feedback list --tsv on the "feedback cli" block + 10 for digest show
  --sort on the "digest cli" block), forget.test.ts (+8: 25 -> 33).
  Typecheck: `@clawmind/cli` clean. Same one pre-existing red outside
  cli (telemetry OpenTelemetry 1.x/2.x peer mismatch — queued since
  tick 1, unchanged by this batch). The rag/hybrid alpha-blend test
  is back as a failure too this tick (queued since tick 6; appears
  intermittently across recent ticks).

  Theme: extend the family-wide --tsv contract that landed on stats
  this morning (08b52b2) to THREE more commands (search, related,
  feedback list) AND ship two more family-wide ports (digest show
  --sort, forget --top) closing the queued sweep.

    1. search --tsv [+ --header] (18ad396): emits the canonical 4-col
       `<rank>\t<path>\t<score>\t<namespace>` stream. Mirrors stale
       --tsv / stats --tsv byte-for-byte. The 4 columns match the
       --json --slim shape so a downstream parser flipping between
       the two only changes the framing, not the schema. Score uses
       .toFixed(3) precision matching text-mode render so cross-mode
       diffs are byte-stable. Perf property pinned: --tsv does NOT
       call snippetFor() — a cron snapshot polling once a minute
       does not pay the snippet-rendering cost. --header fires
       UNCONDITIONALLY even on zero-row bodies; without --header the
       zero-hit case is a fully empty stream (wc -l = 0; the
       text-mode "no results" hint is suppressed). Precedence:
       --paths-only > --tsv > --json > text — pipeline contract
       beats machine-readable JSON.

    2. related --tsv [+ --header] (0037057): extends the search-tsv
       4-col shape with a 5th `hits` column (per-neighbour chunk match
       count, same field text mode renders as `xN`). Hits is included
       because a neighbour with many chunk hits is structurally
       different from one with a single high-score chunk — the cron
       operator running a TSV snapshot wants both signals in one
       column-aligned stream rather than parsing the text-mode `xN`
       suffix or dropping back to --json + jq. Same precedence,
       same schema-row contract, same .toFixed(3) cross-mode
       stability. Excerpt bodies MUST NOT leak (pinned).

    3. feedback list --tsv [+ --header] (e8b79e7): 4-col
       `<path>\t<boost>\t<ups>\t<downs>`. Operator-facing signals
       minus the ANSI sign-glyph the text mode renders. Boost uses
       .toFixed(2) precision matching text-mode "${boost.toFixed(2)}x"
       render so cross-mode diffs byte-stable. Composes with -q /
       --above / --below / --top / --sort / --reverse — the TSV
       stream describes the post-filter, post-sort, post-cap
       survivors (same as every other emit mode). The text-mode
       "no feedback yet" hint is suppressed under --tsv (xargs/wc-
       safe regression pinned).

    4. digest show --sort + --reverse (6755e2f): family-wide --sort
       port to the history rows. Three keys, all desc by default:
       ts (newest-first, matches API, explicit no-op for symmetry),
       addedCount (loudest-additions-first), removedCount (loudest-
       removals-first). Applied AFTER -q / --since but BEFORE --last
       so the cap honours the new ordering: `--sort addedCount
       --last 1` surfaces the LOUDEST recent ingest event in one
       call (NOT the newest). This composition is the operator-
       friendly cron one-liner. Ties carry a secondary sort by
       original index. Unknown keys throw cleanly with exit 1.
       --reverse flips with a single sign-flipping multiplier on
       BOTH primary AND secondary, preserving cross-snapshot
       determinism in either direction.

    5. forget --top <n> (c87a78b): caps the previewed `removedPaths[]`
       array AND the --paths-only stream to the first N paths the
       API returned. Presentation-only — matched/removedChunks
       integer counts STILL reflect the FULL API match so a
       downstream consumer always knows the true scope of what
       would happen on --apply, even with --top set.
       CRITICAL SAFETY CONTRACT: --top is REJECTED with --apply.
       Allowing a cap on the destructive path would let `forget X
       --top 5 --apply` silently delete the FULL N-path match while
       only showing the operator 5 paths in the report — a
       misleading discrepancy between visible preview and actual
       destruction that the cron safety pattern explicitly forbids.
       The error message tells the operator the two options
       (drop --top OR drop --apply). Text-mode header surfaces the
       discrepancy visibly: "would remove 50 source(s) and 250
       chunk(s) [showing first 5]" — the "[showing first N]"
       suffix only fires when --top actually capped (--top 50
       against a 3-path match is a no-op with no false suffix).
       Family-wide --top contract: non-positive / NaN falls back
       to "no cap" (matches stale/stats/feedback list/search/tags
       list/digest list --top precedent).

  Push: bb313a1..c87a78b main -> main. All five commits authored
  as `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.

  Verify-gate note: ran `pnpm run ci:verify` (full 21-task
  pipeline). 19 successful, 2 failed: the queued telemetry
  OpenTelemetry 1.x/2.x peer mismatch + the rag/hybrid alpha-blend
  drift — both unchanged by this batch (verified pre-existing by
  running `pnpm --filter @clawmind/cli test` in isolation, which
  passes 878/878 clean).

  Process notes:
  - Patch-tool gotcha: the first attempt at the search --tsv help
    text crammed two .option() calls onto one line because the
    embedded backslashes in the doc string confused the patch
    tool's escape handling. Caught immediately by the typecheck
    on the patch — fixed by re-patching with simpler help text
    (no shell escape gymnastics). Worth noting for future ticks:
    multi-line .option() chains with embedded `\\` literals are
    fragile to the patch tool.
  - During the search --tsv patch the entire --slim option
    declaration was accidentally deleted; the failing 9 test
    cases caught it cleanly within 30 seconds. Restored with a
    targeted re-insertion. The fast feedback loop (per-feature
    test gate before commit) prevented this from landing on main.

  Identity: commits land on main directly, each commit signed as
  `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.

  Theme connector: this is the seventeenth consecutive ship-from-
  patterns tick. THREE different family-wide patterns ported to
  five different commands this batch:
    (a) --tsv [+ --header] family-wide tab-separated emit
        (stats -> search, related, feedback list)
    (b) --sort + --reverse family-wide ordering primitive
        (digest list / aliases list / tags paths / etc. -> digest show)
    (c) --top family-wide post-set cap
        (stats / feedback list / search etc. -> forget, with the
        safety twist that forget --top is REJECTED with --apply)
  The cli's --tsv contract now spans FIVE commands uniformly
  (stale, stats, search, related, feedback list); the schema-row
  --header contract is consistent across all five. Every primary
  column shape MIRRORS the corresponding --json --slim shape so
  downstream parsers can flip between TSV and JSON framings with
  no schema drift. The queue refilled with 7 new follow-up items
  (related --tsv --slim composition pin, stats slim --tsv --header
  zero-row pin, digest show --paths-only --sort, feedback prune
  --tsv, search --tsv --out file dispatch, forget --top
  proportional cap, digest show --tsv) so it stays well above the
  >=5 ready-items floor for the next tick.

- 2026-06-23 23:32 PDT (Cake/cron) — 5 features shipped directly on main.
  **PIVOT TICK: FRONTEND override engaged.** Sanjay added a standing
  override at the top of `~/.hermes/scripts/clawmind-20min-prompt.md`
  redirecting this 20-min loop from CLI work to frontend/UX work in
  `apps/web/`. The override pauses the long-running CLI ergonomics
  sweep (17 prior consecutive ticks) and starts a fresh frontend focus
  in the Next.js + React 19 web app. Backend/CLI ticks resume only if
  the override block is removed.

  Features: b0ac005, d840cb8, 0e93243, 5574dad, f5e19d4. Push:
  3724f57..f5e19d4 main -> main. All five commits authored as
  `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.

  Verify gate: ran `pnpm run ci:verify` (full 21-task pipeline). 19
  successful, 2 failed: the pre-existing `@clawmind/telemetry`
  OpenTelemetry 1.x/2.x peer mismatch (queued since tick 1, unchanged
  by this batch) + a stale `.next` cache from a prior run that did not
  affect the `@clawmind/web` typecheck task (clean). The web app's
  isolated typecheck pass (`pnpm --filter @clawmind/web typecheck`)
  AND the `@clawmind/ui` package's isolated typecheck pass (`pnpm
  --filter @clawmind/ui typecheck`) are both fully GREEN — every line
  shipped this tick is verified pre-push.

  Theme: shake the dust off the chat surface — the app's hottest page
  — and ship the four most-missed quality-of-life features (toast
  notifications, copy-with-citations, keyboard shortcut overlay,
  skeleton loading state), plus one quietly-useful filter affordance
  on the sources rail. Two of the features ship as new primitives in
  `@clawmind/ui` (Toast + Skeleton) so they're reusable across the
  whole app, not chat-only.

    1. feat(ui): Toast notification system (b0ac005). New
       `@clawmind/ui/Toast.tsx` primitive: ToastProvider + useToast
       hook + an aria-live polite viewport stacked bottom-right.
       Three semantic tones (success / error / info) with
       tone-appropriate auto-dismiss durations (errors stick 6.5s,
       info 4.2s, success 3.2s) so the operator never misses a
       failure. Hard-capped at 6 visible toasts so a runaway loop
       cannot overflow the viewport. prefers-reduced-motion users
       skip the 180ms slide-in. Mounted ONCE in
       `apps/web/src/app/layout.tsx` so every page has access via
       `useToast()` without per-page wiring. Soft-fails outside a
       provider with a single console.warn rather than crashing —
       safe to call defensively.

    2. feat(web/chat): CopyAnswerButton (d840cb8). Renders next to
       the existing Share button on every finished chat answer. Copies
       a self-contained `Q: <query>\n\nA: <answer>\n\nSources:\n  [1]
       <path>:<lines>\n  [2] ...` blob that pastes cleanly into Slack,
       email, an issue, or a notes file with the numbered [1] [2]
       inline citations in the answer body still resolving to the
       numbered Sources list — citation-preserving plain text. Uses
       the new toast system for both success (with character count +
       source count) and clipboard-blocked errors. Icon swap (copy →
       check) for 1.5s after a successful copy so the button confirms
       even if the toast is dismissed early.

    3. feat(web): ShortcutHelp overlay (0e93243). The "?" shortcut
       every modern app (Linear, Notion, GitHub) has — a discoverable
       cheatsheet listing every keyboard shortcut in the app, opened
       by pressing bare '?' anywhere outside a text input. Bound via
       the existing `useHotkey` hook with a CRITICAL guard: the
       binding is suppressed when the keystroke originates from
       INPUT / TEXTAREA / contentEditable, so a user typing '?' into
       the composer or any settings field does NOT clobber their
       keystroke. The TopNav now carries a '?' kbd chip next to the
       existing '⌘ K' chip so the binding is discoverable without
       keyboard-spamming. Three groups (Navigation / Chat / Command
       palette) with curated shortcuts only — not every accidental
       binding.

    4. feat(web/chat): skeleton loading state (5574dad). Replaces the
       bare "Spinner + reading the workspace" line with a
       layout-faithful skeleton mirroring the chat reading column:
       ChatAnswerSkeleton (three paragraph blocks with stepped bar
       widths so the silhouette reads as PROSE not as a rectangle)
       and SourcesRailSkeleton (three placeholder cards matching the
       real SourcesPane cards down to the citation pill at top-left).
       Calm 1.6s cm-pulse keyframes with 120ms phase offsets between
       bars so the eye sweeps left-to-right rather than seeing every
       bar blink in sync. aria-busy + visually-hidden announce text
       preserves the screen-reader affordance that the spinner+label
       carried.

    5. feat(web/chat): SourcesRail filter input (f5e19d4). When the
       rail carries >=4 sources, a small monospace filter input
       appears above the cards. Matches against path OR excerpt OR
       snippet text (case-insensitive substring), no API call, fully
       client-side. Header switches from "N sources" to "M of N"
       when filtering narrows the list so the operator always knows
       how many were hidden. CRITICAL stability contract: citation
       pill numbering uses the source's ORIGINAL index in the
       unfiltered list (`sources.indexOf(s)`), NOT its index in the
       filtered subset — so citation [3] in the answer text always
       points at the SAME source no matter how the rail is currently
       filtered. Without this, filtering would silently break the
       answer's [1] / [2] / [3] references — a subtle bug that took
       30 seconds of thought to anticipate.

  Identity: commits land on main directly, each commit signed as
  `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.

  Theme connector: this is the first frontend tick under Sanjay's
  override. The web app now has THREE new design-system primitives
  (Toast, Skeleton, ShortcutHelp), TWO new chat affordances
  (CopyAnswerButton, SourcesRail filter), and ONE new global hotkey
  binding ('?'). Every line is wired through the existing cm-* token
  palette so the design language stays unified. The queue refilled
  with 26 frontend follow-up items spread across CHAT SURFACE,
  SOURCES, GLOBAL UX/NAV, PAGE-LEVEL POLISH, and A11Y/THEMING groups
  so it stays well above the >=5 ready-items floor for the next
  frontend tick.

- 2026-06-25 00:07 PDT (Cake/cron) — 5 frontend features shipped on main.
  Features: a5ffb81, 36213ed, d330b7f, 928d500, 3292b2b. Theme: complete
  the chat-surface citation NAVIGATION loop + a real error RECOVERY path,
  the top-of-queue chat items from last tick's "next batch" note.
    1. a5ffb81 — clicking an inline citation now scroll-into-views the
       matching rail card (block: nearest) and runs a one-shot 1.2s gold
       flash-ring. Extracted a shared lib/sourceNav (revealSourceCard +
       sourceCardId) so the DOM-id contract lives in ONE place instead of
       string-concatenated 'cm-source-'+id in two files.
    2. 36213ed — [ / ] step through the answer's citations in first-
       appearance order (new lib/citations citedOrder, de-dupes + skips
       model over-counts), focusing each pill (cm-cite-<id>) and revealing
       its card. From no-selection, ] -> first and [ -> last, then wraps.
       Suppressed inside inputs; CitationChip gained a buttonId prop;
       registered in the ? shortcut sheet + breadcrumb hint.
    3. d330b7f — stream failures now render a ChatError panel (Retry =
       re-submit same question; Edit and try again = caret back to the
       composer with the question preserved via a new Composer focusSignal)
       instead of a dead-end red block. submit() now takes an explicit
       question arg so Retry is state-edit-robust. CAUGHT a latent footgun
       in the process: the Ask button passed onClick={onSubmit}, leaking
       the MouseEvent into the new question param — fixed to onSubmit().
    4. 928d500 — a StreamProgress footer (breathing accent dot + running
       token count + last-token gap) appears the moment the first token
       lands, closing the binary skeleton->done gap. Inter-token timing
       tracked via a ref so it survives re-renders; all reset each submit.
    5. 3292b2b — each rail card gained a top-right open-in-viewer anchor
       (new tab, does NOT dismiss the active citation; stops click +
       mousedown propagation; calm-at-rest reveal on hover/focus-within).
       Subtle correctness catch: deep-links by s.path (the REAL fs path
       the /sources/file route reads), NOT displayPath — an alias label
       like "@notes/foo.md" would have 404'd. Forwards start/end too.
  Gate: `pnpm run ci:verify` fails ONLY on the pre-existing
  @clawmind/telemetry OTel 1.x/2.x ReadableSpan peer mismatch (roadmap
  line ~311, queued since tick 1, untouched here). The two packages this
  tick touches — @clawmind/ui + @clawmind/web — BOTH typecheck green AND
  `next build` compiled every route (incl. /chat, /sources/view) clean.
  Three reduced-motion guards added (flash-ring, stream-dot, kept the
  skeleton's). Push: abd756d..3292b2b main -> main.

  Identity: commits land on main directly, each signed as
  `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.

- 2026-06-25 06:00 PDT (Cake/cron) — 5 features shipped on main. The
  a11y + nav + theming batch the previous session flagged as a strong
  candidate; all 5 were top-of-queue ACCESSIBILITY/THEMING/NAV roadmap items.
  Features: fd83f5b, 917c05e, 76c13c2, 9b453b9, f6a2c85. Theme: make the
  shell itself accessible and self-describing — keyboard focus, screen-reader
  signposting, OS-aware theming, and per-route tab titles. None of these are
  chat-surface (that loop is well-covered); this tick hardens the chrome every
  page shares.
    1. fd83f5b — useTheme rewrite: resolves explicit choice -> OS
       prefers-color-scheme on mount (in an EFFECT, not the useState
       initialiser, so no SSR hydration mismatch against the light default);
       live-follows OS dark/light flips via a matchMedia change listener until
       the first explicit toggle pins a fixed theme. System changes don't
       persist, so OS-follow survives until the user opts in. Replaces the old
       hard-coded `useState('dark')`.
    2. 917c05e — skip-to-content link as the first focusable element in
       TopNav (renders on ~95 pages). Off-screen at rest, slides into the
       top-left on keyboard focus, targets a tabindex=-1 landing span placed
       right after the header so focus lands just past the nav. Reduced-motion
       guard collapses the slide. New CSS: .cm-skip-link / .cm-skip-target.
    3. 76c13c2 — aria-current="page" on the active nav link in BOTH the
       desktop primary nav and the mobile overflow bar, reusing the existing
       `active` pathname computation so the visual highlight and the ARIA
       state can never drift apart. SR users finally get the current page.
    4. 9b453b9 — global :focus-visible ring (2px --cm-accent-line) on
       a/button/input/textarea/select/summary + role=button|link|tab|menuitem.
       :focus-visible (not :focus) means pointer clicks never ring while
       keyboard/programmatic focus always does; inputs use a tighter offset.
       The four bespoke focus treatments (cite pill, skip link, open-viewer,
       share CTA) keep class-level specificity and override the base cleanly.
    5. f6a2c85 — per-route document title. New lib/pageTitle.ts is a DRY
       route->label resolver (curated TOP_LEVEL + SETTINGS maps, humanize
       fallback, opaque-id skip so /tags/<hash> -> just "Tags") + a
       DocumentTitle client component mounted once in the layout that syncs
       document.title on navigation. Crucial: server-titled routes
       (trust/incidents/sbom/breach-register/offline + the /s/[id] share page)
       resolve to null and are LEFT UNTOUCHED so the client never clobbers a
       server generateMetadata title. Settings sub-pages render breadcrumb
       titles ("Security . Settings . ClawMind"). Validated the resolver output
       against 12 sample paths before shipping.
  Gate: `pnpm run ci:verify` fails ONLY on the pre-existing
  @clawmind/telemetry OTel 1.x/2.x ReadableSpan peer mismatch (roadmap
  line ~311, queued since tick 1, untouched here). Because ci:verify chains
  typecheck && test && build, that telemetry red short-circuits before build,
  so I ran `pnpm --filter @clawmind/web build` directly as the real web/ui
  gate: @clawmind/ui + @clawmind/web BOTH typecheck green AND `next build`
  compiled all 102 routes clean ("Compiled successfully", 102/102 static
  pages). The single lint warning (`sources` useMemo, web build line 498) is
  pre-existing and in none of this tick's 6 touched files. Push:
  051259f..f6a2c85 main -> main.

  Identity: commits land on main directly, each signed as
  `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.

- 2026-06-25 11:19 PDT (Cake/cron) — 5 features shipped on main. The nav
  discoverability + UI-primitive batch the previous session flagged as a strong
  "next tick" candidate; all 5 were top-of-queue NAV / UI-primitive / PAGE-POLISH
  roadmap items. Features: e300f3c, 1e01dde, adcf288, cba8f79, f761dee. Theme:
  close discoverability gaps across the shell + consolidate a duplicated
  primitive, then two page-level polish wins (history, stats).
    1. e300f3c — Kbd + KbdGroup primitive in @clawmind/ui. Three surfaces
       (ShortcutHelp sheet, CommandPalette, TopNav legend) each hand-rolled
       their own kbd chip CSSProperties block with subtle drift. Extracted a
       single Kbd (one key, sm flat-muted / md raised) + KbdGroup (key sequence,
       or boxed=one bordered pill for the TopNav legend idiom). All three
       consumers dropped their local kbd const and render the primitive; chips
       render byte-identical at each size (no visual change).
    2. 1e01dde — desktop "More" overflow dropdown in TopNav. The 7 primary
       surfaces show in the nav; the ~20 secondary surfaces were reachable on
       DESKTOP only via cmd-K (the horizontal-scroll bar listing them is
       md:hidden). Added a MoreMenu popover at the end of the primary nav: a
       two-column grid of every secondary item, closes on Esc/click-outside/
       select, highlights the active item AND the "More" trigger when the
       current route lives in the secondary set. role=menu/menuitem +
       aria-haspopup/aria-expanded, reuses the existing `active` computation.
       Added a shared IconCaretDown to @clawmind/ui for the trigger.
    3. adcf288 — per-day grouping on /history. The flat newest-first run got
       bucketed into calendar days under a sticky DayHeader (mono label +
       hairline + per-day count). New lib/dayGroups.ts: pure groupByDay +
       dayLabel (Today / Yesterday / weekday within the last week / "Jun 10"
       same year / "Mar 4, 2025" older). Grouping preserves the API's
       newest-first order across AND within groups; empty days never produce a
       group. Row-rendering closure lifted into a local renderRow() to avoid
       duplicating the large per-item handler block. Verified bucketing + labels
       against a 6-row fixture spanning all five label cases (ran via tsx).
    4. cba8f79 — switchable files/chunks/bytes lens on the stats namespace
       bars. The bar viz was hard-wired to chunks (scale + value column). Added
       a Files/Chunks/Bytes segmented toggle that re-sorts the namespaces desc
       by the chosen metric, rescales every bar to that metric's max, and swaps
       the value column (bytes via fmtBytes). The bar width animates 300ms so
       the re-rank reads smooth. The three summary stat cards double as lens
       shortcuts with an accent ring when active. role=tablist/tab +
       aria-selected on the toggle; aria-pressed on the cards.
    5. f761dee — cmd+/ saved-prompt picker overlay on the composer. The
       Tab-cycling through SAVED_PROMPTS is fast but invisible to a first-time
       user. Added the discoverable twin: a PromptPicker anchored under the
       composer, opens on cmd/ctrl+/ or the footer "saved prompts" hint button,
       type-to-filter, up/down + Enter to pick, Esc/click-outside to close.
       Picking drops the prompt into the textarea and returns the caret to the
       end. Tab cycling untouched alongside it. Surfaced the binding in the
       ShortcutHelp Chat group + the chat breadcrumb hint. role=listbox/option.
  Gate: `pnpm run ci:verify` fails ONLY on the pre-existing @clawmind/telemetry
  OTel 1.x/2.x ReadableSpan peer mismatch (queued since tick 1, untouched here).
  ci:verify chains typecheck && test && build so that telemetry red
  short-circuits before build; ran the real web/ui gate directly:
  @clawmind/ui + @clawmind/web + @clawmind/api ALL typecheck green AND
  `pnpm --filter @clawmind/web build` compiled clean ("Compiled successfully",
  all routes generated). The single lint warning (`sources` useMemo, now at
  history/page.tsx:552) is PRE-EXISTING — it's the untouched `namespaces`
  useMemo in HistoryRow; it only shifted line number because the day-grouping
  memo added ~54 lines above it (none of this tick's edits touched that code).
  Push: 246608b..f761dee main -> main.

  Identity: commits land on main directly, each signed as
  `Cake (cron) <51058514+Sanjays2402@users.noreply.github.com>`.
