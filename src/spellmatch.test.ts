import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  SpellMatcher,
  alternativeNames,
  tomeSpellNames,
} from "./spellmatch.ts";

describe("tomeSpellNames", () => {
  test("splits a printed list and drops its full stop", () => {
    assert.deepEqual(
      tomeSpellNames("Fog Ward, Summon/Bind Mist Beast and Dim Light."),
      ["Fog Ward", "Summon/Bind Mist Beast", "Dim Light"],
    );
  });

  test("reads none as no spells", () => {
    assert.deepEqual(tomeSpellNames("none"), []);
    assert.deepEqual(tomeSpellNames(""), []);
  });
});

describe("alternativeNames", () => {
  test("reads a list of names", () => {
    assert.deepEqual(alternativeNames("<p>The Grey Hand, Ye Misty Doom.</p>"), [
      "The Grey Hand",
      "Ye Misty Doom",
    ]);
  });

  test("reads prose about naming as no names", () => {
    assert.deepEqual(
      alternativeNames(
        "<p>Each name echoes the god, its titles, and so on.</p>",
      ),
      [],
    );
  });
});

describe("SpellMatcher", () => {
  const matcher = new SpellMatcher([
    { name: "Contact Deity: Mistgod", value: "deity" },
    { name: "Contact Fog Hound", value: "hound" },
    { name: "Shriveling Mist", value: "mist" },
    { name: "Fog Ward (Variant)", value: "ward" },
    { name: "Wither Shade", alternatives: ["The Grey Hand"], value: "shade" },
    { name: "Dim Light", value: "dim1" },
    { name: "Dim  Light", value: "dim2" },
  ]);

  test("matches the name as printed, loosely", () => {
    assert.equal(matcher.match("contact fog hound"), "hound");
    assert.equal(matcher.match("Contact Fog Hounds"), "hound");
    assert.equal(matcher.match("Shrivelling Mist"), "mist");
  });

  test("matches a deity spell without Deity:", () => {
    assert.equal(matcher.match("Contact Mistgod"), "deity");
    assert.equal(matcher.match("Contact Deity: Mistgod"), "deity");
  });

  test("matches a name without its parenthetical", () => {
    assert.equal(matcher.match("Fog Ward"), "ward");
  });

  test("matches an alternative name", () => {
    assert.equal(matcher.match("The Grey Hand"), "shade");
  });

  test("matches nothing for an unknown or ambiguous name", () => {
    assert.equal(matcher.match("Lost Spell"), undefined);
    assert.equal(matcher.match("Dim Light"), undefined);
  });
});
