import { TimerEngine } from "./timer-engine.js";

export class TimerPlanBuilderError extends Error {
  constructor(code, message) { super(message); this.name = "TimerPlanBuilderError"; this.code = code; }
}

export function flattenTimerPlan(plan) {
  if (plan == null) return [];
  if (!plan || plan.type !== "sequence" || !Array.isArray(plan.blocks)) {
    throw new TimerPlanBuilderError("UNSUPPORTED_PLAN", "El plan guardado no tiene una secuencia válida.");
  }
  const result = [];
  function visit(block, depth) {
    if (depth > 12) throw new TimerPlanBuilderError("PLAN_TOO_DEEP", "El plan tiene demasiados niveles.");
    if (!block || typeof block !== "object") throw new TimerPlanBuilderError("INVALID_BLOCK", "El plan contiene un bloque no válido.");
    if (block.type === "sequence") {
      if (!Array.isArray(block.blocks) || !block.blocks.length) throw new TimerPlanBuilderError("EMPTY_SEQUENCE", "Hay una secuencia vacía en el plan.");
      block.blocks.forEach(child => visit(child, depth + 1)); return;
    }
    if (block.type === "repeat") {
      if (!Number.isInteger(block.repeatCount) || block.repeatCount < 1 || !Array.isArray(block.blocks) || !block.blocks.length) {
        throw new TimerPlanBuilderError("INVALID_REPEAT", "El bloque de repetición no es válido.");
      }
      if (block.repeatCount > 10000) throw new TimerPlanBuilderError("PLAN_TOO_LARGE", "El bloque de repetición supera el límite permitido.");
      for (let i = 0; i < block.repeatCount; i++) block.blocks.forEach(child => visit(child, depth + 1));
      return;
    }
    if (!["countdown", "countup", "emom", "intervals", "rest"].includes(block.type)) {
      throw new TimerPlanBuilderError("UNSUPPORTED_BLOCK", "El editor no reconoce un tipo de bloque del plan.");
    }
    result.push(structuredClone(block));
    if (result.length > 10000) throw new TimerPlanBuilderError("PLAN_TOO_LARGE", "El plan contiene demasiados bloques.");
  }
  plan.blocks.forEach(block => visit(block, 0));
  return result;
}

export function buildTimerPlan(title, blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  const countupIndex = blocks.findIndex(block => block?.type === "countup");
  if (countupIndex !== -1 && countupIndex !== blocks.length - 1) {
    throw new TimerPlanBuilderError("COUNTUP_MUST_BE_FINAL", "En esta versión, un bloque For Time debe ser el último segmento del WOD.");
  }
  const plan = { type: "sequence", label: String(title || "WOD").trim() || "WOD", blocks: structuredClone(blocks) };
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
