import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { applyTableNames } from "./tables.ts";

const member = (title: string, label: string): any => ({
  name: `${title} ${label}`,
  table: { title, label, folder: title },
});

describe("applyTableNames", () => {
  test("names a listed table's members and files them under its folder", () => {
    const actors = [
      member("Average Grue Cultists (Fogland) Assorted Thugs", "3"),
      member("Mist Rowdies, Damp Agitants", "Bert"),
      member("Unlisted Table", "1"),
    ];
    const unused = applyTableNames(
      [
        {
          table: "Average Grue Cultists (Fogland) Assorted Thugs",
          folder: "Grue Cultists (Fogland)",
          member: "Grue Cultist {label}",
        },
        {
          table: "Mist Rowdies, Damp Agitants",
          folder: "Mist Rowdies",
          member: "{label}",
        },
        { table: "No Such Table", folder: "None", member: "{label}" },
      ],
      actors,
    );
    assert.deepEqual(
      actors.map((a) => [a.name, a.table.folder]),
      [
        ["Grue Cultist 3", "Grue Cultists (Fogland)"],
        ["Bert", "Mist Rowdies"],
        ["Unlisted Table 1", "Unlisted Table"],
      ],
    );
    assert.deepEqual(
      unused.map((n) => n.table),
      ["No Such Table"],
    );
  });
});
