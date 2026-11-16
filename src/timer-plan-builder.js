import { TimerEngine } from "./timer-engine.js";

export class TimerPlanBuilderError extends Error {
  constructor(code, message) { super(message); this.name = "TimerPlanBuilderError"; this.code = code; }
}

const EDITABLE_TYPES = ["countdown", "countup", "emom", "intervals", "rest", "repeat"];

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

/**
 * Returns editable top-level blocks without flattening nested repeat groups.
 * The editor can therefore round-trip the original grouping structure.
 */
export function flattenTimerPlan(plan) {
  if (plan == null) return [];
  if (!plan || plan.type !== "sequence" || !Array.isArray(plan.blocks)) {
    throw new TimerPlanBuilderError("UNSUPPORTED_PLAN", "El plan guardado no tiene una secuencia válida.");
  }
  return clone(plan.blocks);
}

function inspectBlocks(blocks, depth = 0, insideRepeat = false) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new TimerPlanBuilderError("EMPTY_SEQUENCE", "Los grupos del temporizador no pueden estar vacíos.");
  }
  if (depth > 12) throw new TimerPlanBuilderError("PLAN_TOO_DEEP", "El plan tiene demasiados niveles.");

  const result = { phaseCount: 0, countupIndexes: [] };
  blocks.forEach(block => {
    if (!block || typeof block !== "object" || !EDITABLE_TYPES.includes(block.type)) {
      throw new TimerPlanBuilderError("UNSUPPORTED_BLOCK", "El plan contiene un tipo de bloque no compatible.");
    }
    if (block.type === "repeat") {
      if (!Number.isInteger(block.repeatCount) || block.repeatCount < 1 || block.repeatCount > 1000) {
        throw new TimerPlanBuilderError("INVALID_REPEAT", "El número de repeticiones debe estar entre 1 y 1000.");
      }
      const child = inspectBlocks(block.blocks, depth + 1, true);
      if (child.countupIndexes.length && block.repeatCount > 1) {
        throw new TimerPlanBuilderError("COUNTUP_IN_REPEAT", "For Time no puede estar dentro de un grupo que se repite más de una vez.");
      }
      for (const index of child.countupIndexes) result.countupIndexes.push(result.phaseCount + index);
      result.phaseCount += child.phaseCount * block.repeatCount;
      return;
    }
    if (block.type === "countup") result.countupIndexes.push(result.phaseCount);
    result.phaseCount += 1;
  });
  if (!insideRepeat && result.countupIndexes.length > 1) {
    throw new TimerPlanBuilderError("MULTIPLE_COUNTUP", "Solo se permite un bloque For Time en el plan.");
  }
  if (!insideRepeat && result.countupIndexes.length && result.countupIndexes[0] !== result.phaseCount - 1) {
    throw new TimerPlanBuilderError("COUNTUP_MUST_BE_FINAL", "For Time debe ser el último segmento del WOD.");
  }
  return result;
}

export function buildTimerPlan(title, blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  const copied = clone(blocks);
  inspectBlocks(copied);
  const plan = { type: "sequence", label: String(title || "WOD").trim() || "WOD", blocks: copied };
  try { new TimerEngine(plan, { now: () => 0 }); }
  catch (error) { throw new TimerPlanBuilderError("INVALID_PLAN", error.message); }
  return plan;
}

export function timerPlanRequiredIssue() {
  return {
    severity: "blocking",
    code: "TIMER_PLAN_REQUIRED",
    message: "Configura el temporizador antes de iniciar este WOD.",
    fieldPath: "timer",
    question: "¿Qué bloques, duraciones e intervalos debe tener el temporizador?"
  };
}
