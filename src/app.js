import { samuraiJack, formatReps } from './workouts.js';

const sequence = document.querySelector('#sequence');
const display = document.querySelector('#display');
const roundLabel = document.querySelector('#round-label');
const startButton = document.querySelector('#start');
const resetButton = document.querySelector('#reset');

let elapsed = 0;
let interval;

function renderWorkout(workout) {
  document.querySelector('#workout-title').textContent = workout.name;
  sequence.replaceChildren(...workout.items.map((item, index) => {
    const row = document.createElement('li');
    const step = document.createElement('span');
    const content = document.createElement('span');
    const movement = document.createElement('strong');
    const note = document.createElement('small');
    row.className = 'sequence-item';
    step.className = 'step';
    step.textContent = index + 1;
    movement.textContent = formatReps(item);
    note.textContent = item.note ?? '';
    content.append(movement, note);
    row.append(step, content);
    return row;
  }));
  roundLabel.textContent = `ROUND 1 OF ${workout.rounds}`;
}

function renderTime() {
  const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const seconds = (elapsed % 60).toString().padStart(2, '0');
  display.textContent = `${minutes}:${seconds}`;
  display.dateTime = `PT${elapsed}S`;
}

function stop() {
  clearInterval(interval);
  interval = undefined;
  startButton.textContent = elapsed ? 'Resume' : 'Start';
}

startButton.addEventListener('click', () => {
  if (interval) {
    stop();
    return;
  }
  startButton.textContent = 'Pause';
  interval = setInterval(() => {
    elapsed += 1;
    renderTime();
  }, 1000);
});

resetButton.addEventListener('click', () => {
  stop();
  elapsed = 0;
  renderTime();
  startButton.textContent = 'Start';
});

renderWorkout(samuraiJack);
renderTime();
