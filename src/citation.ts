// Source citations for imported documents: the book's title and the page an
// entry is printed on, written into each document's Keeper notes (and its
// `source` field where the CoC7 type has one).

// Words a title keeps lowercase unless it starts the title.
const TITLE_CONNECTORS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

// A book title from its PDF's file name: the Chaosium product code, a version
// suffix and a trailing " - Call of Cthulhu" are dropped and underscores read
// as spaces; a name in a single case is title-cased.
//   "cha23125_-_the_two-headed_serpent_v1.2.pdf" -> "The Two-Headed Serpent"
//   "The Lightless Beacon - Call of Cthulhu.pdf" -> "The Lightless Beacon"
export function bookTitleFromFileName(fileName: string): string {
  let name = fileName
    .replace(/\.pdf$/i, "")
    .replace(/_/g, " ")
    .replace(/^\s*CHA\d{4,6}\s*/i, "")
    .replace(/^[\s-]+/, "")
    .replace(/[\s-]+v?\d+(?:\.\d+)*\s*$/i, "")
    .replace(/\s+-\s+Call of Cthulhu\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (name === name.toLowerCase() || name === name.toUpperCase()) {
    name = name
      .toLowerCase()
      .split(" ")
      .map((word, i) =>
        i > 0 && TITLE_CONNECTORS.has(word)
          ? word
          : word.replace(/(^|-)([a-z])/g, (_, sep, c) => sep + c.toUpperCase()),
      )
      .join(" ");
  }
  return name || fileName;
}

// "The Two-Headed Serpent, p. 183": the printed page when known, else the PDF
// page, else the title alone.
export function sourceCitation(
  title: string,
  entry: { page?: number; printedPage?: number },
): string {
  if (entry.printedPage) return `${title}, p. ${entry.printedPage}`;
  if (entry.page) return `${title}, PDF page ${entry.page}`;
  return title;
}

// The Keeper-notes paragraph carrying a citation.
export function citationHtml(citation: string): string {
  const escaped = citation
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<p>Source: ${escaped}</p>`;
}
