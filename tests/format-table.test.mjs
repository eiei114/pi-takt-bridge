import assert from "node:assert/strict";
import test from "node:test";

const { formatTable } = await import("../lib/format-table.ts");

test("formatTable renders aligned columns", () => {
  const lines = formatTable(
    [
      { name: "Box", width: 3 },
      { name: "Loader", width: 6 },
    ],
    [
      { header: "Component", render: (row) => row.name },
      { header: "Width", align: "right", render: (row) => String(row.width) },
    ],
  );

  assert.equal(lines.length, 4);
  assert.match(lines[0], /Component\s+Width/);
  assert.match(lines[2], /Box\s+3/);
  assert.match(lines[3], /Loader\s+6/);
});
