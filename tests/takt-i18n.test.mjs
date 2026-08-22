import assert from "node:assert/strict";
import test from "node:test";

const { formatTaktInputModeLine } = await import("../lib/takt-input-mode.ts");
const {
  renderTaktProjectStack,
} = await import("../lib/takt-live-panel.ts");
const {
  setTaktLang,
  taktLang,
  toggleTaktLang,
  t,
} = await import("../lib/takt-i18n.ts");

test("widget messages default to English and switch to Japanese", () => {
  setTaktLang("en");
  assert.equal(taktLang(), "en");
  assert.match(formatTaktInputModeLine("pi"), /typing in Pi/);

  setTaktLang("ja");
  assert.equal(taktLang(), "ja");
  assert.match(formatTaktInputModeLine("pi"), /Piに入力中/);
  assert.equal(t("workingState"), "処理中");

  toggleTaktLang();
  assert.equal(taktLang(), "en");
});

test("header renders session counts per language", async () => {
  const runner = { terminal: undefined, hasSession: true, isRunning: true, resize() {} };
  const projects = [{
    id: "a", label: "pg", cwd: "C:/pg", runner, stage: "running",
    summary: { cwd: "C:/pg", status: "live", running: 1, pending: 0, blocked: 0,
      failed: 0, completed: 0, stale: 0,
      runs: [{ slug: "r", task: "t", workflow: "wf", status: "running", sessionStatus: "live" }] },
  }];
  const now = Date.parse("2026-08-20T00:00:00.000Z");

  setTaktLang("en");
  const en = renderTaktProjectStack(projects, 80, "pi", { now });
  assert.ok(en.some((line) => line.includes("🎭 TAKT · 1 session") && line.includes("1 running")));

  setTaktLang("ja");
  const ja = renderTaktProjectStack(projects, 80, "pi", { now });
  assert.ok(ja.some((line) => line.includes("1セッション") && line.includes("実行1")));

  setTaktLang("en");
});
