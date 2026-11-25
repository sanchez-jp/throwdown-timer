function movementTokens(value) {
  const tokens = String(value || "").toLocaleLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bdb\b/g, "dumbbell")
    .replace(/\bhspu\b/g, "handstand push up")
    .replace(/\bc2b\b/g, "chest to bar")
    .replace(/[^a-z0-9]+/g, " ")
    .trim().split(/\s+/).filter(Boolean);
  return tokens.map(token => token.endsWith("s") && token.length > 3 ? token.slice(0, -1) : token);
}

function tokensEquivalent(left, right) {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1 || Math.min(left.length, right.length) < 5) return false;
  let i = 0, j = 0, edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (left.length > right.length) i++;
    else if (right.length > left.length) j++;
    else { i++; j++; }
  }
  return edits + (i < left.length || j < right.length ? 1 : 0) <= 1;
}

function matchMovementLine(line, movements) {
  const lineTokens = movementTokens(line);
  const matches = movements.filter(movement => {
    const nameTokens = movementTokens(movement?.name);
    if (!nameTokens.length) return false;
    for (let index = 0; index <= lineTokens.length - nameTokens.length; index++) {
      if (nameTokens.every((token, offset) => tokensEquivalent(lineTokens[index + offset], token))) return true;
    }
    return false;
  });
  return matches.length === 1 ? matches[0] : null;
}

function parsePrescriptionPrefix(line) {
  const match = line.match(/^\s*(?:[-•*]\s*)?(\d+(?:[.,]\d+)?\s*(?:-\s*)?(?:reps?|repeticiones?|cal(?:ories?)?|m|meters?|metres?|km|ft|feet|in|inches?)?)\s+/i);
  if (!match) return null;
  return match[1].replace(/\s+/g, " ").replace(/\s*-\s*/g, " ").trim();
}

function explicitDumbbellBannerLoad(sourceText, workout, tableItems) {
  const match = sourceText.match(/\b(?:dumbbell|db)\s*[-–—:]\s*(\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?\s*\/\s*\d+(?:[.,]\d+)?)\s*kg\b/i);
  if (!match) return null;
  const targetIds = new Set(tableItems.filter(item => /\b(?:dumbbell|db)\b/i.test(item.sourceLine)).map(item => item.movementId));
  if (targetIds.size !== 1) {
    const dumbbellMovements = workout.movements.filter(movement => /\b(?:dumbbell|db)\b/i.test(movement.name || ""));
    if (dumbbellMovements.length !== 1) return null;
    targetIds.add(dumbbellMovements[0].id);
  }
  return { movementId: [...targetIds][0], load: match[1].replace(/\s*[x×]\s*/g, " × ").replace(/\s*\/\s*/g, "/") + " kg" };
}

function parseAlignedValues(value) {
  return value.split(/\s*[-–—]\s*/).map(item => item.trim()).filter(Boolean);
}

function normalizeTransposedRoundTable(raw, sourceText, workout, movements) {
  const rows = [];
  for (const sourceLine of sourceText.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
    const movement = matchMovementLine(sourceLine, movements);
    if (!movement) continue;
    const reps = sourceLine.match(/^\s*(?:[-•*]\s*)?(\d+(?:[.,]\d+)?(?:\s*[-–—]\s*\d+(?:[.,]\d+)?){1,})\s+/);
    if (!reps) continue;
    const values = parseAlignedValues(reps[1]);
    const loadMatch = sourceLine.match(/\b(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?){2,})\s*kg\b/i);
    const loads = loadMatch ? loadMatch[1].split(/\s*\/\s*/).map(value => value.trim()) : null;
    rows.push({ movementId: movement.id, sourceLine, reps: values, loads });
  }

  if (rows.length !== movements.length || new Set(rows.map(row => row.movementId)).size !== movements.length) return raw;
  const roundCount = rows[0].reps.length;
  if (roundCount < 2 || roundCount > 30 ||
      rows.some(row => row.reps.length !== roundCount || (row.loads && row.loads.length !== roundCount))) return raw;

  const updatedMovements = movements.map(movement => {
    const row = rows.find(item => item.movementId === movement.id);
    const variedReps = new Set(row.reps.map(value => value.toLowerCase())).size > 1;
    const hasRoundLoads = Boolean(row.loads);
    return {
      ...movement,
      ...(variedReps ? { prescription: null } : { prescription: row.reps[0] }),
      ...(hasRoundLoads ? { load: null } : {}),
    };
  });
  const items = Array.from({ length: roundCount }, (_, roundIndex) => ({
    type: "rounds",
    count: 1,
    label: "RONDA " + (roundIndex + 1),
    items: rows.map(row => ({
      type: "movement",
      movementId: row.movementId,
      prescription: row.reps[roundIndex],
      load: row.loads ? row.loads[roundIndex] + " kg" : movements.find(item => item.id === row.movementId)?.load ?? null,
    })),
  }));

  console.info("Transposed For Time progression table normalized", {
    rounds: roundCount, movements: rows.length, roundSpecificLoads: rows.filter(row => row.loads).length,
  });
  return { ...raw, workout: { ...workout, movements: updatedMovements, structure: { type: "sequence", items } } };
}

