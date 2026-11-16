# Visual Timer Plan Editor

## Scope

The WOD editor creates an ordered timer plan. It supports:

- Countdown: fixed duration and optional manual skip.
- For Time: count-up with optional Time Cap and optional target rounds.
- EMOM/E2MOM: total duration and interval duration. Rounds are calculated and must be an exact quotient.
- Intervals: rounds, work duration, rest duration, optional start-with-rest and skip behavior.
- Rest: explicit timed rest and optional manual skip.
- Repeat groups: an ordered collection of blocks repeated a configured number of times. Groups may contain nested groups.

Blocks and groups can be added, removed, and reordered within their own sequence. The timer engine remains the source of truth for runtime behavior.

## Validation and safe drafts

- Every required duration must be entered explicitly in minutes/seconds.
- An interval rest must be entered explicitly; enter `0` seconds to define no rest.
- An EMOM total duration must be an exact multiple of its interval.
- A blank Time Cap means an uncapped For Time block.
- A repeat group must contain at least one block and repeat between 1 and 1,000 times.
- Expanded timer plans are still bounded by the timer engine's phase limit and nesting-depth limit.
- A WOD with no timer blocks is saved as `needs_review` with a blocking `TIMER_PLAN_REQUIRED` issue.
- The same `TimerEngine` validates the complete nested plan before it is persisted.
- For Time/count-up must be the final expanded segment. Finish and Time Cap end the timer session, so a later block would never execute.
- A count-up block cannot be inside a group repeated more than once for the same reason.

## RFT and ladders

RFT and ladder workouts use a count-up/For Time timer, optionally with a Time Cap. For RFT, the target round count can be stored as descriptive metadata. The timer does not automatically detect completed rounds, reps, or ladder steps; those require explicit athlete input or a future progress-tracking feature. The displayed round value is therefore not fabricated.

## Preservation

Existing nested repeat groups are loaded without flattening and can be edited while preserving their grouping structure. The editor currently supports sequence and repeat containers; other future group semantics can be added without changing the timer block vocabulary.
