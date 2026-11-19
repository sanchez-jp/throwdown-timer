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
