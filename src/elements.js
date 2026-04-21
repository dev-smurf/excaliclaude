const { randomUUID } = require("node:crypto");

const BASE_DEFAULTS = {
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  roundness: null,
  groupIds: [],
  frameId: null,
  boundElements: null,
  link: null,
  locked: false,
  isDeleted: false,
};

function randomSeed() {
  return Math.floor(Math.random() * 2147483646);
}

function makeElement(type, props) {
  const base = {
    ...BASE_DEFAULTS,
    id: randomUUID(),
    type,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    seed: randomSeed(),
    version: 1,
    versionNonce: randomSeed(),
    updated: Date.now(),
    index: null,
    ...props,
  };

  if (type === "text") {
    const text = props.text || "";
    const fontSize = props.fontSize || 20;
    const lineHeight = props.lineHeight || 1.25;
    const lines = text.split("\n");
    const maxLineLen = Math.max(...lines.map((l) => l.length));
    const estimatedWidth = props.width || Math.ceil(maxLineLen * fontSize * 0.55);
    const estimatedHeight =
      props.height || Math.ceil(lines.length * fontSize * lineHeight);

    return {
      ...base,
      width: estimatedWidth,
      height: estimatedHeight,
      text,
      originalText: text,
      fontSize,
      fontFamily: props.fontFamily || 5,
      textAlign: props.textAlign || "left",
      verticalAlign: props.verticalAlign || "top",
      lineHeight,
      autoResize: true,
      containerId: props.containerId || null,
    };
  }

  if (type === "arrow" || type === "line") {
    return {
      ...base,
      points: props.points || [[0, 0]],
      startArrowhead: props.startArrowhead || null,
      endArrowhead: type === "arrow" ? (props.endArrowhead ?? "arrow") : null,
      startBinding: props.startBinding || null,
      endBinding: props.endBinding || null,
      elbowed: props.elbowed || false,
    };
  }

  return base;
}

function incrementVersion(element) {
  return {
    ...element,
    version: element.version + 1,
    versionNonce: randomSeed(),
    updated: Date.now(),
  };
}

module.exports = { makeElement, incrementVersion, BASE_DEFAULTS };
