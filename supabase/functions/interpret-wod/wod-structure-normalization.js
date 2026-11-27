/**
 * AMRAP is a workout format, never a structure-node type. Timed AMRAP
 * segments are represented as one grouped round inside the ordered sequence;
 * the timer carries the segment duration and explicit rest nodes separate them.
 */
export function canonicalizeAmrapBlockNodes(workout) {
  const visit = nodes => {
    if (!Array.isArray(nodes)) return;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node?.type === "amrap") {
        if (!Array.isArray(node.items) || node.items.length === 0) continue;
        nodes[i] = {
          ...node,
          type: "rounds",
          count: Number.isInteger(node.count) && node.count > 0 ? node.count : 1,
        };
        delete nodes[i].movements;
        visit(nodes[i].items);
      } else if (node?.type === "rounds") visit(node.items);
      else if (node?.type === "choice") {
        for (const alternative of node.alternatives || []) visit(alternative?.items);
      }
    }
  };
  const structure = workout?.structure;
  if (["sequence", "rounds", "chipper"].includes(structure?.type)) visit(structure.items);
  else if (structure?.type === "ladder") for (const step of structure.steps || []) visit(step?.items);
  else if (structure?.type === "sections") for (const section of structure.sections || []) visit(section?.structure?.items);
  return workout;
}

const key = value => String(value || "").toLocaleLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");

function resolver(movements) {
  const ids = new Set();
  const names = new Map();
  for (const movement of movements) {
    if (typeof movement?.id !== "string" || !movement.id) continue;
    ids.add(movement.id);
    const name = key(movement.name);
    if (name) names.set(name, [...(names.get(name) || []), movement.id]);
  }
  return value => {
    if (typeof value !== "string" || !value.trim()) return null;
    if (ids.has(value)) return value;
    const matches = names.get(key(value)) || [];
    return matches.length === 1 ? matches[0] : null;
  };
}

export function normalizeRoundMovementAliases(workout) {
  const movements = Array.isArray(workout?.movements) ? workout.movements : [];
  if (!movements.length) return workout;
  const resolve = resolver(movements);
  const catalogue = new Map(movements.map(movement => [movement?.id, movement]));
  let converted = 0;
  const convert = entry => {
    const refs = typeof entry === "string" ? [entry] :
      [entry?.movementId, entry?.id, entry?.name, entry?.title, entry?.value];
    const movementId = refs.map(resolve).find(Boolean);
    if (!movementId) return null;
    const base = catalogue.get(movementId);
    const rawReps = entry && typeof entry === "object"
      ? entry.prescription ?? entry.reps ?? entry.repetitions : null;
    const prescription = typeof rawReps === "string" ? rawReps
      : typeof rawReps === "number" && Number.isFinite(rawReps) ? String(rawReps)
      : typeof base?.prescription === "string" ? base.prescription : null;
    const rawLoad = entry && typeof entry === "object" ? entry.load ?? entry.weight : null;
    const load = typeof rawLoad === "string" ? rawLoad
      : typeof base?.load === "string" ? base.load : null;
    return { type: "movement", movementId, prescription, load };
  };
  const visit = nodes => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (node?.type === "rounds") {
        if ((!Array.isArray(node.items) || !node.items.length) &&
            Array.isArray(node.movements) && node.movements.length) {
          const items = node.movements.map(convert);
          if (items.every(Boolean)) {
            node.items = items;
            delete node.movements;
            converted++;
          }
        }
        visit(node.items);
      } else if (node?.type === "choice") {
        for (const alternative of node.alternatives || []) visit(alternative?.items);
      }
    }
  };
  const structure = workout?.structure;
  if (["sequence", "rounds", "chipper"].includes(structure?.type)) visit(structure.items);
  else if (structure?.type === "ladder") for (const step of structure.steps || []) visit(step?.items);
  else if (structure?.type === "sections") for (const section of structure.sections || []) visit(section?.structure?.items);
  if (converted) console.info("Round movement aliases canonicalized", { rounds: converted });
  return workout;
}

export function normalizeRestStructureNodes(workout) {
  const visit = nodes => {
    if (!Array.isArray(nodes)) return;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const restHeader = node?.type === "rounds" &&
        /^(?:rest|descanso)\b/i.test(String(node.label || "").trim());
      if (node?.type === "rest" || restHeader) {
        const label = typeof node.label === "string" && node.label.trim() ? node.label.trim() : "Descanso";
        const explicit = Number(node.durationSeconds);
        const match = label.match(/(\d+)\s*(?:min(?:ute)?s?|m)\b/i);
        const seconds = Number.isInteger(explicit) && explicit > 0
          ? explicit : match ? Number(match[1]) * 60 : null;
        if (Number.isInteger(seconds) && seconds > 0) nodes[i] = { type: "rest", label, durationSeconds: seconds };
      } else if (node?.type === "rounds") visit(node.items);
      else if (node?.type === "choice") for (const alternative of node.alternatives || []) visit(alternative?.items);
    }
  };
  const structure = workout?.structure;
  if (["sequence", "rounds", "chipper"].includes(structure?.type)) visit(structure.items);
  else if (structure?.type === "ladder") for (const step of structure.steps || []) visit(step?.items);
  else if (structure?.type === "sections") for (const section of structure.sections || []) visit(section?.structure?.items);
  return workout;
}

export function nestFlatMovementsUnderEmptyRoundHeaders(workout) {
  const structure = workout?.structure;
  const nodes = structure?.items;
  if (!["sequence", "chipper"].includes(structure?.type) || !Array.isArray(nodes) ||
      !nodes.some(node => node?.type === "rounds" && (!Array.isArray(node.items) || !node.items.length))) return workout;
  const result = [];
  let active = null;
  let changed = false;
  const flush = () => {
    if (!active) return true;
    if (!active.items.length) return false;
    result.push(active);
    active = null;
    return true;
  };
  for (const node of nodes) {
    if (node?.type === "rest") {
      if (!flush()) return workout;
      result.push(node);
      changed = true;
    } else if (node?.type === "rounds" && (!Array.isArray(node.items) || !node.items.length)) {
      if (!flush() || /^(?:rest|descanso)\b/i.test(String(node.label || "").trim())) return workout;
      active = { ...node, items: [] };
      changed = true;
    } else if (active && (node?.type === "movement" || node?.type === "choice")) {
      active.items.push(node);
      changed = true;
    } else if (active && node?.type === "rounds" && Array.isArray(node.items) && node.items.length) {
      if (!flush()) return workout;
      result.push(node);
    } else if (active) {
      return workout;
    } else {
      if (node?.type === "movement" || node?.type === "choice") return workout;
      result.push(node);
    }
  }
  if (!flush() || !changed) return workout;
  console.info("Flat movements nested under round headers", {
    rounds: result.filter(node => node?.type === "rounds").length,
    movementsPerRound: result.filter(node => node?.type === "rounds").map(round => round.items?.length || 0),
  });
  return { ...workout, structure: { ...structure, items: result } };
}
