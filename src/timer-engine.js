/**
 * Throwdown Timer — deterministic timer engine (v1).
 *
 * No DOM, network, persistence, or AI dependencies.
 * Time is derived from an injected monotonic clock; UI ticks are only refresh hints.
 */

export class TimerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TimerError";
    this.code = code;
  }
}

const MAX_DEPTH = 12;
const MAX_PHASES = 10000;

function positiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TimerError("INVALID_PLAN", `${field} must be a positive integer.`);
  }
}

function compilePlan(plan) {
  if (!plan || plan.type !== "sequence" || !Array.isArray(plan.blocks) || plan.blocks.length === 0) {
    throw new TimerError("INVALID_PLAN", "A timer plan must be a non-empty sequence.");
  }

  const phases = [];

  function add(phase, path) {
    phases.push({ ...phase, sourcePath: path });
    if (phases.length > MAX_PHASES) {
      throw new TimerError("PLAN_TOO_LARGE", "The workout expands to too many timer phases.");
    }
  }

  function visit(block, path, depth) {
    if (depth > MAX_DEPTH) throw new TimerError("PLAN_TOO_DEEP", "The workout contains too many nested blocks.");
    if (!block || typeof block !== "object") throw new TimerError("INVALID_PLAN", "Invalid timer block.");

    switch (block.type) {
      case "sequence":
        if (!Array.isArray(block.blocks) || block.blocks.length === 0) {
          throw new TimerError("INVALID_PLAN", "Sequence blocks cannot be empty.");
        }
        block.blocks.forEach((child, i) => visit(child, `${path}.blocks[${i}]`, depth + 1));
        break;
      case "repeat":
        positiveInteger(block.repeatCount, "repeatCount");
        if (!Array.isArray(block.blocks) || block.blocks.length === 0) {
          throw new TimerError("INVALID_PLAN", "Repeat blocks cannot be empty.");
        }
        for (let round = 0; round < block.repeatCount; round++) {
          block.blocks.forEach((child, i) => visit(child, `${path}.repeat[${round}].blocks[${i}]`, depth + 1));
        }
        break;
      case "countdown":
      case "rest":
        positiveInteger(block.durationSeconds, "durationSeconds");
        add({
          type: block.type,
          label: block.label || block.type,
          durationMs: block.durationSeconds * 1000,
          allowSkip: block.allowSkip === true
        }, path);
        break;
      case "countup":
        if (block.timeCapSeconds !== null) positiveInteger(block.timeCapSeconds, "timeCapSeconds");
        if (block.rounds !== null) positiveInteger(block.rounds, "rounds");
        if (block.stages !== undefined) {
          if (!Array.isArray(block.stages) || !block.stages.length ||
              block.stages.some(stage => !stage || typeof stage.label !== "string" || !stage.label.trim())) {
            throw new TimerError("INVALID_STAGES", "Count-up stages must have labels and durations.");
          }
          block.stages.forEach(stage => positiveInteger(stage.durationSeconds, "stage.durationSeconds"));
          if (block.timeCapSeconds === null ||
              block.stages.reduce((sum, stage) => sum + stage.durationSeconds, 0) !== block.timeCapSeconds) {
            throw new TimerError("INVALID_STAGES", "Count-up stage durations must add up to the time cap.");
          }
        }
        const stages = Array.isArray(block.stages) ? block.stages.map(stage => ({
          label: stage.label.trim(),
          durationMs: stage.durationSeconds * 1000
        })) : null;
        add({
          type: "countup",
          label: block.label || "For Time",
          durationMs: block.timeCapSeconds === null ? null : block.timeCapSeconds * 1000,
          rounds: block.rounds,
          stages,
          allowSkip: false
        }, path);
        break;
      case "emom": {
        positiveInteger(block.durationSeconds, "durationSeconds");
        positiveInteger(block.intervalSeconds, "intervalSeconds");
        positiveInteger(block.rounds, "rounds");
        if (block.durationSeconds % block.intervalSeconds !== 0 ||
            block.rounds !== block.durationSeconds / block.intervalSeconds) {
          throw new TimerError("INVALID_EMOM", "EMOM duration, interval, and rounds must agree.");
        }
        if (block.intervalLabels !== undefined &&
            (!Array.isArray(block.intervalLabels) || !block.intervalLabels.length ||
             block.intervalLabels.some(label => typeof label !== "string" || !label.trim()))) {
          throw new TimerError("INVALID_EMOM_LABELS", "EMOM intervalLabels must contain non-empty labels.");
        }
        for (let i = 1; i <= block.rounds; i++) {
          const intervalLabel = Array.isArray(block.intervalLabels) && block.intervalLabels.length
            ? block.intervalLabels[(i - 1) % block.intervalLabels.length]
            : block.label || "EMOM";
          const isRest = /^(rest|descanso)$/i.test(intervalLabel.trim());
          add({
            type: "emom",
            phase: isRest ? "rest" : "work",
            label: intervalLabel,
            durationMs: block.intervalSeconds * 1000,
            round: i,
            totalRounds: block.rounds,
            intervalSeconds: block.intervalSeconds,
            allowSkip: block.allowSkip === true
          }, path);
        }
        break;
      }
      case "intervals": {
        positiveInteger(block.rounds, "rounds");
        positiveInteger(block.workSeconds, "workSeconds");
        if (!Number.isInteger(block.restSeconds) || block.restSeconds < 0) {
          throw new TimerError("INVALID_PLAN", "restSeconds must be a non-negative integer.");
        }
        for (let i = 1; i <= block.rounds; i++) {
          if (block.startWithRest === true) {
            if (block.restSeconds > 0) add({
              type: "rest",
              phase: "rest",
              label: block.label || "Rest",
              durationMs: block.restSeconds * 1000,
              round: i,
              totalRounds: block.rounds,
              allowSkip: block.allowSkip === true
            }, path);
            add({
              type: "intervals",
              phase: "work",
              label: block.label || "Work",
              durationMs: block.workSeconds * 1000,
              round: i,
              totalRounds: block.rounds,
              allowSkip: block.allowSkip === true
            }, path);
          } else {
            add({
              type: "intervals",
              phase: "work",
              label: block.label || "Work",
              durationMs: block.workSeconds * 1000,
              round: i,
              totalRounds: block.rounds,
              allowSkip: block.allowSkip === true
            }, path);
            if (block.restSeconds > 0 && i < block.rounds) add({
              type: "rest",
              phase: "rest",
              label: "Rest",
              durationMs: block.restSeconds * 1000,
              round: i,
              totalRounds: block.rounds,
              allowSkip: block.allowSkip === true
            }, path);
          }
        }
        break;
      }
      default:
        throw new TimerError("UNSUPPORTED_BLOCK", `Unsupported timer block type: ${block.type}`);
    }
  }

  plan.blocks.forEach((block, i) => visit(block, `blocks[${i}]`, 0));
  if (phases.length === 0) throw new TimerError("INVALID_PLAN", "The workout has no executable timer phases.");
  return phases;
}

