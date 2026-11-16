# Throwdown Timer — Product & Technical Specification

**Status:** Living specification — initial version  
**Repository:** `sanchez-jp/throwdown-timer`  
**Product family:** Throwdown  
**Last updated:** 2026-11-16

## 1. Product vision

Throwdown Timer is an independent CrossFit workout timer and WOD library. It shares the visual identity and interaction principles of Throwdown Tracker, but it must be developed and deployed independently so changes cannot break Tracker.

The app should make it quick to turn a WOD description into a reliable timer, whether the workout is typed, copied, photographed, or uploaded as an image.

## 2. Core user journey

1. Open the app and choose a saved WOD or create a new one.
2. For a new WOD, paste/type its description, upload an image, or take a photo with the phone camera.
3. Send the source to the AI interpretation endpoint.
4. Receive structured data that conforms to the versioned WOD contract.
5. Review and correct the interpretation in an editable preview.
6. Resolve any missing, ambiguous, or contradictory details.
7. Save the WOD to the local library.
8. Start the timer. Previously saved WODs must not require another AI request.

The timer engine must not depend on the AI service.

## 3. Workout formats and timer capabilities

The model must support both simple timers and ordered sequences of timer segments.

Initial format catalogue:

- **AMRAP:** countdown; display remaining time; finish alert.
- **For Time:** count up; optional Time Cap; allow early completion.
- **EMOM / E2MOM:** total session time, current interval, interval countdown, round number.
- **Tabata:** alternating work and rest periods, configurable rounds.
- **Intervals:** configurable work/rest durations and repetitions.
- **Rounds / RFT:** repeated workout blocks, optionally with a total Time Cap.
- **Chipper:** ordered list of movements and reps, normally count-up with optional cap.
- **Ladder / Death by:** increasing or decreasing work prescription by round/interval.
- **Compound workouts:** multiple ordered segments, each with its own timer behavior and optional rest.
- **Strength + WOD:** separate strength and conditioning blocks, each with its own timing rules.
- **Variable intervals / multiple caps:** segments can have different durations and time limits.

The data model must not assume that every WOD is a single countdown.

## 4. Timer controls and runtime behavior

Required controls and options:

- Start, pause, resume, and reset.
- Skip current interval/segment only where the workout definition allows it.
- Sound on/off.
- Optional final-10-second cues.
- Fullscreen mode.
- Request that the screen remain awake where supported by the browser/device.
- Clear visual indication of current segment, round, work/rest state, and remaining/elapsed time.

### Timing accuracy

Do not implement the timer by decrementing a counter on every `setInterval` tick. Browsers throttle timers in background tabs and on mobile devices.

Store the relevant start timestamp and accumulated paused duration, then derive elapsed/remaining time from the current clock. Reconcile the display when the page becomes visible again. The display may refresh periodically, but the source of truth must be timestamps.

The app must handle pause/resume and background/foreground transitions without silently losing elapsed time.

## 5. WOD interpretation by AI

AI is an interpreter, not the timer runtime.

### Input types

- Plain text.
- Uploaded image.
- Photo captured with the mobile camera.

Compress and validate images client-side before upload. Enforce supported formats and request-size limits on the server.

### Output contract

The AI must return JSON only, conforming to a versioned schema owned by this project. It must never return executable HTML, JavaScript, or other code.

The application must validate the result programmatically before it can be used by the timer. Validation must cover required fields, data types, ranges, supported segment types, and internal consistency.

Do not rely on a model-generated confidence score as the sole safety check. Track explicit interpretation status, for example:

- `ready`: required information is present and validation passes.
- `needs_review`: ambiguity, contradiction, or uncertain interpretation needs user confirmation.
- `invalid`: output cannot be used until corrected.

If a required duration is missing, ask the user rather than inventing one. Example: `EMOM / 10 Burpees` without a duration must be flagged as incomplete.

If the description contains conflicting timing instructions, flag the conflict. Example: `AMRAP 12'` together with `Time Cap 15'` requires review.

A For Time workout without a Time Cap is a valid count-up timer.

The user must be able to edit the interpreted configuration before starting and save the corrected version.

## 6. Local workout library and offline behavior

Use IndexedDB for the initial local library rather than relying on localStorage for the primary data store.

Each saved workout should include, at minimum:

- Stable UUID.
- Workout name/title.
- Original source text.
- Optional original image (subject to storage limits and user choice).
- Normalized timer configuration JSON.
- Schema version.
- Created and updated timestamps.

Users must be able to list, open, edit, duplicate, and delete saved WODs. The library and timer engine must work offline after the app and workout data have been cached/stored.

A later optional synchronization layer may use Supabase. Do not make cloud synchronization a prerequisite for the first usable version.

## 7. Architecture

### Frontend

- Static HTML, CSS, and JavaScript hosted independently on GitHub Pages.
- Responsive/mobile-first interface and PWA installability.
- Reuse the Throwdown Tracker design language without coupling the codebases.
- Suggested visual tokens based on Tracker:
  - Background: `#0b1018`
  - Panel: `#151d28`
  - Line: `#2b3a4d`
  - Muted text: `#9aa9ba`
  - Main text: `#eef4fb`
  - Lime accent: `#c9f23d`
  - Cyan accent: `#55dfc7`

