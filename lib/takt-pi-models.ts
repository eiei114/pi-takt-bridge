import { spawnCommand } from "./process-control.ts";

const MAX_LIST_OUTPUT = 200_000;
const LIST_TIMEOUT_MS = 30_000;

export interface PiModelEntry {
  provider: string;
  model: string;
}

/**
 * List models Pi currently exposes (`pi --list-models`). Auth-configured
 * extension providers appear automatically, which is how bridge flows stay
 * aware of provider prerequisites without hardcoding an extension map.
 */
export async function listPiModels(command = "pi"): Promise<PiModelEntry[]> {
  const stdout = await runPiListModels(command);
  return parsePiModelList(stdout);
}

/** Parse the fixed-width table printed by `pi --list-models`. */
export function parsePiModelList(output: string): PiModelEntry[] {
  const entries = new Map<string, PiModelEntry>();
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || /^provider\s+model/i.test(trimmed)) {
      continue;
    }
    const match = /^(\S+)\s+(\S+)/.exec(trimmed);
    if (!match) {
      continue;
    }
    const entry = { provider: match[1], model: match[2] };
    entries.set(`${entry.provider}/${entry.model}`, entry);
  }
  return [...entries.values()];
}

/** Fully qualified model reference TAKT runtime profiles expect: `<provider>/<model>`. */
export function formatPiModelRef(entry: Pick<PiModelEntry, "provider" | "model">): string {
  return `${entry.provider}/${entry.model}`;
}

/**
 * Case-insensitive subsequence fuzzy match. Returns a score where higher is
 * better and 0 means "no match"; an empty query matches everything with
 * score 1 so unfiltered lists keep their natural order.
 */
export function fuzzyScore(query: string, text: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedText = text.toLowerCase();
  if (normalizedQuery.length === 0) {
    return 1;
  }
  let score = 0;
  let textIndex = 0;
  let streak = 0;
  for (const char of normalizedQuery) {
    const found = normalizedText.indexOf(char, textIndex);
    if (found < 0) {
      return 0;
    }
    streak = found === textIndex ? streak + 1 : 1;
    score += 1 + streak * 0.5 + (found === 0 ? 1 : 0);
    textIndex = found + 1;
  }
  // Prefer shorter candidates when scores tie (closer to an exact id).
  return score + Math.max(0, 2 - normalizedText.length / normalizedQuery.length / 10);
}

export function filterByFuzzyQuery<T>(
  items: readonly T[],
  query: string,
  getText: (item: T) => string,
  limit = 40,
): T[] {
  const scored = items
    .map((item) => ({ item, score: fuzzyScore(query, getText(item)) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
  return scored.slice(0, limit).map((entry) => entry.item);
}

function resolvePiCommand(command: string): string {
  if (process.platform !== "win32" || /[\\/]/.test(command) || /\.(?:cmd|exe|bat)$/i.test(command)) {
    return command;
  }
  return `${command}.cmd`;
}

function runPiListModels(command: string): Promise<string> {
  const resolved = resolvePiCommand(command);
  return new Promise((resolvePromise, rejectPromise) => {
    let child: ReturnType<typeof spawnCommand>;
    try {
      child = spawnCommand(resolved, ["--list-models"], {
        cwd: process.cwd(),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      rejectPromise(new Error(`pi --list-models could not start: ${errorMessage(error)}`));
      return;
    }

    let settled = false;
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        // The timed-out list child is already exiting.
      }
      rejectPromise(new Error(`pi --list-models timed out after ${LIST_TIMEOUT_MS}ms`));
    }, LIST_TIMEOUT_MS);

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(error);
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout, "utf8") > MAX_LIST_OUTPUT) {
        fail(new Error(`pi --list-models exceeded the ${MAX_LIST_OUTPUT}-byte output limit`));
        try {
          child.kill();
        } catch {
          // The oversized-list child is already exiting.
        }
      }
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-500);
    });
    child.once("error", (error) => fail(new Error(`pi --list-models could not start: ${errorMessage(error)}`)));
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0 || signal !== null) {
        const detail = stderr.trim();
        fail(new Error(`pi --list-models failed (exit ${code ?? signal ?? "unknown"})${detail ? `: ${detail}` : ""}`));
        return;
      }
      resolvePromise(stdout);
    });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