export class TimerEngine {
  constructor(plan, options = {}) {
    this.phases = compilePlan(plan);
    this.now = options.now || (() => performance.now());
    this.state = "idle";
    this.index = 0;
    this.phaseElapsedMs = 0;
    this.phaseStartedAt = null;
    this.lastNow = null;
    this.completionReason = null;
    this.totalElapsedMs = 0;
    this.events = [];
  }

  _emit(type, details = {}) {
    this.events.push({ type, ...details });
  }

  _current() {
    return this.phases[this.index] || null;
  }

  _elapsedAt(now) {
    if (this.state !== "running" || this.phaseStartedAt === null) return this.phaseElapsedMs;
    return this.phaseElapsedMs + Math.max(0, now - this.phaseStartedAt);
  }

  _completePhase(now) {
    const phase = this._current();
    if (!phase) return;
    this.totalElapsedMs += phase.durationMs ?? this._elapsedAt(now);
    this._emit("block_completed", { label: phase.label, index: this.index });
    this.index += 1;
    this.phaseElapsedMs = 0;
    this.phaseStartedAt = now;
    if (this.index >= this.phases.length) {
      this.state = "completed";
      this.phaseStartedAt = null;
      this.completionReason = "plan_completed";
      this._emit("timer_completed", { reason: this.completionReason });
    } else {
      this._emit("phase_changed", { index: this.index, label: this._current().label });
    }
  }

