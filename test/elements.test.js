const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { makeElement, incrementVersion } = require("../src/elements.js");

describe("makeElement", () => {
  it("creates a rectangle with all required fields", () => {
    const el = makeElement("rectangle", { x: 100, y: 200, width: 300, height: 150 });

    assert.equal(el.type, "rectangle");
    assert.equal(el.x, 100);
    assert.equal(el.y, 200);
    assert.equal(el.width, 300);
    assert.equal(el.height, 150);
    assert.equal(el.version, 1);
    assert.equal(el.isDeleted, false);
    assert.equal(el.locked, false);
    assert.equal(typeof el.id, "string");
    assert.ok(el.id.length > 10);
    assert.equal(typeof el.seed, "number");
    assert.equal(typeof el.versionNonce, "number");
    assert.equal(typeof el.updated, "number");
  });

  it("creates unique IDs for each element", () => {
    const a = makeElement("rectangle", {});
    const b = makeElement("rectangle", {});
    assert.notEqual(a.id, b.id);
  });

  it("creates unique seeds", () => {
    const a = makeElement("rectangle", {});
    const b = makeElement("rectangle", {});
    assert.notEqual(a.seed, b.seed);
  });

  it("applies custom styling props", () => {
    const el = makeElement("rectangle", {
      strokeColor: "#ff0000",
      backgroundColor: "#a5d8ff",
      fillStyle: "hachure",
      roundness: { type: 3 },
    });
    assert.equal(el.strokeColor, "#ff0000");
    assert.equal(el.backgroundColor, "#a5d8ff");
    assert.equal(el.fillStyle, "hachure");
    assert.deepEqual(el.roundness, { type: 3 });
  });

  it("creates a text element with text-specific fields", () => {
    const el = makeElement("text", { text: "Hello", x: 50, y: 50 });

    assert.equal(el.type, "text");
    assert.equal(el.text, "Hello");
    assert.equal(el.originalText, "Hello");
    assert.equal(el.fontSize, 20);
    assert.equal(el.fontFamily, 5);
    assert.equal(el.textAlign, "left");
    assert.equal(el.verticalAlign, "top");
    assert.equal(el.lineHeight, 1.25);
    assert.equal(el.autoResize, true);
    assert.equal(el.containerId, null);
  });

  it("creates an arrow with points and arrowhead", () => {
    const el = makeElement("arrow", {
      x: 100,
      y: 100,
      width: 200,
      height: 0,
      points: [[0, 0], [200, 0]],
    });

    assert.equal(el.type, "arrow");
    assert.deepEqual(el.points, [[0, 0], [200, 0]]);
    assert.equal(el.endArrowhead, "arrow");
    assert.equal(el.startArrowhead, null);
    assert.equal(el.elbowed, false);
  });

  it("creates a line without arrowheads", () => {
    const el = makeElement("line", {
      points: [[0, 0], [100, 100]],
    });

    assert.equal(el.type, "line");
    assert.equal(el.endArrowhead, null);
    assert.equal(el.startArrowhead, null);
  });

  it("creates an ellipse", () => {
    const el = makeElement("ellipse", { x: 50, y: 50, width: 100, height: 80 });
    assert.equal(el.type, "ellipse");
    assert.equal(el.width, 100);
  });

  it("creates a diamond", () => {
    const el = makeElement("diamond", { x: 50, y: 50, width: 100, height: 100 });
    assert.equal(el.type, "diamond");
  });

  it("allows overriding the ID", () => {
    const el = makeElement("rectangle", { id: "custom-id" });
    assert.equal(el.id, "custom-id");
  });
});

describe("incrementVersion", () => {
  it("increments version by 1", () => {
    const original = makeElement("rectangle", {});
    const updated = incrementVersion(original);

    assert.equal(updated.version, 2);
    assert.notEqual(updated.versionNonce, original.versionNonce);
    assert.ok(updated.updated >= original.updated);
  });

  it("does not mutate the original", () => {
    const original = makeElement("rectangle", {});
    const originalVersion = original.version;
    incrementVersion(original);

    assert.equal(original.version, originalVersion);
  });

  it("preserves all other fields", () => {
    const original = makeElement("rectangle", {
      x: 42,
      y: 99,
      strokeColor: "#ff0000",
    });
    const updated = incrementVersion(original);

    assert.equal(updated.x, 42);
    assert.equal(updated.y, 99);
    assert.equal(updated.strokeColor, "#ff0000");
    assert.equal(updated.id, original.id);
  });
});
