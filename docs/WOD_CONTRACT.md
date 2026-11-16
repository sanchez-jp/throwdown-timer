# WOD JSON Contract — Version 1

This document defines the boundary between AI interpretation, the editable workout review screen, local persistence, and the timer engine.

The machine-readable schema is [wod-v1.schema.json](../schemas/wod-v1.schema.json).

## 1. Design principles

1. The AI returns structured workout data, never executable code.
2. The timer engine consumes only validated timer plans.
3. Workout content and timer behavior are separate: movement prescriptions describe what the athlete does; timer blocks describe when the app counts, cues, rests, or advances.
4. Missing information is represented as an issue, not guessed.
5. The application creates its own UUIDs and timestamps after accepting the interpretation. The AI must not generate these values.
6. The schema is versioned. Existing saved workouts retain the schema version they were created with and are migrated explicitly.

## 2. Top-level response

- `schemaVersion`: currently `1`.
- `title`: human-readable workout title.
- `workout`: workout format, description, and movement prescriptions.
- `timer`: a timer plan, or `null` when essential timing information is missing or contradictory.
- `interpretation`: status and actionable issues.

Interpretation status:
- `ready`: all required timer information is present and validation succeeds.
- `needs_review`: the user must confirm or correct one or more ambiguities/warnings.
- `invalid`: no safe executable plan can be produced.

A `blocking` issue prevents starting the timer until corrected. A `warning` requires review but may not prevent execution once the user confirms it.

## 3. Timer block vocabulary

Timer plans are ordered sequences. Blocks can be nested to represent compound workouts.

| Block | Behavior | Main fields |
|---|---|---|
| `countdown` | Counts down a fixed duration | `durationSeconds` |
| `countup` | Counts up, optionally stopping at a cap | `timeCapSeconds`, optional `rounds` |
| `emom` | Repeating interval cues over a total duration | `durationSeconds`, `intervalSeconds`, `rounds` |
| `intervals` | Repeated work/rest periods | `rounds`, `workSeconds`, `restSeconds` |
| `rest` | Explicit timed rest | `durationSeconds` |
| `repeat` | Repeats a nested block sequence | `repeatCount`, `blocks` |
| `sequence` | Runs nested blocks in order | `blocks` |

An E2MOM is represented as an `emom` block with `intervalSeconds: 120`. Tabata is represented by an `intervals` block, commonly 8 rounds of 20 seconds work and 10 seconds rest. These are representations, not hard-coded assumptions: use the values actually stated in the source.

## 4. Canonical examples

### AMRAP 12 minutes

```json
{
  "schemaVersion": 1,
  "title": "AMRAP 12'",
  "workout": {
    "format": "amrap",
    "description": "Complete as many rounds as possible in 12 minutes.",
    "movements": [
      {"name": "Burpee", "prescription": "10 reps", "load": null, "notes": null},
      {"name": "Pull-up", "prescription": "10 reps", "load": null, "notes": null}
    ]
  },
  "timer": {
    "type": "sequence",
    "label": "AMRAP 12'",
    "blocks": [
      {"type": "countdown", "label": "AMRAP", "durationSeconds": 720}
    ]
  },
  "interpretation": {"status": "ready", "issues": []}
}
```

### For Time, 5 rounds, Time Cap 15 minutes

```json
{
  "schemaVersion": 1,
  "title": "5 RFT",
  "workout": {
    "format": "rounds_for_time",
    "description": "Complete 5 rounds for time.",
    "movements": [
      {"name": "Deadlift", "prescription": "10 reps", "load": "60 kg", "notes": null}
    ]
  },
  "timer": {
    "type": "sequence",
    "label": "5 RFT",
    "blocks": [
      {"type": "countup", "label": "For Time", "timeCapSeconds": 900, "rounds": 5}
    ]
  },
  "interpretation": {"status": "ready", "issues": []}
}
```

### EMOM 10 minutes

```json
{
  "schemaVersion": 1,
  "title": "EMOM 10'",
  "workout": {
    "format": "emom",
    "description": "10-minute every-minute-on-the-minute workout.",
    "movements": [
      {"name": "Burpee", "prescription": "10 reps", "load": null, "notes": null}
    ]
  },
  "timer": {
    "type": "sequence",
    "label": "EMOM 10'",
    "blocks": [
      {"type": "emom", "label": "EMOM", "durationSeconds": 600, "intervalSeconds": 60, "rounds": 10}
    ]
  },
  "interpretation": {"status": "ready", "issues": []}
}
```

