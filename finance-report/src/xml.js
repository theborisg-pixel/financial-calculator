// Tiny XML helpers for attribute-style (IBKR Flex) and element-style (Mimshak) documents. Not a general parser.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const decode = (s) => String(s).replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] ?? m));

export function parseAttrs(s) {
  const out = {};
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]] = decode(m[3] ?? m[4]);
  return out;
}
/** All elements named `tag` (self-closing or not), returning their attributes. */
export function elements(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}\\b([^>]*?)/?>`, 'g'))].map((m) => parseAttrs(m[1]));
}
/** Text of the first <tag>text</tag>. */
export function text(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? decode(m[1].trim()) : null;
}
/** Inner XML blocks of every <tag>...</tag>. */
export function blocks(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);
}
