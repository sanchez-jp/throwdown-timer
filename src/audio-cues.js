/**
 * Returns the second at which the UI should play a countdown cue.
 * Interval work/rest phases (Tabata) only cue at 3, 2 and 1.
 * Other timed phases retain the 10-second countdown.
 */
export function getCountdownCueSecond(snapshot) {
  if (snapshot.state !== "running" ||
      snapshot.blockType === "countup" ||
      snapshot.phaseRemainingMs === null) return null;

  const isIntervalPhase =
    (snapshot.blockType === "intervals" && snapshot.phase === "work") ||
    (snapshot.blockType === "rest" && snapshot.phase === "rest");
  const lastCueSecond = isIntervalPhase ? 3 : 10;
  const second = Math.ceil(snapshot.phaseRemainingMs / 1000);
  return second >= 1 && second <= lastCueSecond ? second : null;
}
