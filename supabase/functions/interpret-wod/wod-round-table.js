export function inferExplicitWorkoutFormat(...values) {
  const text = values.filter(value => typeof value === "string").join("\n");
  const match = text.match(/\b(for\s+time|e2mom|amrap|emom|tabata|chipper|ladder|death\s+by)\b/i);
  return match ? match[1].toLowerCase().replace(/\s+/g, "_") : null;
}

function movementTokens(value) {
  const tokens = String(value || "").toLocaleLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bdb\b/g, "dumbbell")
    .replace(/\bbmu\b/g, "bar muscle ups")
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

function parseRepValues(value) {
  const match = String(value || "").trim().match(/^(\d+(?:[.,]\d+)?(?:\s*[-–—]\s*\d+(?:[.,]\d+)?){0,})\s*(?:reps?|repeticiones?)?$/i);
  return match ? parseAlignedValues(match[1]) : null;
}

function parseLoadValues(value) {
  const match = String(value || "").trim().match(/^(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?){1,})\s*(kg|lb|lbs)?$/i);
  return match ? {
    values: match[1].split(/\s*\/\s*/).map(item => item.trim()),
    unit: (match[2] || "kg").toLowerCase(),
  } : null;
}

function buildRoundTable(raw, workout, movements, rows, roundCount) {
  const hasProgression = rows.some(row => row.reps.length > 1 || row.loads?.values.length > 1);
  if (!hasProgression || roundCount < 2 || roundCount > 30 ||
      rows.some(row => ![1, roundCount].includes(row.reps.length) ||
        (row.loads && ![1, roundCount].includes(row.loads.values.length)))) return raw;

  const updatedMovements = movements.map(movement => {
    const row = rows.find(item => item.movementId === movement.id);
    const variedReps = row.reps.length > 1;
    const variedLoads = row.loads?.values.length > 1;
    return {
      ...movement,
      ...(variedReps ? { prescription: null } : { prescription: row.reps[0] }),
      ...(variedLoads ? { load: null } : row.loads ? { load: row.loads.values[0] + " " + row.loads.unit } : {}),
    };
  });
  const items = Array.from({ length: roundCount }, (_, roundIndex) => ({
    type: "rounds",
    count: 1,
    label: "RONDA " + (roundIndex + 1),
    items: rows.map(row => {
      const movement = updatedMovements.find(item => item.id === row.movementId);
      const load = row.loads
        ? row.loads.values[row.loads.values.length === 1 ? 0 : roundIndex] + " " + row.loads.unit
        : movement?.load ?? null;
      return {
        type: "movement",
        movementId: row.movementId,
        prescription: row.reps[row.reps.length === 1 ? 0 : roundIndex],
        load,
      };
    }),
  }));
  console.info("For Time round progression table normalized", {
    rounds: roundCount, movements: rows.length,
    roundSpecificLoads: rows.filter(row => row.loads?.values.length > 1).length,
  });
  return { ...raw, workout: { ...workout, format: "for_time", movements: updatedMovements, structure: { type: "sequence", items } } };
}

function normalizeTransposedRoundTable(raw, sourceText, workout, movements) {
  const rows = [];
  for (const sourceLine of sourceText.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
    const movement = matchMovementLine(sourceLine, movements);
    if (!movement) continue;
    const prefix = sourceLine.replace(/^\s*(?:[-•*]\s*)?/, "");
    const repsMatch = prefix.match(/^(\d+(?:[.,]\d+)?(?:\s*[-–—]\s*\d+(?:[.,]\d+)?){0,})\s+/);
    const reps = repsMatch ? parseRepValues(repsMatch[1]) : null;
    if (!reps) continue;
    const loadMatch = prefix.match(/(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?){1,})\s*(kg|lb|lbs)\b/i);
    const loads = loadMatch ? {
      values: loadMatch[1].split(/\s*\/\s*/).map(value => value.trim()),
      unit: loadMatch[2].toLowerCase(),
    } : null;
    rows.push({ movementId: movement.id, sourceLine, reps, loads });
  }
  if (rows.length !== movements.length || new Set(rows.map(row => row.movementId)).size !== movements.length) return raw;
  const roundCount = Math.max(...rows.flatMap(row => [row.reps.length, row.loads?.values.length || 1]));
  return buildRoundTable(raw, workout, movements, rows, roundCount);
}

