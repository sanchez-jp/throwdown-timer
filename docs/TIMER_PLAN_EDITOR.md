# Visual Timer Plan Editor

## Scope

The WOD editor creates an ordered sequence of timer blocks. Each block is independently configured and validated before the WOD can be marked ready.

Supported block types in the first visual editor:

- Countdown: fixed duration, optional manual skip.
- For Time: count-up with optional Time Cap and optional target rounds.
- EMOM/E2MOM: total duration and interval duration. Rounds are calculated and must be an exact quotient.
- Intervals: rounds, work duration, rest duration, optional start-with-rest and skip behavior.
- Rest: explicit timed rest, optional manual skip.

Blocks can be added, deleted, and moved up/down. The timer engine remains the source of truth for runtime behavior.

## Validation and safe drafts

- Every required duration must be entered explicitly in minutes/seconds.
- An interval rest must be entered explicitly; enter `0` seconds to define no rest.
- An EMOM total duration must be an exact multiple of its interval.
- A blank Time Cap means an uncapped For Time block.
- A WOD with no timer blocks is saved as `needs_review` with a blocking `TIMER_PLAN_REQUIRED` issue.
- The same `TimerEngine` validates the sequence before it is persisted.
- For Time/count-up must be the final segment in this editor version. The current engine's Finish and Time Cap states end the timer session; allowing a later segment would be misleading.

## Current limitation

The first visual editor flattens existing nested `sequence` and `repeat` containers into an ordered list of executable blocks. It does not yet offer visual group/repeat controls or preserve those container boundaries when a plan is edited. More advanced nested editing can be added without changing the timer block vocabulary.
