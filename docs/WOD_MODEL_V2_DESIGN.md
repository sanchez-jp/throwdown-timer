# WOD Semantic Model — Version 2 Design

**Status:** Proposed design; not yet implemented.  
**Scope:** Separate the meaning and scoring structure of a workout from the timer plan that measures it.

## 1. Why a new version is needed

WOD contract v1 stores `workout.format`, a flat list of movements with free-text prescriptions, and an independent timer plan. This is safe and flexible, but it loses important relationships:

- A 5-round RFT is represented as a flat movement list plus a count-up timer.
- A ladder's progression (for example, 2-4-6-8-10) is only readable text.
- A chipper's movement order is implicit in array order, with no explicit structure node.
- Compound workouts cannot reliably express which movements belong to which timed or untimed section.

The timer must not infer rounds, ladder steps, rep counts, or scoring progress from labels or descriptions.

## 2. Core decision

Keep three independent layers:

1. **Workout identity and meaning** — format, movements, prescriptions, order, rounds, ladder steps, and sections.
2. **Timer plan** — countdowns, count-ups, intervals, rests, and repeat timing blocks. It remains the only input to the timer engine.
3. **Interpretation/review** — whether the source was understood, what needs confirmation, and which fields are uncertain.

The workout structure describes what the athlete must complete. The timer plan describes how time is measured and announced. Neither layer is derived implicitly from the other.

## 3. Versioning and compatibility

- Do not change the meaning or required fields of schema v1.
- Introduce schema v2 as a separate contract and schema file.
- New v2 records use `schemaVersion: 2`.
- Existing v1 records remain readable and executable without migration being required immediately.
- Add an explicit, tested v1-to-v2 migration only after the v2 shape and UI are stable. Migration must preserve the original source text, movement text, timer plan, IDs, and timestamps.
- Repository validation must dispatch by schema version rather than silently accepting a v2 record as v1.

## 4. Proposed v2 workout shape

The v2 `workout` keeps the existing `format`, `description`, and movement catalogue, and adds a required semantic `structure`.

### Movement catalogue

Each movement receives a stable ID within the workout. Its name, load, notes, and human-readable prescription remain editable. The prescription remains text in the first v2 increment; structured rep arithmetic is deliberately deferred until its scope is clear.

Example:

```json
{
  "id": "m1",
  "name": "Thruster",
  "prescription": "21 reps",
  "load": "42.5 kg",
  "notes": null
}
```

### Structure nodes

The initial v2 structure vocabulary should be deliberately small:

- `movement`: references one catalogue movement by ID and may override its prescription for this occurrence.
- `sequence`: ordered child nodes; used when order matters.
- `rounds`: a positive, explicit round count and ordered child nodes.
- `chipper`: ordered one-pass child nodes; no round count is implied.
- `ladder`: explicit ordered steps. Each step contains its own ordered child nodes, so increasing/decreasing prescriptions are represented without guessing a formula.
- `sections`: ordered named parts for compound workouts (for example, strength, rest, conditioning). Each section has its own structure node.

A structure node never contains timer durations or time caps. Those stay in the independent timer plan.

### Example: 5 rounds for time

```json
{
  "format": "rounds_for_time",
  "description": "5 rounds for time",
  "movements": [
    {"id":"m1","name":"Deadlift","prescription":"10 reps","load":"60 kg","notes":null}
  ],
  "structure": {
    "type":"rounds",
    "count":5,
    "items":[
      {"type":"movement","movementId":"m1"}
    ]
  }
}
```

### Example: ascending ladder

```json
{
  "format": "ladder",
  "description": "Ascending ladder",
  "movements": [
    {"id":"m1","name":"Burpee","prescription":null,"load":null,"notes":null}
  ],
  "structure": {
    "type":"ladder",
    "direction":"ascending",
    "steps":[
      {"label":"Step 1","items":[{"type":"movement","movementId":"m1","prescription":"2 reps"}]},
      {"label":"Step 2","items":[{"type":"movement","movementId":"m1","prescription":"4 reps"}]},
      {"label":"Step 3","items":[{"type":"movement","movementId":"m1","prescription":"6 reps"}]}
    ]
  }
}
```

This is the accepted approach: store the stated steps explicitly and in order, rather than deriving them from a start/increment/end formula. The UI may offer a helper to generate steps, but the saved contract always contains the explicit result. This supports ascending, descending, alternating, and irregular ladders without losing the source prescription.

## 5. Progress tracking is a separate capability

A semantic structure makes progress tracking possible, but does not itself mean progress is tracked.

A later feature may let the athlete explicitly mark:
- completed rounds;
- completed ladder steps;
- completed movements or sections.

The app must never advance progress based on elapsed time, timer phase changes, or an assumed work rate. The timer and workout progress remain separate state machines.

## 6. Validation rules

The v2 validator should enforce at least:

- Every movement ID is non-empty and unique within the workout.
- Every structure movement reference resolves to exactly one catalogue movement.
- Round counts are positive integers.
- Sequences, rounds, chippers, sections, and ladder steps are non-empty.
- Ladder direction is explicit and each step has a label or stable position.
- A chipper's order is the stored item order.
- Compound sections have unique stable IDs, names, and valid child structures.
- Format and structure type are compatible (for example, `rounds_for_time` with `rounds`, `ladder` with `ladder`).
- Timer-plan validation remains delegated to the existing timer engine and builder.
- A v2 `ready` interpretation cannot contain blocking issues or a missing timer plan.

The exact compatibility matrix should live alongside the JSON Schema and be covered by domain tests; JSON Schema alone cannot validate cross-references or all format/structure relationships.

## 7. Delivery sequence

1. Review and freeze the v2 semantic vocabulary.
2. Add `schemas/wod-v2.schema.json` and canonical contract examples.
3. Add version-aware domain validation and repository round-trip tests.
4. Add v1-to-v2 migration tests; retain v1 compatibility.
5. Extend the editor to display and edit structure without flattening it.
6. Add explicit progress tracking as a separate feature.
7. Only then connect AI interpretation to the stable v2 contract.

## 8. Non-goals for the first v2 increment

- Automatically detecting rounds, reps, or completed ladder steps.
- Inferring missing reps, loads, round counts, or time caps.
- Replacing the timer plan with the semantic structure.
- Fully normalizing every possible rep scheme into arithmetic.
- Adding athlete/team scoring or synchronized movement behavior.
