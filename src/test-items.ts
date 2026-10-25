// Item fixtures shared by the unit tests (not part of the module bundle).
import type { AppendixTome } from "./appendix.ts";

// A tome with made-up booklet stats; tests override the fields they check.
export function tome(
  fields: Partial<AppendixTome> = {},
): { kind: "tome" } & AppendixTome {
  return {
    kind: "tome",
    name: "Fog Tome",
    language: "",
    author: "",
    date: "",
    physical: "",
    link: "",
    description: "Thin booklet.",
    relevance: "",
    sanityLoss: "1D4",
    cthulhuMythos: { initial: 1, final: 2 },
    mythosRating: 9,
    study: { necessary: 2, units: "CoC7.weeks" },
    spells: "",
    region: "",
    ...fields,
  };
}
