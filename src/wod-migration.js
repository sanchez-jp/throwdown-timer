import { WodValidationError, validateWodV2 } from "./wod-validator.js";

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function findCountupRounds(plan) {
  if (!plan || typeof plan !== "object") return null;
  const visit = blocks => {
    for (const block of blocks || []) {
      if (block.type === "countup" && Number.isInteger(block.rounds) && block.rounds > 0) return block.rounds;
      const nested = visit(block.blocks);
      if (nested !== null) return nested;
    }
    return null;
  };
  return visit(plan.blocks);
}

/**
 * Converts a persisted v1 record without changing its identity, timestamps, source text, or timer.
 * Ambiguous formats are retained as legacyFormat and explicitly marked for review.
 */
export function migrateWodV1ToV2(record) {
  if (!record || typeof record !== "object" || record.schemaVersion !== 1) {
    throw new WodValidationError("MIGRATION_SOURCE_UNSUPPORTED", "La migración solo admite registros WOD v1.");
  }
  const oldWorkout = record.workout;
  if (!oldWorkout || !Array.isArray(oldWorkout.movements) || oldWorkout.movements.length === 0) {
    throw new WodValidationError("EMPTY_LEGACY_MOVEMENTS", "El WOD antiguo no contiene movimientos que puedan estructurarse.");
  }

  const movements = oldWorkout.movements.map((movement, index) => {
    if (!movement || typeof movement.name !== "string" || !movement.name.trim()) {
      throw new WodValidationError("INVALID_LEGACY_MOVEMENT", "No se puede migrar un movimiento sin nombre.", "workout.movements[" + index + "]");
    }
    return {
      id: "legacy-movement-" + (index + 1),
      name: movement.name,
      prescription: movement.prescription ?? null,
      load: movement.load ?? null,
      notes: movement.notes ?? null
    };
  });
  const items = movements.map(movement => ({ type: "movement", movementId: movement.id }));
  const format = oldWorkout.format;
  let structure;
  let migratedFormat = format;
  let requiresReview = false;

  if (format === "chipper") {
    structure = { type: "chipper", items };
  } else if (format === "rounds_for_time") {
    const rounds = findCountupRounds(record.timer);
    if (rounds !== null) structure = { type: "rounds", count: rounds, items };
    else {
      migratedFormat = "custom";
      structure = { type: "sequence", items };
      requiresReview = true;
    }
  } else if (["amrap", "for_time", "emom", "e2mom", "tabata", "intervals"].includes(format)) {
    structure = { type: "sequence", items };
  } else {
    migratedFormat = "custom";
    structure = { type: "sequence", items };
    requiresReview = true;
  }

  const issues = clone(record.interpretation?.issues || []);
  if (requiresReview) {
    issues.push({
      severity: "warning",
      code: "LEGACY_STRUCTURE_REQUIRES_REVIEW",
      message: "El formato original (" + format + ") no contiene información estructural suficiente para reconstruir rondas o peldaños sin hacer suposiciones.",
      fieldPath: "workout.structure",
      question: "Revisa y completa la estructura del entrenamiento."
    });
  }

  const migrated = {
    ...clone(record),
    schemaVersion: 2,
    workout: {
      format: migratedFormat,
      description: oldWorkout.description || "",
      movements,
      structure,
      ...(migratedFormat !== format ? { legacyFormat: format } : {})
    },
    interpretation: {
      status: requiresReview ? "needs_review" : record.interpretation.status,
      issues
    }
  };

  validateWodV2(migrated);
  return migrated;
}
