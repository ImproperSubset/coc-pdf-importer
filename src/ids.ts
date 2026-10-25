// Stable document ids. Foundry ids are 16 letters and digits; these are
// derived from a key, so the same key gives the same id on every import.

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// FNV-1a over the key's UTF-16 code units, from the given offset basis.
function fnv1a(key: string, basis: number): number {
  let h = basis >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function stableId(key: string): string {
  let n =
    (BigInt(fnv1a(key, 0x811c9dc5)) << 64n) |
    (BigInt(fnv1a(key, 0x050c5d1f)) << 32n) |
    BigInt(fnv1a(key, 0x6b8b4567));
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += ALPHABET[Number(n % 62n)];
    n /= 62n;
  }
  return out;
}

// Ids for one parent's embedded documents: the parent's id, the document's
// type and name, and how many same-typed, same-named ones came before.
export function embeddedIds(parentId: string): (doc: any) => string {
  const seen = new Map<string, number>();
  return (doc) => {
    const key = `${doc.type}|${doc.name}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return stableId(`${parentId}|${key}|${n}`);
  };
}
