# Architecture Decision Log

This file records decisions that affect the long-term direction of Throwdown Timer.

## ADR-001 — Independent repository

**Decision:** Keep Throwdown Timer in its own repository, separate from Throwdown Tracker.

**Reason:** Independent deployment and development reduce the risk of regressions in the existing Tracker application while allowing a shared visual identity.

## ADR-002 — AI interprets; timer engine executes

**Decision:** AI produces a validated, versioned workout configuration. The deterministic timer engine executes that configuration and never depends on an AI response at runtime.

**Reason:** Timer correctness, repeatability, offline operation, and testability must not depend on model availability or model behavior.

## ADR-003 — IndexedDB for the first local library

**Decision:** Use IndexedDB for saved workouts in the initial release. Cloud synchronization is deferred.

**Reason:** The library should be capable, structured, and offline-first without requiring account setup or a network connection.

## ADR-004 — Supabase Edge Function as AI proxy

**Decision:** Call AI through a server-side Supabase Edge Function. Provider credentials must remain server-side.

**Reason:** GitHub Pages is a static host and cannot safely store private API credentials.

## ADR-005 — Replaceable AI provider

**Decision:** Hide provider-specific behavior behind an adapter. Gemini 3.5 Flash-Lite is the provisional first prototype provider, subject to revalidation before implementation/release.

**Reason:** Pricing, quotas, model availability, privacy terms, and capabilities can change. The product's data contract and timer engine should not depend on one vendor.
