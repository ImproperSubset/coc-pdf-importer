// Unit tests for source citations: book titles from file names and the
// citation text written into Keeper notes.
import { describe, test } from "node:test";
import assert from "node:assert";
import {
  bookTitleFromFileName,
  citationHtml,
  sourceCitation,
} from "./citation.ts";

describe("bookTitleFromFileName", () => {
  test("drops the product code, version and separators, and title-cases", () => {
    assert.equal(
      bookTitleFromFileName("cha99999_-_the_two-faced_test_v1.2.pdf"),
      "The Two-Faced Test",
    );
    assert.equal(
      bookTitleFromFileName("CHA99999_-_Test_Campaign_-_Keeper_Booklet_v3.pdf"),
      "Test Campaign - Keeper Booklet",
    );
    assert.equal(
      bookTitleFromFileName("CHA99999 Test Rules for Testing.pdf"),
      "Test Rules for Testing",
    );
  });

  test('drops a trailing " - Call of Cthulhu" and keeps mixed case', () => {
    assert.equal(
      bookTitleFromFileName("The Testing Lighthouse - Call of Cthulhu.pdf"),
      "The Testing Lighthouse",
    );
    assert.equal(bookTitleFromFileName("Test of McTest.pdf"), "Test of McTest");
  });
});

describe("sourceCitation", () => {
  test("cites the printed page, else the PDF page, else the title", () => {
    assert.equal(
      sourceCitation("Test Book", { page: 12, printedPage: 11 }),
      "Test Book, p. 11",
    );
    assert.equal(
      sourceCitation("Test Book", { page: 12 }),
      "Test Book, PDF page 12",
    );
    assert.equal(sourceCitation("Test Book", {}), "Test Book");
  });

  test("the Keeper-notes paragraph is escaped", () => {
    assert.equal(
      citationHtml("A & B <C>, p. 3"),
      "<p>Source: A &amp; B &lt;C&gt;, p. 3</p>",
    );
  });
});
