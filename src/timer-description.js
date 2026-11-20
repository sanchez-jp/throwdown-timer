/**
 * Groups timer work/rest phases against the ordered intervals in a ladder.
 * Work can be represented by either an intervals block or repeated countdown
 * blocks; phase indexes remain those of TimerEngine for live highlighting.
 */
export function getIntervalPhaseGroups(phases, intervalCount) {
  if (!Array.isArray(phases) || !Number.isInteger(intervalCount) || intervalCount < 1) return null;
  const schedule = phases.filter(phase =>
    phase && (phase.type === "intervals" || phase.type === "countdown" || phase.type === "rest")
  );
  if (schedule.filter(phase => phase.type !== "rest").length !== intervalCount) return null;

  const groups = [];
  let leadingRest = [];
  schedule.forEach(phase => {
    if (phase.type === "rest") {
      if (groups.length) groups[groups.length - 1].push(phase);
      else leadingRest.push(phase);
      return;
    }
    groups.push([...leadingRest, phase]);
    leadingRest = [];
  });
  if (leadingRest.length && groups.length) groups[groups.length - 1].push(...leadingRest);
  return groups.length === intervalCount ? groups : null;
}


export function getStructureIntervalPhaseGroups(phases, structure) {
  const intervalCount = structure?.type === "ladder"
    ? structure.steps?.length
    : Array.isArray(structure?.items) && structure.items.length && structure.items.every(item => item?.type === "rounds")
      ? structure.items.length : 0;
  return getIntervalPhaseGroups(phases, intervalCount);
}
