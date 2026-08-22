import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface TaktTaskFileEntry {
  name: string;
  status?: string;
  [key: string]: unknown;
}

export interface TaktTaskFile {
  tasks: TaktTaskFileEntry[];
}

export function taktTasksFilePath(cwd: string): string {
  return join(cwd, ".takt", "tasks.yaml");
}

/**
 * Read `.takt/tasks.yaml` into an editable structure. Returns undefined when
 * the file is absent; throws on unparseable YAML so callers can surface the
 * error instead of silently mangling the queue.
 */
export function readTaktTaskFile(cwd: string): TaktTaskFile | undefined {
  const filePath = taktTasksFilePath(cwd);
  if (!existsSync(filePath)) {
    return undefined;
  }
  const parsed: unknown = parseYaml(readFileSync(filePath, "utf8"));
  if (parsed === null || parsed === undefined) {
    return undefined;
  }
  if (typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray((parsed as TaktTaskFile).tasks)) {
    throw new Error(`.takt/tasks.yaml has an unexpected shape: ${filePath}`);
  }
  return parsed as TaktTaskFile;
}

function writeTaktTaskFile(cwd: string, doc: TaktTaskFile): void {
  writeFileSync(taktTasksFilePath(cwd), stringifyYaml(doc), "utf8");
}

/** Remove a task by its `name` field. Returns true when a task was removed. */
export function removeTaktTask(cwd: string, name: string): boolean {
  const doc = readTaktTaskFile(cwd);
  if (doc === undefined) {
    return false;
  }
  const before = doc.tasks.length;
  doc.tasks = doc.tasks.filter((task) => task.name !== name);
  if (doc.tasks.length === before) {
    return false;
  }
  writeTaktTaskFile(cwd, doc);
  return true;
}

/**
 * Reset a task back to pending: clears ownership/timing so the next queue run
 * picks it up again. Returns true when the task existed and was reset.
 */
export function resetTaktTaskToPending(cwd: string, name: string): boolean {
  const doc = readTaktTaskFile(cwd);
  if (doc === undefined) {
    return false;
  }
  const task = doc.tasks.find((entry) => entry.name === name);
  if (task === undefined) {
    return false;
  }
  task.status = "pending";
  task.started_at = null;
  task.completed_at = null;
  task.owner_pid = null;
  writeTaktTaskFile(cwd, doc);
  return true;
}