### Timer/domain layer

Keep the timer engine deterministic and independent of UI components, storage, network access, and AI. It consumes validated configuration and exposes state transitions suitable for rendering and testing.

### Backend / AI

Use a Supabase Edge Function as the server-side proxy for the AI provider. Never expose provider API keys in browser code or repository files.

Keep provider-specific request/response handling behind an adapter so providers can be changed without rewriting the timer engine or WOD contract.

Each WOD interpretation should be an independent request. Do not maintain a conversational history or send previous WODs as chat context.

### Initial AI provider direction

Gemini 3.5 Flash-Lite was selected as the provisional first provider for prototyping because of multimodal input and structured-output support. This is a provisional implementation choice, not a permanent dependency. Keep the provider replaceable and re-check current model availability, pricing, quotas, privacy terms, and structured-output behavior before production use.

Do not send sensitive/private workout data to a provider without reviewing the applicable data terms and making the trade-off clear.

## 8. Security, resilience, and cost controls

- Store provider secrets only as Supabase Edge Function secrets.
- Never commit secrets, tokens, service-role keys, or private credentials.
- Validate and limit image size/type before forwarding.
- Apply request limits/rate limiting and reasonable timeouts.
- Use bounded retries; avoid retry loops.
- Return clear, actionable errors to the UI.
- Log operational metadata without unnecessarily retaining workout content or images.
- Consider authentication or another abuse-control mechanism before public launch.
- Ensure the frontend can still open the library and run saved WODs if the AI endpoint is unavailable.

## 9. Non-functional requirements

- Mobile-first, usable on iPhone and desktop.
- Accessible contrast and readable timer typography.
- Fast startup and minimal dependencies.
- Offline access to the app shell and saved WODs.
- Deterministic timer behavior and testable domain logic.
- Explicit schema versioning and migration strategy.
- Clear distinction between original WOD source and normalized editable configuration.

## 10. Delivery roadmap

### Phase 0 — Product contract and architecture
- [x] Create independent public repository.
- [x] Record product requirements and technical direction.
- [x] Define the formal WOD JSON schema and canonical examples (see `schemas/wod-v1.schema.json` and `docs/WOD_CONTRACT.md`).
- [x] Define timer state machine and segment transition rules (see `docs/TIMER_STATE_MACHINE.md`).
- [x] Define interpretation validation and review rules at the contract level; implement executable validators in a later phase.

### Phase 1 — Frontend foundation
- [x] Establish app shell and responsive visual system.
- [x] Create initial home screen navigation.
- [x] Create WOD library screen and empty states.
- [x] Add PWA manifest and service worker baseline.

The PWA baseline precaches the app shell and falls back to cached HTML for offline navigation. The initial IndexedDB library is integrated into the UI for saving and reusing demo WODs. Real-device installation and offline validation are still outstanding.

### Phase 2 — Timer engine (no AI dependency)
- [ ] Implement timestamp-based clock.
- [x] Implement countdown and count-up modes in the timer engine.
- [x] Implement EMOM/E2MOM, Tabata, and configurable intervals in the timer engine.
- [x] Implement ordered compound segments, pause/resume/reset, and permitted skip behavior in the timer engine; visual editor currently edits flat ordered segments.
- [x] Add audio cues, fullscreen, and screen-wake support where available (browser/device support varies).
- [ ] Test audio, fullscreen, and Wake Lock behavior on iPhone Safari and supported desktop browsers.
- [ ] Test background/foreground behavior on mobile browsers.

### Phase 3 — WOD library
- [x] Implement IndexedDB repository (list/get/create/update/duplicate/delete/restore API).
- [x] Add save-from-demo, duplicate, delete, and restore/undo behavior.
- [x] Add editing for saved WOD title, format, description, and movement prescriptions.
- [x] Add manual WOD creation and save new WODs as drafts pending timer configuration.
- [x] Add a first visual timer-plan editor for ordered countdown, count-up, EMOM/E2MOM, intervals, and rest blocks; validate plans with the timer engine.
- [ ] Extend the editor with nested repeat/group editing and advanced compound-block semantics.
- [ ] Verify offline access and schema migrations.

### Phase 4 — AI interpretation
- [ ] Implement strict versioned JSON contract.
- [ ] Implement Supabase Edge Function proxy.
- [ ] Implement provider adapter and initial Gemini integration.
- [ ] Add text, image upload, and camera capture.
- [ ] Validate output and present review/correction UI.
- [ ] Verify that saved WODs never trigger unnecessary AI calls.

### Phase 5 — Hardening and release
- [ ] Test representative simple and compound WODs.
- [ ] Test ambiguous, incomplete, and contradictory descriptions.
- [ ] Test malformed AI responses, network errors, and rate limits.
- [ ] Review privacy, security, and provider costs.
- [ ] Configure GitHub Pages deployment.
- [ ] Validate installability and offline behavior on iPhone.

## 11. Working principles

1. Preserve this document as the living source of truth; update it when decisions change.
2. Build and test in small, reviewable increments.
3. Do not couple the timer engine to a specific AI provider.
4. Do not let AI output execute code or bypass validation.
5. Do not invent missing WOD details.
6. Prefer a reliable timer and usable local library before adding cloud sync or advanced AI features.
