# spasht – Design & Implementation Tasks

This doc breaks work into small, shippable tasks aligned to the EARS requirements and current codebase.

## 0. Foundations
- [ ] Verify environment variables and AWS IAM permissions (Bedrock, Transcribe, S3, RDS).
- [x] Add minimal README with local run and feature flag instructions.

## 1. Admin Panel & Feature Flags
- [x] DB: Add `FeatureConfig` model (single-row key/value or namespaced flags) via Prisma migration.
- [x] API: `GET/POST /api/admin/flags` secured to admin; returns and updates: `asrProvider: "TRANSCRIBE" | "NOVA_REALTIME" | "WEBSPEECH_FALLBACK"`.
- [x] UI: `/admin` page (admin-only) with a segmented control to select ASR provider + save.
- [x] Client: Read the selected provider on Practice page init and create ASR provider accordingly.
- [x] Edge cases: Disable save if no change; inline error + success status.

## 2. ASR Providers
- [x] Implement `TranscribeAsr` provider: browser → server streaming route → AWS Transcribe; emits partial/final.
- [ ] Implement `NovaRealtimeAsr` provider behind feature flag (protocol: WebRTC/WebSocket to Bedrock Realtime).
	- [x] Interim: functional client streaming via existing Transcribe NDJSON path to preserve parity.
	- [ ] TODO: Replace transport with Bedrock Realtime (WebRTC) and update server signaling route.
- [x] Fallback to `WebSpeechAsr` when no creds or provider not available.
- [x] Add provider factory and wire into Practice page (`getAsrProvider()`), with AUTO_SWITCH failover wrapper.

## 3. Coaching
- [x] Define `CoachProvider` and implement `BedrockNovaCoach` for nudges and report.
- [x] Add `/api/coach/nudges` and `/api/coach/report` routes.
- [x] Add server validation + rate limiting for nudges/report.
- [ ] Add small prompt library and tests for regression.

## 4. Session & Persistence
- [x] Extend Prisma schema with `SessionEvent` and `FeatureConfig`.
- [x] `POST /api/sessions/start` and `/end` implemented; finalize with transcript + report fields.
- [x] Store nudges shown (type, ts) in `SessionEvent` via `/api/sessions/event`.

## 5. Analytics
- [x] Instrument client: record ASR latency, coach latency, nudge impressions.
- [x] Admin dashboard: p95 latencies, session trends, recent latency sparklines.
- [ ] Aggregate endpoints for admin dashboard (optional; current page queries DB directly).
- [ ] Optional: push key events to PostHog/Mixpanel.

## 6. Admin Dashboard
- [x] `/admin` main: feature flags + current provider status.
- [x] `/admin/analytics`: initial stats page (counts, avg duration, top nudge types). Charts and latency p95 pending.
- [x] Access control using Clerk role claim.

## 7. UX Enhancements
- [x] Add a small inline status indicator on Practice page showing current ASR provider.
- [ ] Improve nudge visuals, de-duplicate similar nudges.
- [ ] Add report page with shareable link.

## 8. Deployment & Monitoring
- [ ] Add production build/deploy steps (Vercel/Amplify).
- [ ] Add CloudWatch alarms for error rates and latency.
- [ ] Rotate API keys via AWS Secrets Manager.
- [ ] Add a scheduled retention job; manual admin endpoint exists at `/api/admin/retention/run`.

## 9. Testing
- [ ] Unit tests for provider factories and prompt normalization.
- [ ] Integration test: mock ASR stream → nudges → session end → report stored.
- [ ] E2E smoke via Playwright: login, practice 10s, see nudges, open admin, toggle provider.

---

## Nice-to-haves
- [ ] Offline recording fallback and later sync.
- [ ] Export transcript as text/JSON.
- [ ] Multi-language ASR/coach toggle.
