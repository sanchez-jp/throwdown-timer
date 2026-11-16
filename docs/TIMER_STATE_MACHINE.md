# Timer State Machine — Version 1

This document defines the deterministic runtime behavior of the timer engine. It is the implementation contract for the timer domain module and its tests.

## 1. Separation of concerns

The timer engine receives a validated timer plan and a monotonic sequence of user commands. It does not parse workout text, call AI, access IndexedDB, or render UI.

The engine owns:
- Current overall state.
- Current executable block and nested sequence/repeat position.
- Current phase (work, rest, interval, or count-up).
- Start/pause accounting.
- Round and interval counters.
- Completion reason and elapsed time.

The UI displays a snapshot of engine state and sends commands. It must not maintain a second competing timer clock.

## 2. Overall states

| State | Meaning | Allowed commands |
|---|---|---|
| `idle` | Plan loaded, not started | start, reset |
| `running` | Clock is advancing | pause, reset, finish (count-up only), skip (if permitted) |
| `paused` | Clock is frozen | resume, reset, finish (count-up only), skip (if permitted by block policy) |
| `completed` | Plan finished normally or user finished a count-up | reset |
| `capped` | A count-up Time Cap was reached | reset |

A timer plan with a blocking interpretation issue, a null timer, or a failed validation must never enter `idle` as a startable plan.

## 3. Clock model (source of truth)

Never decrement a remaining-seconds variable as the source of truth.

For the active timed phase, maintain:
- `phaseStartedAt`: monotonic timestamp when the current phase began or resumed.
- `elapsedBeforePhase`: elapsed time accumulated before the current running slice.
- `pausedAt`: timestamp at which the current pause began, when paused.
- `durationMs`: fixed phase duration for countdown/work/rest phases, if applicable.

While running:

```text
phaseElapsedMs = elapsedBeforePhase + (nowMonotonic - phaseStartedAt)
```

For a countdown phase:

```text
remainingMs = max(0, durationMs - phaseElapsedMs)
```

For count-up:

```text
elapsedMs = phaseElapsedMs
```

On pause, calculate and store elapsed time, then stop advancing. On resume, set a new `phaseStartedAt` and preserve accumulated elapsed time. Reset clears all accumulated values.

Use `performance.now()` as the in-session monotonic clock where available. It is not a persistent timestamp and must not be assumed to survive page reloads. A wall-clock timestamp may be stored as a secondary reference for diagnostics/recovery, but must not replace monotonic time during an active session.

The UI may refresh its display on a periodic animation/tick. Each refresh derives the displayed time from the engine clock; missed UI ticks must never change elapsed time.

## 4. Backgrounding, visibility, and sleep

When the page becomes hidden, the engine does not pause automatically. A workout timer is expected to continue while the athlete looks away or the phone screen locks, subject to browser/device limitations.

When the page becomes visible again:
1. Read the current monotonic time.
2. Recompute the active phase elapsed/remaining time.
3. Process any phase boundaries that have passed.
4. Continue through multiple expired finite phases if necessary.
5. Publish one current snapshot, including any completion/cap event.

Do not assume a timer callback ran at the exact boundary. A delayed callback must catch up from elapsed time, not add one tick per missed callback.

If the browser destroys the page or the operating system suspends the web app such that the monotonic clock cannot be trusted across restoration, use a persisted wall-clock checkpoint to recover elapsed time, clearly handling device clock changes and documenting that browser/platform guarantees vary. The initial release does not promise uninterrupted background execution on every iOS version; it must at least correct the display and phase on foreground return.

## 5. Block execution rules

Before starting, compile nested `sequence` and `repeat` containers into an ordered execution cursor while retaining their source paths for labels and progress display. Compilation must enforce a maximum nesting depth and maximum expanded block count.

### countdown

- Starts at the configured duration and counts down to zero.
- At zero, emits a phase-completed event and advances automatically.
- It cannot be manually finished early.
- Manual skip is available only when `allowSkip: true`.

### countup

- Starts at zero and counts upward.
- With a null Time Cap, it continues until the user presses Finish.
- With a Time Cap, it stops at the cap and enters `capped`.
- Pressing Finish while running or paused enters `completed` with completion reason `user_finished`.
- Reaching the cap enters `capped` with completion reason `time_cap_reached`.
- A capped timer must not be represented as a normal athlete finish.

