import { describe, it, assert, beforeAll } from "./testRunner.js";

let images;

describe("Image helper", () => {
  beforeAll(async () => {
    global.window = { location: { href: "https://example.com/app/" } };
    global.localStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
    images = await import("../js/lib/images.js");
  });

  it("builds worker-backed player photo URL", () => {
    const { src } = images.getPlayerImageSources("12345");
    assert.ok(src.endsWith("/player-photo/12345"), "Should point at worker photo route");
  });

  it("falls back to placeholder when missing", () => {
    const { src, fallback } = images.getPlayerImageSources(null);
    assert.equal(src, images.PLAYER_PLACEHOLDER_SRC);
    assert.equal(fallback, images.PLAYER_PLACEHOLDER_SRC);
  });
});