function normalizeGroupedRoundRows(raw, sourceText, workout, movements) {
  const entries = [];
  for (const sourceLine of sourceText.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
    const movement = matchMovementLine(sourceLine, movements);
    if (!movement) continue;
    const prescription = parsePrescriptionPrefix(sourceLine);
    if (prescription) entries.push({ movementId: movement.id, prescription, sourceLine });
  }
  const movementCount = movements.length;
  if (entries.length < movementCount * 2 || entries.length % movementCount !== 0) return raw;
  const roundCount = entries.length / movementCount;
  if (roundCount < 2 || roundCount > 30) return raw;
  const expectedOrder = entries.slice(0, movementCount).map(item => item.movementId);
  if (new Set(expectedOrder).size !== movementCount) return raw;
  for (let round = 0; round < roundCount; round++) {
    if (entries.slice(round * movementCount, (round + 1) * movementCount)
      .some((item, index) => item.movementId !== expectedOrder[index])) return raw;
  }
  const banner = sourceText.match(/\b(?:dumbbell|db)\s*[-–—:]\s*(\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?\s*\/\s*\d+(?:[.,]\d+)?)\s*kg\b/i);
  const targetId = banner
    ? movements.filter(movement => /\b(?:dumbbell|db)\b/i.test(movement.name)).map(movement => movement.id)
    : [];
  const bannerLoad = banner && targetId.length === 1
    ? banner[1].replace(/\s*[x×]\s*/g, " × ").replace(/\s*\/\s*/g, "/") + " kg"
    : null;
  const items = Array.from({ length: roundCount }, (_, round) => ({
    type: "rounds", count: 1, label: "RONDA " + (round + 1),
    items: entries.slice(round * movementCount, (round + 1) * movementCount).map(entry => ({
      type: "movement", movementId: entry.movementId, prescription: entry.prescription,
      load: bannerLoad && targetId[0] === entry.movementId
        ? bannerLoad
        : movements.find(movement => movement.id === entry.movementId)?.load ?? null,
    })),
  }));
  const prescriptionsByMovement = new Map(movements.map(movement => [movement.id, []]));
  entries.forEach(entry => prescriptionsByMovement.get(entry.movementId).push(entry.prescription));
  const updatedMovements = movements.map(movement => {
    const values = prescriptionsByMovement.get(movement.id) || [];
    return {
      ...movement,
      prescription: new Set(values.map(value => value.toLowerCase())).size > 1 ? null : values[0] ?? movement.prescription,
      ...(bannerLoad && targetId[0] === movement.id ? { load: bannerLoad } : {}),
    };
  });
  console.info("Grouped For Time rounds normalized from source", { rounds: roundCount, movements: movementCount });
  return { ...raw, workout: { ...workout, format: "for_time", movements: updatedMovements, structure: { type: "sequence", items } } };
}

function normalizeCatalogRoundTable(raw, workout, movements) {
  const rows = movements.map(movement => {
    const reps = parseRepValues(movement.prescription);
    const loads = parseLoadValues(movement.load);
    if (!reps) return null;
    return { movementId: movement.id, reps, loads };
  });
  if (rows.some(row => !row)) return raw;
  const roundCount = Math.max(...rows.flatMap(row => [row.reps.length, row.loads?.values.length || 1]));
  return buildRoundTable(raw, workout, movements, rows, roundCount);
}

