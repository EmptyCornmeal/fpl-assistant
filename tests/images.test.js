// tests/images.test.js
import { describe, it, assert } from "./testRunner.js";

describe("image helpers", () => {
  it("builds proxied player image URL", async () => {
    global.window = {
      __FPL_API_BASE__: "https://worker.example/api",
      location: { origin: "https://worker.example" },
    };
    const { getPlayerImage } = await import("../js/lib/images.js");
    const url = getPlayerImage("12345");
    assert.ok(url.includes("/player-photo/12345"), "URL should point to player-photo endpoint");
    assert.ok(url.startsWith("https://worker.example/api"), "URL should respect api base");
  });

  it("falls back to placeholder when api base missing", async () => {
    const { getPlayerImage, PLAYER_PLACEHOLDER_SRC } = await import("../js/lib/images.js");
    const url = getPlayerImage(null);
    assert.equal(url, PLAYER_PLACEHOLDER_SRC, "Should return placeholder when no photo id");
  });
});
