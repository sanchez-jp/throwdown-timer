# WOD v2 — Canonical examples

These examples are semantic workout records. The timer plan is independent and deliberately does not encode movement completion.

## 5 rounds for time

```json
{
  "schemaVersion": 2,
  "title": "5 RFT",
  "workout": {
    "format": "rounds_for_time",
    "description": "5 rounds for time",
    "movements": [
      {"id":"m1","name":"Deadlift","prescription":"10 reps","load":"60 kg","notes":null},
      {"id":"m2","name":"Box jump","prescription":"12 reps","load":null,"notes":null}
    ],
    "structure": {
      "type":"rounds",
      "count":5,
      "items":[
        {"type":"movement","movementId":"m1"},
        {"type":"movement","movementId":"m2"}
      ]
    }
  },
  "timer": {
    "type":"sequence",
    "label":"5 RFT",
    "blocks":[{"type":"countup","label":"For Time","timeCapSeconds":900,"rounds":5}]
  },
  "interpretation":{"status":"ready","issues":[]}
}
```

## Irregular ascending ladder

```json
{
  "schemaVersion": 2,
  "title": "Burpee ladder",
  "workout": {
    "format":"ladder",
    "description":"2, 5, 9 burpees",
    "movements":[{"id":"m1","name":"Burpee","prescription":null,"load":null,"notes":null}],
    "structure":{
      "type":"ladder",
      "direction":"custom",
      "steps":[
        {"label":"2 reps","items":[{"type":"movement","movementId":"m1","prescription":"2 reps"}]},
        {"label":"5 reps","items":[{"type":"movement","movementId":"m1","prescription":"5 reps"}]},
        {"label":"9 reps","items":[{"type":"movement","movementId":"m1","prescription":"9 reps"}]}
      ]
    }
  },
  "timer":{"type":"sequence","label":"Ladder","blocks":[{"type":"countup","label":"Ladder","timeCapSeconds":600,"rounds":null}]},
  "interpretation":{"status":"ready","issues":[]}
}
```

## Compound workout

```json
{
  "schemaVersion": 2,
  "title": "Strength + WOD",
  "workout": {
    "format":"strength_plus_wod",
    "description":"Strength followed by conditioning",
    "movements":[
      {"id":"m1","name":"Front squat","prescription":"5 x 3","load":null,"notes":null},
      {"id":"m2","name":"Wall ball","prescription":"AMRAP","load":"9 kg","notes":null}
    ],
    "structure":{
      "type":"sections",
      "sections":[
        {"id":"strength","name":"Strength","structure":{"type":"sequence","items":[{"type":"movement","movementId":"m1"}]}},
        {"id":"conditioning","name":"Conditioning","structure":{"type":"sequence","items":[{"type":"movement","movementId":"m2"}]}}
      ]
    }
  },
  "timer":{"type":"sequence","label":"Strength + WOD","blocks":[
    {"type":"countdown","label":"Strength","durationSeconds":600},
    {"type":"rest","label":"Rest","durationSeconds":180},
    {"type":"countdown","label":"AMRAP","durationSeconds":720}
  ]},
  "interpretation":{"status":"ready","issues":[]}
}
```

## Validation boundary

The domain validator checks movement IDs and references, nested structure integrity, round counts, ladder steps, section IDs, and format/structure compatibility. Timer-plan validity remains the timer engine's responsibility. A v2 WOD marked `ready` must have a timer plan and no blocking interpretation issues.
