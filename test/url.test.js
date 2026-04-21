const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { parseCollabUrl } = require("../src/url.js");

describe("parseCollabUrl", () => {
  it("parses a valid collab URL", () => {
    const url =
      "https://excalidraw.com/#room=2d29daaec7bcd385353b,0p4wwhQCljrUc-33Qqql2w";
    const result = parseCollabUrl(url);
    assert.equal(result.roomId, "2d29daaec7bcd385353b");
    assert.equal(result.roomKey, "0p4wwhQCljrUc-33Qqql2w");
  });

  it("parses URL with extra path segments", () => {
    const url =
      "https://excalidraw.com/some/path#room=abcdef1234567890abcd,AAAAAAAAAA_BBBBB-CCCC";
    const result = parseCollabUrl(url);
    assert.equal(result.roomId, "abcdef1234567890abcd");
    assert.equal(result.roomKey, "AAAAAAAAAA_BBBBB-CCCC");
  });

  it("throws on empty string", () => {
    assert.throws(() => parseCollabUrl(""), /non-empty string/);
  });

  it("throws on non-string input", () => {
    assert.throws(() => parseCollabUrl(null), /non-empty string/);
    assert.throws(() => parseCollabUrl(123), /non-empty string/);
    assert.throws(() => parseCollabUrl(undefined), /non-empty string/);
  });

  it("throws on URL without #room fragment", () => {
    assert.throws(() => parseCollabUrl("https://excalidraw.com/"), /Invalid/);
  });

  it("throws on URL with malformed room fragment", () => {
    assert.throws(
      () => parseCollabUrl("https://excalidraw.com/#room=abc"),
      /Invalid/
    );
  });

  it("throws on room ID that is too short", () => {
    assert.throws(
      () =>
        parseCollabUrl(
          "https://excalidraw.com/#room=abc,0p4wwhQCljrUc-33Qqql2w"
        ),
      /too short/
    );
  });

  it("throws on room key that is too short", () => {
    assert.throws(
      () =>
        parseCollabUrl(
          "https://excalidraw.com/#room=2d29daaec7bcd385353b,abc"
        ),
      /too short/
    );
  });

  it("rejects room ID with non-hex characters", () => {
    assert.throws(
      () =>
        parseCollabUrl(
          "https://excalidraw.com/#room=ZZZZZZZZZZZZZZZZZZZZ,0p4wwhQCljrUc-33Qqql2w"
        ),
      /Invalid/
    );
  });
});
