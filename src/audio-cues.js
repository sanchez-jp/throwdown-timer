/**
 * Timed phases cue only the final three seconds before the next interval.
 */
export function getCountdownCueSecond(snapshot) {
  if (snapshot.state !== "running" ||
      snapshot.blockType === "countup" ||
      snapshot.phaseRemainingMs === null) return null;
  const second = Math.ceil(snapshot.phaseRemainingMs / 1000);
  return second >= 1 && second <= 3 ? second : null;
}