export function normalizeExplicitForTimeRoundTable(raw, sourceText) {
  const workout = raw?.workout;
  const movements = workout?.movements;
  if (!Array.isArray(movements) || movements.length < 2 ||
      movements.some(movement => typeof movement?.id !== "string" || typeof movement?.name !== "string") ||
      new Set(movements.map(movement => movement.id)).size !== movements.length) return raw;

  const explicitFormat = inferExplicitWorkoutFormat(
    sourceText, workout.description, raw.title, raw.timer?.label,
    ...(Array.isArray(raw.timer?.blocks) ? raw.timer.blocks.map(block => block?.label) : [])
  );
  const timerFormat = inferWorkoutFormatFromStructure(workout, raw.timer);
  const isForTime = ["for_time", "rounds_for_time"].includes(workout.format) ||
    explicitFormat === "for_time" || (workout.format === "custom" && timerFormat === "for_time");
  if (!isForTime || workout.structure?.type !== "sequence" || !Array.isArray(workout.structure.items)) return raw;

  const normalizedWorkout = { ...workout, format: "for_time" };
  if (typeof sourceText === "string" && sourceText.trim()) {
    const transposed = normalizeTransposedRoundTable(raw, sourceText, normalizedWorkout, movements);
    if (transposed !== raw) return transposed;
    const grouped = normalizeGroupedRoundRows(raw, sourceText, normalizedWorkout, movements);
    if (grouped !== raw) return grouped;
  }
  return normalizeCatalogRoundTable(raw, normalizedWorkout, movements);
}

export function inferWorkoutTitle(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    for (const rawLine of value.split(/\r?\n/)) {
      if (/^\s*[-•*]\s*/.test(rawLine)) continue;
      const line = rawLine.trim();
      if (line.length > 48 || line.length < 3 || /^nuevo\s+wod$/i.test(line)) continue;
      if (/\b(for\s+time|amrap|emom|e2mom|tabata|chipper|ladder|time\s*cap)\b/i.test(line)) continue;
      if (/^\d+(?:\s*[-–—/]\s*\d+)*\s+[a-z]/i.test(line)) continue;
      if (/^\d+(?:\s*[-–—/]\s*\d+)+\s*(?:kg|lb)?$/i.test(line)) continue;
      if (/^\d+\s*(?:min|minutes?|m)\b/i.test(line)) continue;
      if (/^[\d\s.,/+-]+$/.test(line)) continue;
      if (/[a-záéíóúüñ]/i.test(line)) return line.replace(/\s+/g, " ").trim();
    }
  }
  return null;
}

export function normalizeWorkoutTitle(value) {
  const title = typeof value === "string" ? value.trim() : "";
  const normalized = title.toLocaleLowerCase().normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const categoryTitles = new Set([
    "gimnastico", "gimnasticos", "gymnastics", "gymnastic",
    "halterofilia", "weightlifting", "fuerza", "strength",
    "acondicionamiento", "conditioning", "endurance", "resistencia",
    "cardio", "metcon", "crossfit", "movilidad", "mobility",
    "tecnica", "technique", "skills", "skill", "warm up", "warmup",
    "gimnasia", "gym"
  ]);
  if (!title || /^nuevo\\s+wod$/i.test(title) || /^[-•*]/.test(title) || categoryTitles.has(normalized)) return "NUEVO WOD";
  return title;
}

export function inferWorkoutFormatFromStructure(workout, timer) {
  const structureType = workout?.structure?.type;
  if (structureType === "chipper") return "chipper";
  if (structureType === "ladder") return "ladder";
  const blocks = Array.isArray(timer?.blocks) ? timer.blocks : [];
  const timerTypes = new Set(blocks.map(block => block?.type));
  if (timerTypes.has("intervals")) return "intervals";
  if (timerTypes.has("emom")) return "emom";
  if (timerTypes.has("e2mom")) return "e2mom";
  if (timerTypes.has("tabata")) return "tabata";
  if (timerTypes.has("countup")) {
    if (structureType === "rounds") return "rounds_for_time";
    if (structureType === "sequence") return "for_time";
  }
  return null;
}
