import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CreatureArtMatcher, isDefaultArt } from "./creatureart.ts";

describe("CreatureArtMatcher", () => {
  const matcher = new CreatureArtMatcher([
    { name: "Mire Worm", img: "art/worm.webp", token: "tokens/worm.webp" },
    {
      name: "Fen Hound (Grey)",
      img: "art/hound.webp",
      token: "icons/svg/mystery-man.svg",
    },
    {
      name: "Bog Rat",
      img: "systems/CoC7/assets/icons/floating-tentacles.svg",
      token: "",
    },
  ]);

  test("matches a name loosely, or with a qualifier after it", () => {
    assert.equal(matcher.match("The Mire Worms")?.img, "art/worm.webp");
    assert.equal(
      matcher.match("Mire Worm of the Deep")?.token,
      "tokens/worm.webp",
    );
    assert.equal(matcher.match("Fen Hound")?.img, "art/hound.webp");
  });

  test("a default token icon falls back to the portrait", () => {
    assert.equal(matcher.match("Fen Hound")?.token, "art/hound.webp");
  });

  test("a creature with default art offers none", () => {
    assert.equal(matcher.match("Bog Rat"), undefined);
    assert.equal(matcher.match("Mire"), undefined);
  });

  test("system icons are default art", () => {
    assert.equal(isDefaultArt("systems/CoC7/assets/icons/cultist.svg"), true);
    assert.equal(isDefaultArt("icons/svg/mystery-man.svg"), true);
    assert.equal(isDefaultArt(""), true);
    assert.equal(isDefaultArt("modules/x/art/worm.webp"), false);
  });
});
