import assert from "node:assert/strict";
import test from "node:test";

const { createTaktInputQueue } = await import("../lib/takt-input-queue.ts");

test("queue preserves order and joins sendable lines as one batch", () => {
  const queue = createTaktInputQueue();
  assert.equal(queue.depth(), 0);

  queue.enqueue("first line");
  queue.enqueue("second line");
  assert.equal(queue.depth(), 2);

  const result = queue.takeBatch();
  assert.equal(result.batch, "first line\nsecond line");
  assert.equal(result.sentCount, 2);
  assert.equal(result.heldDestructive, 0);
  assert.equal(queue.depth(), 0);
});

test("destructive entries are held back and stay queued", () => {
  const queue = createTaktInputQueue();
  queue.enqueue("safe text");
  queue.enqueue("/clear");
  queue.enqueue("more safe");

  const result = queue.takeBatch();
  assert.equal(result.batch, "safe text\nmore safe");
  assert.equal(result.sentCount, 2);
  assert.equal(result.heldDestructive, 1);
  assert.equal(queue.depth(), 1); // destructive stays for explicit confirmation

  // A second flush has nothing sendable while the held entry remains.
  const second = queue.takeBatch();
  assert.equal(second.batch, undefined);
  assert.equal(second.heldDestructive, 1);

  queue.clearAll();
  assert.equal(queue.depth(), 0);
});

test("empty enqueues are ignored", () => {
  const queue = createTaktInputQueue();
  assert.equal(queue.enqueue(""), 0);
});
