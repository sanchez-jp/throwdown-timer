export function findUnverifiedMovementCoverage(workout, evidence) {
  const movements = Array.isArray(workout?.movements) ? workout.movements : [];
  const normalize = (value) => String(value || "").toLocaleLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
  const comparable = (value) => normalize(value).replace(/s$/, "");
  const coveredMovementIds = new Set();
  let hasUnmappedSourceMovement = false;

  for (const item of Array.isArray(evidence) ? evidence : []) {
    if (typeof item?.sourceName !== "string" || !item.sourceName.trim() ||
        typeof item?.sourceEvidence !== "string" || !item.sourceEvidence.trim()) {
      hasUnmappedSourceMovement = true;
      continue;
    }
    const sourceName = comparable(item.sourceName);
    const byId = movements.find((movement) => movement?.id === item.movementId);
    const matches = byId ? [byId] : movements.filter((movement) => {
      const name = comparable(movement?.name);
      return name && (sourceName === name || sourceName.endsWith(name) || name.endsWith(sourceName));
    });
    if (matches.length !== 1 || typeof matches[0]?.id !== "string") {
      hasUnmappedSourceMovement = true;
      continue;
    }
    coveredMovementIds.add(matches[0].id);
  }

  return {
    hasUnmappedSourceMovement,
    uncoveredMovementIds: movements.map((movement) => movement?.id)
      .filter((id) => id && !coveredMovementIds.has(id)),
    hasEvidence: Array.isArray(evidence) && evidence.length > 0,
  };
}

export function shouldFlagUnverifiedMovementCoverage(reviewStatus, evidence, coverage) {
  const hasEvidence = Array.isArray(evidence) && evidence.length > 0;
  if (!hasEvidence && !["valid", "corrected"].includes(reviewStatus)) return false;
  return !coverage.hasEvidence || coverage.hasUnmappedSourceMovement || coverage.uncoveredMovementIds.length > 0;
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
