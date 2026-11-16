# WOD v1 → v2 migration

Migration is explicit and opt-in through `repository.migrateToV2(id)`. It updates the stored record in place only after conversion and v2 validation succeed.

## Preserved data

- Record ID, title, source text, creation timestamp, and last-updated timestamp.
- Original timer plan, unchanged.
- Movement order, names, prescriptions, loads, and notes.
- Existing interpretation issues.

Movement IDs are generated deterministically within the record as `legacy-movement-1`, `legacy-movement-2`, and so on. The structure references those IDs in the original movement order.

## Safe mappings

| v1 format | v2 structure | Condition |
|---|---|---|
| AMRAP, For Time, EMOM, E2MOM, Tabata, Intervals | sequence | Movement order is retained; no rounds are inferred |
| Chipper | chipper | Array order is explicit |
| Rounds for Time | rounds | Only when a positive round target exists in the saved count-up timer |

## Ambiguous formats

Ladder, Death By, Strength + WOD, and RFT without an explicit round target are migrated to a `custom` sequence and marked `needs_review`. Their original format is retained in `workout.legacyFormat`, and a warning explains that the structure needs user confirmation.

The migration never parses free-text descriptions to invent round counts, ladder steps, rep schemes, or section boundaries.

## Failure behavior

- A non-v1 record is rejected.
- A record without movements or with a movement lacking a name is rejected.
- A failed conversion or validation does not write any changes.
- The repository record is replaced only after the migrated record passes v2 and timer validation.

Migration is not automatic on application startup. The UI should later show the user which records need migration/review and request confirmation before invoking it.
