import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { killWindowsProcessTree } from "../lib/process-control.ts";
import { TaktRunController } from "../lib/takt-run-controller.ts";

function createExitCommand(directory) {
  if (process.platform === "win32") {
    const command = join(directory, "natural-exit.cmd");
    writeFileSync(command, "@echo natural exit\r\n", "utf8");
    return command;
  }
  const command = join(directory, "natural-exit.sh");
  writeFileSync(command, "#!/bin/sh\nprintf 'natural exit\\n'\n", "utf8");
  chmodSync(command, 0o755);
  return command;
}

function createBlockingCommand(directory) {
  if (process.platform === "win32") {
    const command = join(directory, "blocking.cmd");
    writeFileSync(command, "@echo blocking\r\n@ping -n 20 127.0.0.1 >nul\r\n", "utf8");
    return command;
  }
  const command = join(directory, "blocking.sh");
  writeFileSync(command, "#!/bin/sh\nsleep 20\n", "utf8");
  chmodSync(command, 0o755);
  return command;
}

test("natural PTY exit reconciles to completed and remains disposable", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-takt-bridge-lifecycle-"));
  const controller = new TaktRunController({ cwd, command: createExitCommand(cwd), cols: 40, rows: 4 });

  try {
    await controller.start(["exec", "preset"]);
    const exit = await controller.waitForExit(5_000);

    assert.equal(exit?.code, 0);
    assert.equal(controller.isRunning, false);
    assert.equal(controller.hasSession, true);
    assert.equal(controller.status, "completed");
    assert.equal(typeof controller.pid, "number");
    assert.equal(controller.lastExit?.code, 0);
    assert.equal(controller.reconcile().status, "completed");
    await controller.stop();
    assert.equal(controller.status, "completed");

    await controller.dispose();
    assert.equal(controller.hasSession, false);
    assert.equal(controller.isRunning, false);
    assert.equal(controller.status, "completed");
    assert.equal(controller.lastExit?.code, 0);

    await controller.start(["exec", "next"]);
    const nextExit = await controller.waitForExit(5_000);
    assert.equal(nextExit?.code, 0);
    await controller.dispose();
    assert.equal(controller.status, "completed");
  } finally {
    if (controller.isRunning || controller.hasSession) {
      await controller.dispose();
    }
  }
});

test("waitForExit reports a bounded timeout and remains disposable", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-takt-bridge-timeout-"));
  const controller = new TaktRunController({ cwd, command: createBlockingCommand(cwd), cols: 40, rows: 4 });

  try {
    await controller.start(["exec", "blocking"]);
    await assert.rejects(
      () => controller.waitForExit(20),
      /TAKT process did not exit within 0.02 seconds/,
    );
  } finally {
    if (controller.isRunning || controller.hasSession) {
      await controller.dispose();
    }
  }
});

test("stop marks an unkillable PTY stale and suppresses a fresh start", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-takt-bridge-stop-timeout-"));
  const blockingArgs = ["-e", "process.on('SIGINT', () => {}); setTimeout(() => {}, 20000)"];
  let forceKillAttempts = 0;
  const controller = new TaktRunController({
    cwd,
    command: process.execPath,
    cols: 40,
    rows: 4,
    interrupt: () => {},
    forceKill: async (pty) => {
      forceKillAttempts += 1;
      if (forceKillAttempts > 1) {
        if (process.platform === "win32") {
          await killWindowsProcessTree(pty.pid);
        } else {
          pty.kill("SIGKILL");
        }
      }
    },
  });

  try {
    await controller.start(blockingArgs);
    await assert.rejects(
      () => controller.stop(),
      /TAKT process did not stop within 3 seconds/,
    );
    assert.equal(controller.status, "stale");
    assert.equal(controller.isRunning, true);
    assert.equal(forceKillAttempts, 1);
    await assert.rejects(
      () => controller.start(["exec", "fresh"]),
      /TAKT process is already running; stop it before starting a fresh process/,
    );
  } finally {
    if (controller.isRunning || controller.hasSession) {
      await controller.dispose();
    }
  }
  assert.equal(forceKillAttempts, 2);
});
