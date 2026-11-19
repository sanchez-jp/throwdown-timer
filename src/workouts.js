/**
 * A sequence item is deliberately kept separate from its repetition note.
 * This prevents a parser from turning "+40 reps / ronda" into a second
 * movement (the bug that made Samurai Jack appear as a one-item workout).
 */
export const samuraiJack = {
  name: 'Samurai Jack',
  type: 'sequence',
  rounds: 1,
  items: [
    { reps: 40, movement: 'Double Unders', note: '+40 reps / ronda' }
  ]
};

export function parseSequence(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(?:sequence|secuencia)$/i.test(line))
    .map((line) => {
      const match = line.match(/^(\d+)\s*[·x×-]\s*(.+?)(?:\s*[·|-]\s*(.+))?$/i);
      if (!match) return null;
      const [, reps, movement, note] = match;
      return { reps: Number(reps), movement: movement.trim(), ...(note ? { note: note.trim() } : {}) };
    })
    .filter(Boolean);
}

export function formatReps(item) {
  return `${item.reps} ${item.movement}`;
}
