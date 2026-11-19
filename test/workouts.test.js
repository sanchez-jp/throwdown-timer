import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReps, parseSequence, samuraiJack } from '../src/workouts.js';

test('Samurai Jack keeps the repetition note attached to the movement', () => {
  assert.deepEqual(samuraiJack.items, [
    { reps: 40, movement: 'Double Unders', note: '+40 reps / ronda' }
  ]);
  assert.equal(formatReps(samuraiJack.items[0]), '40 Double Unders');
});

test('parseSequence ignores a section heading and parses every movement', () => {
  assert.deepEqual(parseSequence('SECUENCIA\n40 · Double Unders · +40 reps / ronda\n20 · Burpees'), [
    { reps: 40, movement: 'Double Unders', note: '+40 reps / ronda' },
    { reps: 20, movement: 'Burpees' }
  ]);
});
