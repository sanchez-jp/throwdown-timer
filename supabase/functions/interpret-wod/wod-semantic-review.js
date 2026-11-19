export function findUnverifiedMovementCoverage(workout, evidence) {
  const movementIds = new Set((workout?.movements || []).map((movement) => movement?.id));
  const coveredMovementIds = new Set();
  let hasUnmappedSourceMovement = false;

  for (const item of Array.isArray(evidence) ? evidence : []) {
    if (typeof item?.sourceName !== "string" || !item.sourceName.trim() ||
        typeof item?.sourceEvidence !== "string" || !item.sourceEvidence.trim() ||
        typeof item?.movementId !== "string" || !movementIds.has(item.movementId)) {
      hasUnmappedSourceMovement = true;
      continue;
    }
    coveredMovementIds.add(item.movementId);
  }

  return {
    hasUnmappedSourceMovement,
    uncoveredMovementIds: [...movementIds].filter((id) => !coveredMovementIds.has(id)),
    hasEvidence: Array.isArray(evidence) && evidence.length > 0,
  };
}

export function parseExplicitWorkRestIntervals(sourceText) {
  if (typeof sourceText !== "string") return null;
  const normalized = sourceText.replace(/[’‘′]/g, "'");
  const match = normalized.match(/\b(\d+)\s*(?:x|×|rounds?\s*(?:of)?|rondas?\s*(?:de)?)\s*(\d+)\s*(?:'|min(?:ute)?s?)\s*(?:amrap)?\s*(?:\/|,|\+)\s*(\d+)\s*(?:'|min(?:ute)?s?)\s*(?:rest|descanso)\b/i);
  if (!match) return null;
  const [, roundsText, workMinutesText, restMinutesText] = match;
  const rounds = Number(roundsText);
  const workSeconds = Number(workMinutesText) * 60;
  const restSeconds = Number(restMinutesText) * 60;
  if (![rounds, workSeconds, restSeconds].every(Number.isInteger) || rounds < 1 || workSeconds < 1 || restSeconds < 0) return null;
  return { rounds, workSeconds, restSeconds, startWithRest: false };
}

export function normalizeExplicitWorkRestIntervals(timer, sourceText) {
  const interval = parseExplicitWorkRestIntervals(sourceText);
  if (!interval) return timer;
  const normalizedBlock = (block = {}) => ({
    ...block,
    type: "intervals",
    label: typeof block.label === "string" && block.label.trim() ? block.label : "Trabajo / descanso",
    ...interval,
  });

  if (timer == null) {
    return { type: "sequence", label: "Trabajo / descanso", blocks: [normalizedBlock()] };
  }
  if (timer.type === "sequence" && Array.isArray(timer.blocks)) {
    const intervalIndexes = timer.blocks.flatMap((block, index) => block?.type === "intervals" ? [index] : []);
    if (intervalIndexes.length === 1) {
      const targetIndex = intervalIndexes[0];
      return {
        ...timer,
        blocks: timer.blocks.map((block, index) => index === targetIndex ? normalizedBlock(block) : block),
      };
    }
    if (intervalIndexes.length > 1 || timer.blocks.length > 1 || timer.blocks.length === 1) return timer;
    return { ...timer, blocks: [normalizedBlock()] };
  }
  if (timer.type === "intervals") return { type: "sequence", label: timer.label || "Trabajo / descanso", blocks: [normalizedBlock(timer)] };
  return timer;
}
