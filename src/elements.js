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
    return {
      ...base,
      text: props.text || "",
      originalText: props.text || "",
      fontSize: props.fontSize || 20,
      fontFamily: props.fontFamily || 5,
      textAlign: props.textAlign || "left",
      verticalAlign: props.verticalAlign || "top",
      lineHeight: props.lineHeight || 1.25,
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
