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

**Early frontend prototype.** The current screen includes AMRAP, For Time, EMOM, and Tabata demos, a local IndexedDB library with save/open/duplicate/delete/undo actions, optional audio cues (phase changes and final 10 seconds), fullscreen where supported, and screen-wake requests where supported. The For Time display distinguishes elapsed time from time remaining to its cap. These controls have not yet been browser-tested on real devices.

The initial product requirements and technical decisions are documented in [PROJECT_SPEC.md](PROJECT_SPEC.md). The WOD contracts are defined in [docs/WOD_CONTRACT.md](docs/WOD_CONTRACT.md): [version 1 schema](schemas/wod-v1.schema.json) and [version 2 semantic schema](schemas/wod-v2.schema.json). Version 2 adds explicit workout structure, movement references, rounds, chippers, ladders, and compound sections while preserving the independent timer plan. See the [v2 design](docs/WOD_MODEL_V2_DESIGN.md) and [canonical examples](docs/WOD_V2_EXAMPLES.md). Timer execution rules are documented in [docs/TIMER_STATE_MACHINE.md](docs/TIMER_STATE_MACHINE.md). The first dependency-free timer engine is in [src/timer-engine.js](src/timer-engine.js), with tests runnable via `npm test`.

## Planned technology

- Static frontend hosted on GitHub Pages.
- Browser storage with IndexedDB for the local workout library.
- Supabase Edge Function as a secure server-side AI proxy.
- Provider adapter to keep the AI provider replaceable.

No API secrets will be stored in the frontend repository.


## PWA and offline scope

The manifest and service worker use relative paths so the app can be hosted from a GitHub Pages project path. The service worker precaches the HTML shell, styles, JavaScript modules, manifest, and SVG app icon; navigation is network-first with a cached app-shell fallback. Cache versions are namespaced and older Throwdown Timer shell caches are removed on activation.

This is an app-shell offline baseline. Saved WODs are persisted locally with IndexedDB. Service workers require HTTPS (or localhost), and installation/offline behavior still needs validation in supported browsers and on iPhone.


## Local WOD repository

The first IndexedDB repository is implemented in `src/workout-repository.js`. It stores version-1 WOD records with stable IDs and creation/update timestamps, validates timer plans through the timer engine, and supports list, get, create, update, duplicate, delete, and restore operations. The first UI integration lets users save the selected demo WOD, browse saved entries, open executable WODs, edit titles/formats/descriptions/movements, duplicate, delete, and undo the latest deletion. Repository behavior is covered with an in-memory storage adapter in the Node test suite; browser-specific IndexedDB behavior still needs real-browser validation.

## Visual timer-plan editor

The WOD editor now includes an ordered timer-block builder. It supports countdown blocks, count-up/For Time blocks with an optional Time Cap, EMOM/E2MOM intervals, work/rest intervals, explicit rest blocks, and nested repeat groups. Groups can contain ordered timer blocks and can be repeated up to 1,000 times. The complete plan is validated by the same deterministic TimerEngine used at runtime before it is saved.

Durations are entered explicitly in minutes and seconds. EMOM rounds are derived from total duration divided by interval length and must divide evenly. Interval rest must be entered explicitly (including 0 when no rest is intended). A WOD with no configured timer remains a draft and cannot be started. For Time/count-up must be the final expanded segment because Finish and Time Cap end the timer session. RFT and ladder formats use the count-up timer; round/repetition progress is not inferred or tracked automatically.
