export function expandDescendingIntervalProgression(raw) {
  const workout = raw?.workout;
  const structure = workout?.structure;
  if (workout?.format !== "intervals" || structure?.type !== "rounds") return raw;

  const description = typeof workout.description === "string" ? workout.description : "";
  const decrementMatch = description.match(/(?:restando|restan|restar|resta|reduciendo|reduce|disminuyendo|disminuye|subtract(?:ing)?|decreas(?:e|ing))\s+(?:en\s+)?(\d+)\s+(?:repeticiones?|reps?)\b/i);
  if (!decrementMatch) {
    if (structure.direction === "descending") {
      throw new Error("La IA ha indicado una progresión descendente, pero no ha especificado el decremento para convertirla en peldaños editables.");
    }
    return raw;
  }
  if (!Number.isInteger(structure.count) || structure.count < 2 || structure.count > 30) {
    throw new Error("La progresión descendente necesita un número de intervalos válido entre 2 y 30.");
  }

  const decrement = Number(decrementMatch[1]);
  if (!Number.isInteger(decrement) || decrement < 1) return raw;
  const movements = new Map((Array.isArray(workout.movements) ? workout.movements : [])
    .map(movement => [movement.id, movement]));
  const items = Array.isArray(structure.items) ? structure.items : [];
  if (!items.length) throw new Error("La progresión descendente no contiene movimientos que se puedan expandir.");

  const baseItems = items.map(item => {
    const movement = movements.get(item?.movementId);
    const prescription = item?.prescription ?? movement?.prescription ?? null;
    const match = typeof prescription === "string"
      ? prescription.trim().match(/^(\d+)(\s*(?:reps?|repeticiones?))?$/i)
      : null;
    return { item, match };
  });
  if (!baseItems.some(entry => entry.match)) throw new Error("La progresión descendente no contiene repeticiones iniciales numéricas para calcular los intervalos.");

  const steps = [];
  for (let round = 0; round < structure.count; round++) {
    const stepItems = [];
    for (const entry of baseItems) {
      if (!entry.match) {
        stepItems.push({ ...entry.item });
        continue;
      }
      const repetitions = Number(entry.match[1]) - decrement * round;
      if (!Number.isInteger(repetitions) || repetitions <= 0) {
        throw new Error("La progresión descendente supera las repeticiones disponibles; revisa el número de intervalos y el decremento.");
      }
      const suffix = entry.match[2] || "";
      stepItems.push({ ...entry.item, prescription: String(repetitions) + suffix });
    }
    steps.push({ label: "Intervalo " + (round + 1), items: stepItems });
  }

  return {
    ...raw,
    workout: {
      ...workout,
      structure: { type: "ladder", direction: "descending", steps },
    },
  };
}


function parseLoadValues(value) {
  return value.split("/").map(part => Number(part.trim().replace(",", ".")));
}

function formatLoadValues(values) {
  return values.map(value => Number.isInteger(value) ? String(value) : String(value).replace(".", ",")).join("/");
}

export function expandProgressiveLoadLadder(raw, sourceText = "") {
  const structure = raw?.workout?.structure;
  if (structure?.type !== "ladder" || !Array.isArray(structure.steps) || structure.steps.length < 2) return raw;

  const progression = sourceText.match(
    /(?:start(?:ing)?\s+with|(?:comienza|empieza|inicia|arranca)\s+con)\s*(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)?)\s*kg\b[\s\S]{0,180}?(?:increase|increases|increment(?:a|ar)?|aument(?:a|ar)?|sub(?:e|ir))\s*(?:by|en)?\s*(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)?)\s*kg\b[\s\S]{0,100}?(?:after|tras|después de)\s*(?:each|cada)\s*(?:round|ronda)\b/i
  );
  if (!progression) return raw;

  const startingLoads = parseLoadValues(progression[1]);
  const increments = parseLoadValues(progression[2]);
  if (startingLoads.length !== increments.length || startingLoads.some(value => !Number.isFinite(value)) ||
      increments.some(value => !Number.isFinite(value)) || startingLoads.some(value => value <= 0) ||
      increments.some(value => value <= 0) || structure.steps.length > 30) return raw;

  const movements = Array.isArray(raw.workout.movements) ? raw.workout.movements : [];
  const baseText = progression[1].replace(/\s/g, "").replace(/,/g, ".");
  const loadedMovements = movements.filter(movement => typeof movement?.load === "string" && movement.load.trim());
  const target = loadedMovements.find(movement =>
    movement.load.replace(/\s/g, "").replace(/,/g, ".").includes(baseText)
  ) || (loadedMovements.length === 1 ? loadedMovements[0] : null);
  if (!target) return raw;

  const steps = structure.steps.map((step, index) => {
    const label = String(step.label || "Ronda " + (index + 1));
    const cleanLabel = label.replace(/\s*[·|–—-]\s*.*$/, "").trim() || "Ronda " + (index + 1);
    const values = startingLoads.map((value, position) => Number((value + increments[position] * index).toFixed(2)));
    return { ...step, label: cleanLabel + " · " + target.name + " " + formatLoadValues(values) + " kg" };
  });

  return {
    ...raw,
    workout: {
      ...raw.workout,
      structure: { ...structure, steps },
    },
  };
}