### Compound workout: strength, rest, then AMRAP

```json
{
  "schemaVersion": 1,
  "title": "Strength + WOD",
  "workout": {
    "format": "strength_plus_wod",
    "description": "Strength block followed by a conditioning AMRAP.",
    "movements": [
      {"name": "Front squat", "prescription": "5 x 3", "load": null, "notes": "Strength block"},
      {"name": "Wall ball", "prescription": "As many rounds as possible", "load": "9 kg", "notes": "AMRAP block"}
    ]
  },
  "timer": {
    "type": "sequence",
    "label": "Strength + WOD",
    "blocks": [
      {"type": "countdown", "label": "Strength block", "durationSeconds": 600},
      {"type": "rest", "label": "Rest", "durationSeconds": 180},
      {"type": "countdown", "label": "AMRAP", "durationSeconds": 720}
    ]
  },
  "interpretation": {"status": "ready", "issues": []}
}
```

## 5. Missing and contradictory information

The interpreter must not invent a duration, interval count, load, rep scheme, or Time Cap.

Examples:
- `EMOM / 10 Burpees` with no duration: `timer: null`, status `needs_review`, blocking issue asking for the total duration.
- `AMRAP 12' / Time Cap 15'`: flag the contradiction and request confirmation; do not silently choose one.
- For Time with no Time Cap: valid count-up block with `timeCapSeconds: null`.
- If the movement list is incomplete but timing is clear, preserve the known timing and report a warning or blocking issue according to whether the missing movement data prevents the user from understanding the workout.

## 6. Application-side validation rules

JSON Schema validation is necessary but not sufficient. The application must additionally verify:

- For an `emom` block, `durationSeconds` is divisible by `intervalSeconds`, and `rounds` equals the quotient.
- All durations and interval counts are positive integers; rest duration may be zero.
- A zero-rest interval does not create an extra rest phase after the final work phase.
- A count-up block with a null cap runs until the user finishes it.
- A capped count-up stops at the cap but should clearly distinguish cap reached from user completion.
- Nested blocks are non-empty and nesting depth is limited to prevent pathological payloads.
- Total computed duration is checked for overflow and reasonable upper bounds.
- A `ready` plan has no blocking issues.
- A `null` timer cannot be started.
- User edits are revalidated before saving or starting.

## 7. Important modeling boundary

Version 1 stores movement prescriptions as readable text instead of trying to normalize every possible CrossFit rep scheme. For example, `21-15-9`, `10 reps each round`, `max reps`, and `5 sets x 3 reps` remain explicit text. This avoids losing meaning while the timer engine remains focused on time and sequence behavior.

Later versions may add structured rep schemes, equipment, scaling, athlete/team modes, synchronized work, and scoring. These additions must be versioned and must not break the timer engine's stable block vocabulary.


## 8. Manual skip policy

Timed leaf blocks may include the optional boolean `allowSkip`. If omitted, it defaults to `false`.

- On `countdown` and `rest`, Skip advances past the entire current block only when enabled.
- On `emom`, Skip advances to the next interval boundary, not to the end of the workout.
- On `intervals`, Skip advances to the next work/rest phase.
- `countup` is completed with the Finish command; Skip is not a substitute for Finish.
- Sequence and repeat containers are structural and do not have their own skip flag.

The timer engine must enforce this policy even if the UI accidentally displays a Skip control.


## 9. Version 2 semantic workout model

Version 2 adds a semantic structure to the workout while keeping timer blocks independent. Its schema is [wod-v2.schema.json](../schemas/wod-v2.schema.json), canonical examples are in [WOD_V2_EXAMPLES.md](WOD_V2_EXAMPLES.md), and the design rationale is in [WOD_MODEL_V2_DESIGN.md](WOD_MODEL_V2_DESIGN.md).

The v2 movement catalogue assigns stable IDs to movements. Structure nodes reference those IDs and represent ordered sequences, explicit rounds, chippers, ladders with explicitly stored steps, and named compound sections. The application validates references and format/structure compatibility before persistence.

The repository accepts v1 and v2 records side by side. Existing v1 records are not silently rewritten or migrated. A v2 record marked ready must have a valid timer plan; timer-plan validation remains the timer engine's responsibility. Explicit workout progress tracking is not part of this version.
