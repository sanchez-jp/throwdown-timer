/**
 * Groups timer work/rest phases against the ordered intervals in a ladder.
 * Work can be represented by either an intervals block or repeated countdown
 * blocks; phase indexes remain those of TimerEngine for live highlighting.
 */
export function getIntervalPhaseGroups(phases, intervalCount) {
  if (!Array.isArray(phases) || !Number.isInteger(intervalCount) || intervalCount < 1) return null;
  const groups = Array.from({ length: intervalCount }, () => []);
  const repeated = phases.filter(phase => {
    const match = String(phase?.sourcePath || "").match(/\.repeat\[(\d+)\]/);
    return match && Number(match[1]) < intervalCount;
  });
  if (repeated.length) {
    repeated.forEach(phase => {
      const match = String(phase.sourcePath).match(/\.repeat\[(\d+)\]/);
      groups[Number(match[1])].push(phase);
    });
    return groups.every(group => group.length) ? groups : null;
  }
  const roundPhases = phases.filter(phase =>
    Number.isInteger(phase?.round) && phase.totalRounds === intervalCount
  );
  if (roundPhases.length) {
    roundPhases.forEach(phase => groups[phase.round - 1]?.push(phase));
    return groups.every(group => group.length) ? groups : null;
  }
  const schedule = phases.filter(phase =>
    phase && (phase.type === "intervals" || phase.type === "countdown" || phase.type === "rest")
  );
  const work = schedule.filter(phase => phase.type !== "rest");
  if (work.length < intervalCount) return null;
  const selected = work.length === intervalCount ? schedule : schedule.slice(-intervalCount * 2);
  let current = -1;
  selected.forEach(phase => {
    if (phase.type !== "rest") {
      current++;
      if (current < intervalCount) groups[current].push(phase);
    } else if (current >= 0 && current < intervalCount) {
      groups[current].push(phase);
    }
  });
  return groups.every(group => group.length) ? groups : null;
}

export function getStructureIntervalPhaseGroups(phases, structure) {
  const intervalCount = structure?.type === "ladder"
    ? structure.steps?.length
    : Array.isArray(structure?.items) && structure.items.length && structure.items.every(item => item?.type === "rounds")
      ? structure.items.length : 0;
  return getIntervalPhaseGroups(phases, intervalCount);
}