export function normalizeExplicitForTimeRoundTable(raw, sourceText) {
  const workout = raw?.workout;
  if (!["for_time", "rounds_for_time"].includes(workout?.format) ||
      !Array.isArray(workout?.movements) || workout.movements.length < 2 || typeof sourceText !== "string") return raw;

  const movements = workout.movements.filter(movement => typeof movement?.id === "string" && typeof movement?.name === "string");
  if (movements.length !== workout.movements.length || new Set(movements.map(movement => movement.id)).size !== movements.length) return raw;

  const transposed = normalizeTransposedRoundTable(raw, sourceText, workout, movements);
  if (transposed !== raw) return transposed;

  const tableItems = [];
  for (const sourceLine of sourceText.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
    const movement = matchMovementLine(sourceLine, movements);
    if (!movement) continue;
    const prescription = parsePrescriptionPrefix(sourceLine);
    if (!prescription) continue;
    tableItems.push({ movementId: movement.id, prescription, sourceLine });
  }

  const movementCount = movements.length;
  if (tableItems.length < movementCount * 2 || tableItems.length % movementCount !== 0) return raw;
  const groupCount = tableItems.length / movementCount;
  if (groupCount < 2 || groupCount > 30) return raw;

  const expectedOrder = tableItems.slice(0, movementCount).map(item => item.movementId);
  if (new Set(expectedOrder).size !== movementCount) return raw;
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
    const group = tableItems.slice(groupIndex * movementCount, (groupIndex + 1) * movementCount);
    if (group.some((item, index) => item.movementId !== expectedOrder[index])) return raw;
  }

  const prescriptionsByMovement = new Map(movements.map(movement => [movement.id, new Set()]));
  for (const item of tableItems) prescriptionsByMovement.get(item.movementId).add(item.prescription.toLowerCase());
  if (![...prescriptionsByMovement.values()].some(values => values.size > 1)) return raw;

  const bannerLoad = explicitDumbbellBannerLoad(sourceText, workout, tableItems);
  const updatedMovements = movements.map(movement => {
    const prescriptions = prescriptionsByMovement.get(movement.id);
    const varied = prescriptions.size > 1;
    const load = bannerLoad?.movementId === movement.id ? bannerLoad.load : movement.load;
    return { ...movement, ...(varied ? { prescription: null } : {}), ...(load ? { load } : {}) };
  });
  const items = [];
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
    const groupItems = tableItems.slice(groupIndex * movementCount, (groupIndex + 1) * movementCount).map(item => {
      const movement = updatedMovements.find(candidate => candidate.id === item.movementId);
      return { type: "movement", movementId: item.movementId, prescription: item.prescription, load: movement?.load ?? null };
    });
    items.push({ type: "rounds", count: 1, label: "RONDA " + (groupIndex + 1), items: groupItems });
  }

  return {
    ...raw,
    workout: { ...workout, movements: updatedMovements, structure: { type: "sequence", items } },
  };
}
