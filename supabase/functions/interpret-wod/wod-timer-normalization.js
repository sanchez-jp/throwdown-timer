export function removeUnsupportedCountupStages(timer, workoutFormat, sourceText) {
  if (!timer || timer.type !== "sequence" || !Array.isArray(timer.blocks) ||
      !["for_time", "rounds_for_time"].includes(workoutFormat)) return timer;

  const hasExplicitStageRanges = typeof sourceText === "string" &&
    /(?:^|\n)\s*\d+\s*['′’]\s*[–—-]\s*\d+\s*['′’]/m.test(sourceText);
  if (hasExplicitStageRanges) return timer;

  return {
    ...timer,
    blocks: timer.blocks.map((block) => {
      if (block?.type !== "countup" || !Array.isArray(block.stages)) return block;
      const durationsValid = block.stages.every((stage) => Number.isInteger(stage?.durationSeconds) && stage.durationSeconds > 0);
      const capValid = Number.isInteger(block.timeCapSeconds) && block.timeCapSeconds > 0;
      const sum = durationsValid ? block.stages.reduce((total, stage) => total + stage.durationSeconds, 0) : null;
      if (capValid && sum === block.timeCapSeconds) return block;
      const { stages: _unsupportedStages, ...withoutStages } = block;
      return withoutStages;
    }),
  };
}
