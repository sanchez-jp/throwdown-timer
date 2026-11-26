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


/**
 * Expands catalogue-level aligned progressions into editable Ladder steps.
 * It is intentionally data-driven: the step count must agree with the model's
 * ladder structure (when present) and every movement must have either one
 * constant prescription or one value per step.
 */
export function normalizeExplicitLadderRoundTable(workout, sourceText = "") {
  const movements = Array.isArray(workout?.movements) ? workout.movements : [];
  if (movements.length < 2 ||
      movements.some(movement => typeof movement?.id !== "string" || typeof movement?.name !== "string") ||
      new Set(movements.map(movement => movement.id)).size !== movements.length) return workout;

  const explicitFormat = inferExplicitWorkoutFormat(sourceText, workout.description);
  if (workout.format !== "ladder" && explicitFormat !== "ladder") return workout;

  // Prefer the original OCR/source transcription over the model's flattened
  // movement catalogue. This preserves per-round reps and loads even when the
  // model has already collapsed a progression to its first value.
  const sourceRows = [];
  if (typeof sourceText === "string" && sourceText.trim()) {
    for (const movement of movements) {
      const matches = sourceText.split(/\\r?\\n/).map(line => line.trim()).filter(Boolean)
        .map(sourceLine => {
          if (matchMovementLine(sourceLine, [movement]) !== movement) return null;
          const repMatch = sourceLine.replace(/^\\s*(?:[-•*]\\s*)?/, "")
            .match(/^(\\d+(?:[.,]\\d+)?(?:\\s*[-–—]\\s*\\d+(?:[.,]\\d+)?){0,})\\s+/);
          if (!repMatch) return null;
          const loadMatch = sourceLine.match(/(\\d+(?:[.,]\\d+)?(?:\\s*\\/\\s*\\d+(?:[.,]\\d+)?){1,})\\s*(kg|lb|lbs)\\b/i);
          return {
            movement,
            reps: parseRepValues(repMatch[1]),
            loads: loadMatch ? {
              values: loadMatch[1].split(/\\s*\\/\\s*/).map(value => value.trim()),
              unit: loadMatch[2].toLowerCase(),
            } : null,
          };
        }).filter(Boolean);
      if (matches.length !== 1) { sourceRows.length = 0; break; }
      sourceRows.push(matches[0]);
    }
  }
  const sourceRoundCount = sourceRows.length === movements.length
    ? Math.max(...sourceRows.flatMap(row => [row.reps?.length || 0, row.loads?.values.length || 1]))
    : 0;
  const sourceIsComplete = sourceRoundCount >= 2 && sourceRoundCount <= 30 &&
    sourceRows.every(row => row.reps && [1, sourceRoundCount].includes(row.reps.length) &&
      (!row.loads || [1, sourceRoundCount].includes(row.loads.values.length)));
  if (sourceIsComplete && sourceRows.some(row =>
    row.reps.length > 1 || row.loads?.values.length > 1)) {
    const sourceSteps = Array.from({ length: sourceRoundCount }, (_, roundIndex) => ({
      label: "Ronda " + (roundIndex + 1),
      items: sourceRows.map(row => {
        const existingItems = workout.structure?.type === "ladder"
          ? workout.structure.steps?.[0]?.items
          : workout.structure?.type === "sequence"
            ? workout.structure.items?.flatMap(group => group?.items || [])
            : [];
        const base = existingItems?.find(item => item?.movementId === row.movement.id) || {};
        return {
          ...base,
          type: "movement",
          movementId: row.movement.id,
          prescription: row.reps[row.reps.length === 1 ? 0 : roundIndex],
          load: row.loads
            ? row.loads.values[row.loads.values.length === 1 ? 0 : roundIndex] + " " + row.loads.unit
            : row.movement.load ?? null,
        };
      }),
    }));
    const sourceMovements = movements.map(movement => {
      const row = sourceRows.find(item => item.movement.id === movement.id);
      const sameReps = row.reps.every(value => value === row.reps[0]);
      const sameLoads = !row.loads || row.loads.values.every(value => value === row.loads.values[0]);
      return {
        ...movement,
        prescription: sameReps ? row.reps[0] : null,
        ...(row.loads ? { load: sameLoads ? row.loads.values[0] + " " + row.loads.unit : null } : {}),
      };
    });
    console.info("Ladder round table reconstructed from original source transcription", {
      rounds: sourceRoundCount,
      movements: sourceRows.length,
      roundSpecificLoads: sourceRows.filter(row => row.loads?.values.length > 1).length,
    });
    return {
      ...workout,
      format: "ladder",
      movements: sourceMovements,
      structure: {
        ...(workout.structure?.type === "ladder" ? workout.structure : {}),
        type: "ladder",
        direction: workout.structure?.direction || "custom",
        steps: sourceSteps,
      },
    };
  }

  const structure = workout.structure;
  const existingSteps = structure?.type === "ladder" && Array.isArray(structure.steps)
    ? structure.steps
    : [];
  const roundGroups = structure?.type === "sequence" && Array.isArray(structure.items)
    ? structure.items.filter(item => item?.type === "rounds")
    : [];
  const existingRoundCount = existingSteps.length > 1
    ? existingSteps.length
    : roundGroups.length === 1 && Number.isInteger(roundGroups[0]?.count) && roundGroups[0].count > 1
      ? roundGroups[0].count
      : null;

  const rows = movements.map(movement => ({
    movement,
    reps: parseRepValues(movement.prescription),
    loads: parseLoadValues(movement.load),
  }));
  if (rows.some(row => !row.reps)) return workout;

  const progressionCount = Math.max(...rows.flatMap(row => [
    row.reps.length, row.loads?.values.length || 1,
  ]));
  const roundCount = existingRoundCount || progressionCount;
  if (roundCount < 2 || roundCount > 30 || progressionCount !== roundCount ||
      rows.some(row => ![1, roundCount].includes(row.reps.length) ||
        (row.loads && ![1, roundCount].includes(row.loads.values.length)))) return workout;

  const hasProgression = rows.some(row => row.reps.length > 1 || row.loads?.values.length > 1);
  if (!hasProgression) return workout;

  const updatedMovements = movements.map((movement, index) => ({
    ...movement,
    prescription: rows[index].reps.length === 1 ? rows[index].reps[0] : null,
    ...(rows[index].loads
      ? { load: rows[index].loads.values.length === 1
          ? rows[index].loads.values[0] + " " + rows[index].loads.unit
          : null }
      : {}),
  }));
  const sourceItems = existingSteps[0]?.items ||
    (roundGroups[0]?.items || []).filter(item => item?.type === "movement");
  const sourceById = new Map(sourceItems.map(item => [item.movementId, item]));
  const steps = Array.from({ length: roundCount }, (_, roundIndex) => ({
    label: String(existingSteps[roundIndex]?.label || "").trim() || "Ronda " + (roundIndex + 1),
    items: rows.map(row => {
      const base = sourceById.get(row.movement.id) || {};
      return {
        ...base,
        type: "movement",
        movementId: row.movement.id,
        prescription: row.reps[row.reps.length === 1 ? 0 : roundIndex],
        load: row.loads
          ? row.loads.values[row.loads.values.length === 1 ? 0 : roundIndex] + " " + row.loads.unit
          : row.movement.load ?? null,
      };
    }),
  }));

  console.info("Ladder progression table normalized from movement catalogue", {
    rounds: roundCount,
    movements: rows.length,
    roundSpecificLoads: rows.filter(row => row.loads?.values.length > 1).length,
  });
  return {
    ...workout,
    format: "ladder",
    movements: updatedMovements,
    structure: {
      ...(structure?.type === "ladder" ? structure : {}),
      type: "ladder",
      direction: structure?.direction || "custom",
      steps,
    },
  };
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
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const categoryTitles = new Set([
    "gimnastico", "gimnasticos", "gymnastics", "gymnastic",
    "halterofilia", "weightlifting", "fuerza", "strength",
    "acondicionamiento", "conditioning", "endurance", "resistencia",
    "cardio", "metcon", "crossfit", "movilidad", "mobility",
    "tecnica", "technique", "skills", "skill", "warm up", "warmup",
    "gimnasia", "gym"
  ]);
  if (!title || /^nuevo\s+wod$/i.test(title) || /^[-•*]/.test(title) || categoryTitles.has(normalized)) return "NUEVO WOD";
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
