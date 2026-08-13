import { spawn, type ChildProcess } from "node:child_process";

/** Stop a child with a graceful signal, then kill its process tree if needed. */
export async function stopChild(
  child: ChildProcess,
  signal: NodeJS.Signals = "SIGTERM",
  graceMs = 1_000,
): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  try {
    child.kill(signal);
  } catch {
    return;
  }

  if (await waitForExit(child, graceMs)) {
    return;
  }

  if (process.platform === "win32" && child.pid !== undefined) {
    await killWindowsProcessTree(child.pid);
  } else {
    try {
      child.kill("SIGKILL");
    } catch {
      // Best effort; the close listener still reconciles the next state poll.
    }
  }
  await waitForExit(child, graceMs);
}

export function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("close", () => finish(true));
  });
}

async function killWindowsProcessTree(pid: number): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    const timer = setTimeout(finish, 2_000);
    killer.once("close", finish);
    killer.once("error", finish);
  });
}
