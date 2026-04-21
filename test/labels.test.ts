import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  estimateTextDimensions,
  isDarkBackground,
  buildShapeLabel,
  buildArrowLabel,
} from "../src/labels.js";
import { makeElement } from "../src/elements.js";
import type { TextElement, LinearElement } from "../src/types.js";

describe("estimateTextDimensions", () => {
  it("returns positive width and height for non-empty text", () => {
    const { width, height } = estimateTextDimensions("Hello", 16);
    assert.ok(width > 0);
    assert.ok(height > 0);
  });

  it("returns larger height for multiline text", () => {
    const single = estimateTextDimensions("Hello", 16);
    const multi = estimateTextDimensions("Hello\nWorld\nFoo", 16);
    assert.ok(multi.height > single.height);
  });

  it("returns larger width for longer text", () => {
    const short = estimateTextDimensions("Hi", 16);
    const long = estimateTextDimensions("Hello World This Is Long", 16);
    assert.ok(long.width > short.width);
  });

  it("scales with fontSize", () => {
    const small = estimateTextDimensions("Hello", 12);
    const large = estimateTextDimensions("Hello", 24);
    assert.ok(large.width > small.width);
    assert.ok(large.height > small.height);
  });
});

describe("isDarkBackground", () => {
  it("returns false for transparent", () => {
    assert.equal(isDarkBackground("transparent", "solid"), false);
  });

  it("returns false for non-solid fill", () => {
    assert.equal(isDarkBackground("#000000", "hachure"), false);
  });

  it("returns true for black", () => {
    assert.equal(isDarkBackground("#000000", "solid"), true);
  });

  it("returns true for dark gray", () => {
    assert.equal(isDarkBackground("#1e1e1e", "solid"), true);
  });

  it("returns false for white", () => {
    assert.equal(isDarkBackground("#ffffff", "solid"), false);
  });

  it("returns false for light blue", () => {
    assert.equal(isDarkBackground("#a5d8ff", "solid"), false);
  });

  it("returns true for dark purple", () => {
    assert.equal(isDarkBackground("#2d1b69", "solid"), true);
  });

  it("handles 3-char hex (#000)", () => {
    assert.equal(isDarkBackground("#000", "solid"), true);
  });

  it("handles 3-char hex (#fff)", () => {
    assert.equal(isDarkBackground("#fff", "solid"), false);
  });

  it("handles 3-char hex (#333)", () => {
    assert.equal(isDarkBackground("#333", "solid"), true);
  });

  it("returns false for invalid color format", () => {
    assert.equal(isDarkBackground("rgb(0,0,0)", "solid"), false);
    assert.equal(isDarkBackground("black", "solid"), false);
  });
});

describe("buildShapeLabel", () => {
  it("creates a text element bound to the shape", () => {
    const shape = makeElement("rectangle", {
      x: 100,
      y: 100,
      width: 200,
      height: 80,
      backgroundColor: "transparent",
    });
    const label = buildShapeLabel(shape, { text: "Hello" });

    assert.equal(label.type, "text");
    assert.equal((label as TextElement).text, "Hello");
    assert.equal((label as TextElement).containerId, shape.id);
    assert.ok(
      shape.boundElements?.some(
        (b) => b.id === label.id && b.type === "text"
      )
    );
  });

  it("centers label inside the shape", () => {
    const shape = makeElement("rectangle", {
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    });
    const label = buildShapeLabel(shape, { text: "Hi" });

    // Label uses full container width for proper textAlign: "center"
    assert.equal(label.x, shape.x);
    assert.equal(label.width, shape.width);
    assert.ok(label.y > shape.y);
    assert.ok(label.y < shape.y + shape.height);
  });

  it("uses white text on dark background", () => {
    const shape = makeElement("rectangle", {
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      backgroundColor: "#1e1e1e",
      fillStyle: "solid",
    });
    const label = buildShapeLabel(shape, { text: "test" });
    assert.equal(label.strokeColor, "#ffffff");
  });

  it("uses dark text on light background", () => {
    const shape = makeElement("rectangle", {
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      backgroundColor: "#a5d8ff",
      fillStyle: "solid",
    });
    const label = buildShapeLabel(shape, { text: "test" });
    assert.equal(label.strokeColor, "#1e1e1e");
  });

  it("respects custom fontSize", () => {
    const shape = makeElement("rectangle", {
      x: 0,
      y: 0,
      width: 200,
      height: 80,
    });
    const label = buildShapeLabel(shape, { text: "Big", fontSize: 24 });
    assert.equal((label as TextElement).fontSize, 24);
  });
});

describe("buildArrowLabel", () => {
  it("places label above horizontal arrows", () => {
    const arrow = makeElement("arrow", {
      x: 100,
      y: 200,
      width: 150,
      height: 0,
      points: [
        [0, 0],
        [150, 0],
      ],
    });
    const label = buildArrowLabel(arrow, { text: "go" });

    assert.equal(label.type, "text");
    assert.ok(label.y < 200, "label should be above the arrow");
  });

  it("places label to the right of vertical arrows", () => {
    const arrow = makeElement("arrow", {
      x: 100,
      y: 200,
      width: 0,
      height: 150,
      points: [
        [0, 0],
        [0, 150],
      ],
    });
    const label = buildArrowLabel(arrow, { text: "down" });

    assert.ok(label.x > 100, "label should be to the right");
  });

  it("uses explicit x,y when provided", () => {
    const arrow = makeElement("arrow", {
      x: 100,
      y: 200,
      points: [
        [0, 0],
        [150, 0],
      ],
    });
    const label = buildArrowLabel(arrow, {
      text: "custom",
      x: 500,
      y: 600,
    });

    assert.equal(label.x, 500);
    assert.equal(label.y, 600);
  });

  it("uses gray color for arrow labels", () => {
    const arrow = makeElement("arrow", {
      x: 0,
      y: 0,
      points: [
        [0, 0],
        [100, 0],
      ],
    });
    const label = buildArrowLabel(arrow, { text: "test" });
    assert.equal(label.strokeColor, "#888888");
  });
});
