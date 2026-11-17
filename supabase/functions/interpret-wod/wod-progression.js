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
