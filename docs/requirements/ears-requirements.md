# spasht – EARS Requirements

This document captures requirements using the EARS (Easy Approach to Requirements Syntax) patterns.

## Legend
- UBI: Ubiquitous requirement
- Event-Driven: When <event>, the <system> shall <response>
- State-Driven: While <state>, the <system> shall <response>
- Unwanted Behavior: If <undesired condition>, the <system> shall <response>
- Optional: Where <feature is available/flag>, the <system> shall <response>

---

## 1. Authentication & Authorization
- UBI: The system shall allow users to sign in and sign up using Clerk.
- UBI: The system shall restrict admin-only pages to users with the `admin` role claim.
- Unwanted: If a non-admin user accesses an admin endpoint or page, the system shall respond with HTTP 403 and show an access denied screen.
- Event-Driven: When a user signs out, the system shall invalidate their session and return to the landing page.

## 2. Audio Capture & ASR
- State-Driven: While a practice session is active, the system shall capture microphone input using the Web Audio API.
- UBI: The system shall compute an amplitude meter (RMS) at least 15 times per second for UI feedback.
- Optional: Where Web Speech API is supported, the system shall provide a browser-based STT fallback for development use only.
- Optional: Where the admin has selected the AWS Transcribe path, the system shall stream audio to AWS Transcribe and produce partial and final transcripts with timestamps.
- Optional: Where the admin has selected the Nova Sonic path, the system shall route audio to the Nova Realtime endpoint and produce partial and final transcripts equivalently.
- Unwanted: If the microphone permission is denied, the system shall show a clear error and a retry option.

## 3. Coaching & Feedback
- State-Driven: While receiving partial transcripts, the system shall generate nudges within 300–1500 ms from the time of receipt.
- UBI: The system shall display at most two concurrent nudges, each auto-dismissing within 3–4 seconds.
- Optional: Where the admin enables server-side coaching, the system shall call the Bedrock Nova text model to generate nudges based on the partial transcript.
- UBI: The system shall provide a post-session report summarizing strengths, improvements, and scores (fluency, clarity, confidence, filler rate, pace).
- Unwanted: If the coach model response is invalid JSON, the system shall fall back to defaults and log the parsing error.

## 4. Session Management
- Event-Driven: When a session starts, the system shall create a persistent `InterviewSession` record with the start time and user ID.
- State-Driven: While a session is active, the system shall persist periodic metrics (e.g., filler rate, pace, nudges shown).
- Event-Driven: When a session ends, the system shall finalize the session with end time, transcript, and computed metrics, and store a generated report.

## 5. Gamification
- Event-Driven: When a session result meets defined thresholds, the system shall award badges and update user progress.
- UBI: The system shall show a celebratory animation when a new badge is earned.

## 6. Admin Panel & Feature Flags
- UBI: The system shall provide an admin-only panel to toggle ASR provider (AWS Transcribe vs Nova Sonic) and coach options.
- UBI: The system shall persist the selected workflow so subsequent sessions use the chosen path.
- Unwanted: If the selected ASR provider is unavailable, the system shall fall back to the alternative if configured, or degrade gracefully to browser STT.

## 7. Analytics & Monitoring
- UBI: The system shall track key events (session start/stop, ASR latency, coach latency, nudge impressions) per user and session.
- UBI: The system shall provide aggregate metrics endpoints for admin dashboards.
- Optional: Where configured, the system shall export product analytics to Mixpanel/PostHog.

## 8. Security & Compliance
- UBI: The system shall store secrets in environment variables and not in source control.
- UBI: The system shall encrypt data at rest and in transit per AWS service defaults.
- UBI: The system shall restrict S3 and RDS access to least-privilege roles.

## 9. Performance & Reliability
- UBI: The system shall keep end-to-end latency for nudges under 1.5 s p95.
- UBI: The system shall maintain 99.5% uptime for API endpoints during business hours.
- Unwanted: If a backend service call exceeds a 5 s timeout, the system shall abort and surface a retriable error.

## 10. Accessibility & UX
- UBI: The system shall provide keyboard-accessible controls and ARIA live regions for nudge notifications.
- UBI: The system shall be responsive across mobile and desktop with a mobile-first layout.