### emom / e2mom

- Total duration is divided into equal intervals.
- Validation requires `durationSeconds % intervalSeconds === 0` and `rounds === durationSeconds / intervalSeconds`.
- The first interval begins immediately at session start (there is no initial rest phase).
- Each interval boundary increments the interval/round number and resets the interval countdown.
- At total duration, the block completes. Do not create an extra interval after the last one.
- The UI displays both total time remaining and current interval time remaining.
- If `allowSkip: true`, Skip advances to the next interval boundary. It does not skip the entire workout. Skipping the final interval completes the block.

### intervals / Tabata

- Each round contains a work phase and, where `restSeconds > 0`, a rest phase.
- `startWithRest: false` starts with work; `true` starts with rest.
- Do not add a rest phase after the final work phase unless the plan explicitly models a final rest as a separate `rest` block.
- If `allowSkip: true`, Skip advances to the next phase (work to rest, rest to next work); if no next phase remains, the block completes.
- A zero-second rest means no rest phase is generated.

### rest

- Counts down and advances automatically at zero.
- Manual skip is available only when `allowSkip: true`.

### sequence / repeat

- `sequence` runs children in the declared order.
- `repeat` executes its child sequence exactly `repeatCount` times.
- Empty containers are invalid.
- A nested container completes only after all expanded child blocks complete.
- The parent plan completes only after its final executable block completes.

## 6. Commands and transition rules

### Start
- Valid only from `idle`.
- Starts the first executable phase at elapsed zero.
- If no executable phase exists after compilation, reject the plan before it reaches idle.

### Pause
- Valid only from `running`.
- Freeze the current elapsed value. No time may accrue while paused.

### Resume
- Valid only from `paused`.
- Resume the same phase from the preserved elapsed value.

### Finish
- Valid only for an active `countup` block and only while running or paused.
- Ends the workout as `completed`, not `capped`.

### Skip
- Valid only when the current block's `allowSkip` is true.
- Must follow the block-specific rules above.
- Skip is not the same as Finish: it advances the configured plan and retains the workout's normal completion semantics.

### Reset
- Valid from any state.
- Returns to `idle`, clears all elapsed/pause/round/phase progress, and positions the cursor at the first executable block.

Invalid commands are rejected without mutating the timer state.

## 7. Events and snapshot

The engine should emit domain events (or expose equivalent transition results) such as:
- `timer_started`
- `timer_paused`
- `timer_resumed`
- `phase_changed`
- `interval_changed`
- `block_completed`
- `timer_completed`
- `time_cap_reached`
- `timer_reset`
- `command_rejected`

A UI snapshot should include:
- Overall state.
- Current block label and type.
- Current phase label/type.
- Elapsed and remaining milliseconds for the current phase.
- Overall elapsed/remaining time where determinable.
- Current round and total rounds, when applicable.
- Current interval and total intervals, when applicable.
- Whether Pause, Resume, Finish, Skip, and Reset are currently available.
- Completion reason when finished.

The snapshot is derived from engine state; it is not a second source of truth.

## 8. Validation and boundary cases

The implementation must test:
- Zero/negative durations and invalid integer values.
- EMOM duration not divisible by interval duration.
- EMOM rounds inconsistent with duration/interval.
- Empty sequences and repeats.
- Excessive nesting or expanded block count.
- Zero rest and no final rest after last work phase.
- Pause/resume repeatedly without time drift.
- Finish on a count-up with and without a cap.
- Time Cap reached while the page is hidden.
- Multiple phase boundaries crossed while the page is hidden.
- Skip at the final interval/phase.
- Reset from running, paused, completed, and capped.
- Invalid commands for each state.
- Device/browser sleep and foreground recovery limitations.

## 9. Deliberate v1 limitations

- The app does not infer athlete progress through reps or movements. It times the workout and displays the movement prescription.
- A For Time clock cannot know when the athlete has completed the reps; the athlete presses Finish.
- The timer does not promise continuous execution after the browser process is terminated by the operating system.
- Haptic cues, synchronized team timing, and external hardware integrations are deferred.
