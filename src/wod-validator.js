const FORMATS = new Set([
  "amrap", "for_time", "emom", "e2mom", "tabata", "intervals",
  "rounds_for_time", "chipper", "ladder", "death_by",
  "strength_plus_wod", "custom"
]);

const STRUCTURE_BY_FORMAT = {
  rounds_for_time: new Set(["rounds"]),
  chipper: new Set(["chipper"]),
  ladder: new Set(["ladder"]),
  strength_plus_wod: new Set(["sections"]),
  for_time: new Set(["sequence", "rounds", "chipper", "sections"]),
  amrap: new Set(["sequence", "rounds", "sections"]),
  emom: new Set(["sequence", "sections"]),
  e2mom: new Set(["sequence", "sections"]),
  tabata: new Set(["sequence", "sections"]),
  intervals: new Set(["sequence", "sections"]),
  death_by: new Set(["sequence", "ladder", "sections"]),
  custom: new Set(["sequence", "rounds", "chipper", "ladder", "sections"])
};

export class WodValidationError extends Error {
  constructor(code, message, path = null) {
    super(message);
    this.name = "WodValidationError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, message, path) {
  throw new WodValidationError(code, message, path);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateStructure(node, movementIds, path = "workout.structure", depth = 0) {
  if (depth > 12) fail("STRUCTURE_TOO_DEEP", "La estructura del WOD supera la profundidad máxima de 12 niveles.", path);
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    fail("INVALID_STRUCTURE_NODE", "Cada nodo de estructura debe ser un objeto.", path);
  }

  switch (node.type) {
    case "movement":
      if (!nonEmptyString(node.movementId) || !movementIds.has(node.movementId)) {
        fail("UNKNOWN_MOVEMENT_REFERENCE", "La estructura referencia un movimiento que no existe.", path + ".movementId");
      }
      if (node.prescription !== undefined && node.prescription !== null && typeof node.prescription !== "string") {
        fail("INVALID_PRESCRIPTION", "La prescripción de esta aparición debe ser texto o null.", path + ".prescription");
      }
      return;
    case "sequence":
    case "rounds":
    case "chipper": {
      if (node.type === "rounds" && (!Number.isInteger(node.count) || node.count < 1)) {
        fail("INVALID_ROUND_COUNT", "El número de rondas debe ser un entero positivo.", path + ".count");
      }
      if (!Array.isArray(node.items) || node.items.length === 0) {
        fail("EMPTY_STRUCTURE", "La estructura debe contener al menos un elemento.", path + ".items");
      }
      node.items.forEach((child, index) => validateStructure(child, movementIds, path + ".items[" + index + "]", depth + 1));
      return;
    }
    case "ladder":
      if (!["ascending", "descending", "alternating", "custom"].includes(node.direction)) {
        fail("INVALID_LADDER_DIRECTION", "La dirección de la ladder no es válida.", path + ".direction");
      }
      if (!Array.isArray(node.steps) || node.steps.length === 0) {
        fail("EMPTY_LADDER", "La ladder debe contener al menos un peldaño.", path + ".steps");
      }
      node.steps.forEach((step, index) => {
        const stepPath = path + ".steps[" + index + "]";
        if (!step || typeof step !== "object" || !nonEmptyString(step.label)) {
          fail("INVALID_LADDER_STEP", "Cada peldaño necesita una etiqueta.", stepPath);
        }
        if (!Array.isArray(step.items) || step.items.length === 0) {
          fail("EMPTY_LADDER_STEP", "Cada peldaño debe contener al menos un movimiento.", stepPath + ".items");
        }
        step.items.forEach((child, childIndex) => validateStructure(child, movementIds, stepPath + ".items[" + childIndex + "]", depth + 1));
      });
      return;
    case "sections": {
      if (!Array.isArray(node.sections) || node.sections.length === 0) {
        fail("EMPTY_SECTIONS", "El entrenamiento debe contener al menos una sección.", path + ".sections");
      }
      const ids = new Set();
      node.sections.forEach((section, index) => {
        const sectionPath = path + ".sections[" + index + "]";
        if (!section || typeof section !== "object" || !nonEmptyString(section.id) || !nonEmptyString(section.name)) {
          fail("INVALID_SECTION", "Cada sección necesita un identificador y un nombre.", sectionPath);
        }
        if (ids.has(section.id)) fail("DUPLICATE_SECTION_ID", "Los identificadores de sección deben ser únicos.", sectionPath + ".id");
        ids.add(section.id);
        validateStructure(section.structure, movementIds, sectionPath + ".structure", depth + 1);
      });
      return;
    }
    default:
      fail("UNKNOWN_STRUCTURE_TYPE", "Tipo de estructura no reconocido: " + String(node.type), path + ".type");
  }
}

export function validateWodV2(wod) {
  if (!wod || typeof wod !== "object" || Array.isArray(wod)) {
    fail("INVALID_WOD", "El WOD debe ser un objeto.");
  }
  if (wod.schemaVersion !== 2) fail("UNSUPPORTED_SCHEMA", "Se esperaba schemaVersion 2.", "schemaVersion");
  if (!nonEmptyString(wod.title)) fail("INVALID_TITLE", "El WOD necesita un título.", "title");
  const workout = wod.workout;
  if (!workout || typeof workout !== "object" || !FORMATS.has(workout.format) ||
      typeof workout.description !== "string" || !Array.isArray(workout.movements)) {
    fail("INVALID_WORKOUT", "El formato, descripción o catálogo de movimientos no es válido.", "workout");
  }

  const movementIds = new Set();
  workout.movements.forEach((movement, index) => {
    const path = "workout.movements[" + index + "]";
    if (!movement || typeof movement !== "object" || !nonEmptyString(movement.id) || !nonEmptyString(movement.name)) {
      fail("INVALID_MOVEMENT", "Cada movimiento necesita un ID y un nombre.", path);
    }
    if (movementIds.has(movement.id)) fail("DUPLICATE_MOVEMENT_ID", "Los identificadores de movimiento deben ser únicos.", path + ".id");
    movementIds.add(movement.id);
    for (const field of ["prescription", "load", "notes"]) {
      if (movement[field] !== null && typeof movement[field] !== "string") {
        fail("INVALID_MOVEMENT_FIELD", "El campo " + field + " debe ser texto o null.", path + "." + field);
      }
    }
  });

  validateStructure(workout.structure, movementIds);
  const allowed = STRUCTURE_BY_FORMAT[workout.format];
  if (!allowed || !allowed.has(workout.structure.type)) {
    fail("FORMAT_STRUCTURE_MISMATCH", "La estructura " + workout.structure.type + " no es compatible con el formato " + workout.format + ".", "workout.structure.type");
  }

  if (!wod.interpretation || !["ready", "needs_review", "invalid"].includes(wod.interpretation.status) ||
      !Array.isArray(wod.interpretation.issues)) {
    fail("INVALID_INTERPRETATION", "El estado de interpretación del WOD no es válido.", "interpretation");
  }
  if (wod.interpretation.status === "ready" && wod.timer === null) {
    fail("INVALID_READY_WOD", "Un WOD listo para ejecutar necesita un plan de temporizador.", "timer");
  }
  if (wod.interpretation.status === "ready" &&
      wod.interpretation.issues.some(issue => issue && issue.severity === "blocking")) {
    fail("BLOCKING_ISSUES", "Un WOD con incidencias bloqueantes no puede marcarse como listo.", "interpretation.issues");
  }
  return true;
}
