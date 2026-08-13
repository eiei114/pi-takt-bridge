export const TAKT_EXEC_STAGES = [
  "idle",
  "clearing",
  "starting",
  "waiting_prompt",
  "pasting",
  "sending_go",
  "running",
  "stopping",
  "stopped",
  "failed",
] as const;

export type TaktExecStage = (typeof TAKT_EXEC_STAGES)[number];

/** Stages where the raw PTY still shows a huge pasted prompt and looks frozen. */
const PROMPT_OVERLAY_STAGES: ReadonlySet<TaktExecStage> = new Set([
  "pasting",
  "sending_go",
]);

export function isTaktExecStage(value: string | undefined): value is TaktExecStage {
  return value !== undefined && (TAKT_EXEC_STAGES as readonly string[]).includes(value);
}

export function formatTaktExecStage(stage: TaktExecStage): string {
  return stage;
}

export function shouldOverlayPromptPreview(stage: TaktExecStage | undefined): boolean {
  return stage !== undefined && PROMPT_OVERLAY_STAGES.has(stage);
}

/**
 * Build a short prompt preview for widget/tool display.
 * Keeps head/tail context without dumping the full pasted body.
 */
export function summarizeTaktPrompt(
  prompt: string,
  options: { headLines?: number; tailLines?: number; maxChars?: number } = {},
): string {
  const headLines = Math.max(1, options.headLines ?? 2);
  const tailLines = Math.max(0, options.tailLines ?? 1);
  const maxChars = Math.max(40, options.maxChars ?? 240);
  const normalized = prompt.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trimEnd();
  if (!normalized) {
    return "(empty prompt)";
  }

  const lines = normalized.split("\n");
  const totalChars = normalized.length;
  if (lines.length <= headLines + tailLines && totalChars <= maxChars) {
    return normalized;
  }

  const head = lines.slice(0, headLines);
  const tail = tailLines > 0 ? lines.slice(-tailLines) : [];
  const omittedLines = Math.max(0, lines.length - head.length - tail.length);
  const preview = [
    ...head,
    omittedLines > 0 ? `…(${omittedLines} more lines, ${totalChars} chars)` : `…(${totalChars} chars)`,
    ...tail,
  ].join("\n");

  if (preview.length <= maxChars) {
    return preview;
  }
  return `${preview.slice(0, maxChars - 1)}…`;
}