  _advance(now) {
    if (this.state !== "running") return;
    let guard = 0;
    while (this.state === "running") {
      if (++guard > MAX_PHASES + 1) throw new TimerError("ADVANCE_GUARD", "Timer phase advancement limit reached.");
      const phase = this._current();
      if (!phase) {
        this.state = "completed";
        this.completionReason = "plan_completed";
        this.phaseStartedAt = null;
        break;
      }
      const elapsed = this._elapsedAt(now);
      if (phase.durationMs === null) break; // uncapped count-up
      if (elapsed < phase.durationMs) break;
      if (phase.type === "countup") {
        this.phaseElapsedMs = phase.durationMs;
        this.phaseStartedAt = null;
        this.state = "capped";
        this.completionReason = "time_cap_reached";
        this.totalElapsedMs += phase.durationMs;
        this._emit("time_cap_reached", { label: phase.label, timeCapMs: phase.durationMs });
        break;
      }
      const overflow = elapsed - phase.durationMs;
      this.totalElapsedMs += phase.durationMs;
      this._emit("block_completed", { label: phase.label, index: this.index });
      this.index += 1;
      this.phaseElapsedMs = 0;
      this.phaseStartedAt = now - overflow;
      if (this.index >= this.phases.length) {
        this.state = "completed";
        this.phaseStartedAt = null;
        this.completionReason = "plan_completed";
        this._emit("timer_completed", { reason: this.completionReason });
        break;
      }
      this._emit("phase_changed", { index: this.index, label: this._current().label });
    }
    this.lastNow = now;
  }

  start() {
    if (this.state !== "idle") return this._reject("start");
    const now = this.now();
    this.state = "running";
    this.phaseStartedAt = now;
    this.lastNow = now;
    this._emit("timer_started");
    return this.snapshot(now);
  }

  pause() {
    if (this.state !== "running") return this._reject("pause");
    const now = this.now();
    this._advance(now);
    if (this.state !== "running") return this.snapshot(now);
    this.phaseElapsedMs = this._elapsedAt(now);
    this.phaseStartedAt = null;
    this.state = "paused";
    this._emit("timer_paused");
    return this.snapshot(now);
  }

  resume() {
    if (this.state !== "paused") return this._reject("resume");
    const now = this.now();
    this.phaseStartedAt = now;
    this.state = "running";
    this._emit("timer_resumed");
    return this.snapshot(now);
  }

  finish() {
    if (this.state !== "running" && this.state !== "paused") return this._reject("finish");
    const now = this.now();
    if (this.state === "running") this._advance(now);
    if ((this.state !== "running" && this.state !== "paused") || this._current()?.type !== "countup") {
      return this._reject("finish");
    }
    const elapsed = this._elapsedAt(now);
    this.totalElapsedMs += elapsed;
    this.phaseElapsedMs = elapsed;
    this.phaseStartedAt = null;
    this.state = "completed";
    this.completionReason = "user_finished";
    this._emit("timer_completed", { reason: this.completionReason });
    return this.snapshot(now);
  }

