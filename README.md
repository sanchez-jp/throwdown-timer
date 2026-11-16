# Throwdown Timer

A CrossFit WOD timer and workout library, designed as a Progressive Web App (PWA) and part of the Throwdown ecosystem.

Throwdown Timer will turn workout descriptions supplied as text or images into editable, structured timer configurations. Once interpreted, workouts can be saved and reused offline without calling AI again.

## Planned capabilities

- Import a WOD from pasted text, an uploaded image, or the phone camera.
- Review and edit the interpreted workout before starting.
- Run AMRAP, For Time, EMOM/E2MOM, Tabata, intervals, rounds, chippers, ladders, and compound workouts.
- Save, edit, duplicate, and delete workouts in a local library.
- Operate the timer offline with accurate elapsed-time calculations.
- Use AI only for interpretation; a deterministic timer engine executes validated configurations.

## Project status

**Early frontend prototype.** The current screen includes AMRAP, For Time, EMOM, and Tabata demos, optional audio cues (phase changes and final 10 seconds), fullscreen where supported, and screen-wake requests where supported. The For Time display distinguishes elapsed time from time remaining to its cap. These controls have not yet been browser-tested on real devices.

The initial product requirements and technical decisions are documented in [PROJECT_SPEC.md](PROJECT_SPEC.md). The version 1 WOD contract is defined in [docs/WOD_CONTRACT.md](docs/WOD_CONTRACT.md), with its machine-readable [JSON Schema](schemas/wod-v1.schema.json). Timer execution rules are documented in [docs/TIMER_STATE_MACHINE.md](docs/TIMER_STATE_MACHINE.md). The first dependency-free timer engine is in [src/timer-engine.js](src/timer-engine.js), with tests runnable via `npm test`.

## Planned technology

- Static frontend hosted on GitHub Pages.
- Browser storage with IndexedDB for the local workout library.
- Supabase Edge Function as a secure server-side AI proxy.
- Provider adapter to keep the AI provider replaceable.

No API secrets will be stored in the frontend repository.


## PWA and offline scope

The manifest and service worker use relative paths so the app can be hosted from a GitHub Pages project path. The service worker precaches the HTML shell, styles, JavaScript modules, manifest, and SVG app icon; navigation is network-first with a cached app-shell fallback. Cache versions are namespaced and older Throwdown Timer shell caches are removed on activation.

This is an app-shell offline baseline only. It does not yet provide offline WOD persistence; that arrives with the IndexedDB library. Service workers require HTTPS (or localhost), and installation/offline behavior still needs validation in supported browsers and on iPhone.


## Local WOD repository

The first IndexedDB repository is implemented in `src/workout-repository.js`. It stores version-1 WOD records with stable IDs and creation/update timestamps, validates timer plans through the timer engine, and supports list, get, create, update, duplicate, delete, and restore operations. Repository behavior is covered with an in-memory storage adapter in the Node test suite; browser-specific IndexedDB behavior still needs real-browser validation.