  skip() {
    if (this.state !== "running" && this.state !== "paused") return this._reject("skip");
    const now = this.now();
    const previousIndex = this.index;
    if (this.state === "running") this._advance(now);
    // If the active phase expired just before this command, do not apply the
    // same Skip press to the newly-started phase.
    if (this.index !== previousIndex) return this.snapshot(now);
    if ((this.state !== "running" && this.state !== "paused") ||
        !this._current()?.allowSkip || this._current()?.type === "countup") {
      return this._reject("skip");
    }
    const phase = this._current();
    this._emit("phase_skipped", { label: phase.label, index: this.index });
    this.totalElapsedMs += this._elapsedAt(now);
    this.index += 1;
    this.phaseElapsedMs = 0;
    this.phaseStartedAt = this.state === "running" ? now : null;
    if (this.index >= this.phases.length) {
      this.state = "completed";
      this.phaseStartedAt = null;
      this.completionReason = "plan_completed";
      this._emit("timer_completed", { reason: this.completionReason });
    } else {
      this._emit("phase_changed", { index: this.index, label: this._current().label });
    }
    return this.snapshot(now);
  }

  reset() {
    this.state = "idle";
    this.index = 0;
    this.phaseElapsedMs = 0;
    this.phaseStartedAt = null;
    this.lastNow = null;
    this.completionReason = null;
    this.totalElapsedMs = 0;
    this._emit("timer_reset");
    return this.snapshot(this.now());
  }

  tick(now = this.now()) {
    this._advance(now);
    return this.snapshot(now);
  }

  _reject(command) {
    this._emit("command_rejected", { command, state: this.state });
    return this.snapshot(this.now());
  }

  snapshot(now = this.now()) {
    const phase = this._current();
    const elapsed = phase ? this._elapsedAt(now) : 0;
    const remaining = phase?.durationMs === null || !phase ? null : Math.max(0, phase.durationMs - elapsed);
    const remainingTotal = this.phases.slice(this.index).some(p => p.durationMs === null)
      ? null
      : (remaining ?? 0) + this.phases.slice(this.index + 1).reduce((sum, p) => sum + p.durationMs, 0);
    // Only expose progress when the engine knows the current round.
    // `countup.rounds` is a target/description, not live progress.
    const rounds = phase?.totalRounds
      ? { current: phase.round, total: phase.totalRounds }
      : null;
    let stageIndex = null;
    let stageLabel = null;
    let stageElapsedMs = null;
    if (phase?.type === "countup" && Array.isArray(phase.stages) && phase.stages.length &&
        (this.state === "running" || this.state === "paused")) {
      let offset = 0;
      const stage = phase.stages.findIndex(item => {
        const end = offset + item.durationMs;
        if (elapsed < end) return true;
        offset = end;
        return false;
      });
      if (stage >= 0) {
        stageIndex = stage;
        stageLabel = phase.stages[stage].label;
        stageElapsedMs = Math.max(0, Math.floor(elapsed - offset));
      }
    }
    const result = {
      state: this.state,
      blockIndex: phase ? this.index : null,
      blockCount: this.phases.length,
      blockType: phase?.type ?? null,
      blockLabel: phase?.label ?? null,
      phase: phase?.phase ?? null,
      phaseElapsedMs: Math.floor(elapsed),
      phaseRemainingMs: remaining === null ? null : Math.ceil(remaining),
      totalElapsedMs: Math.floor(this.totalElapsedMs + ((this.state === "running" || this.state === "paused") ? elapsed : 0)),
      totalRemainingMs: remainingTotal === null ? null : Math.ceil(remainingTotal),
      round: rounds,
      stageIndex,
      stageLabel,
      stageElapsedMs,
      completionReason: this.completionReason,
      can: {
        start: this.state === "idle",
        pause: this.state === "running",
        resume: this.state === "paused",
        finish: (this.state === "running" || this.state === "paused") && phase?.type === "countup",
        skip: (this.state === "running" || this.state === "paused") && phase?.allowSkip === true && phase?.type !== "countup",
        reset: this.state !== "idle"
      }
    };
    return result;
  }

  drainEvents() {
    const events = this.events.slice();
    this.events.length = 0;
    return events;
  }
}

export function createTimerEngine(plan, options) {
  return new TimerEngine(plan, options);
}
