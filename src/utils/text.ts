/**
 * Clio's note `detail` and task `description` fields carry HTML when the record
 * was written with `detail_text_type: "rich_text"` (Clio API changelog,
 * 2025-03-14). Handing raw markup to a model wastes tokens and reads badly, so
 * tools return plain text and keep the original alongside it.
 *
 * The tag set Clio documents for rich text is small and structural (b, i,
 * strong, em, u, s, ul, ol, li, a), so a targeted unwrap is enough here. This
 * is presentation cleanup for text we fetched, never a sanitiser for untrusted
 * HTML that will be rendered.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = parseInt(body.slice(2), 16);
      return Number.isNaN(code) ? whole : String.fromCodePoint(code);
    }
    if (body.startsWith("#")) {
      const code = parseInt(body.slice(1), 10);
      return Number.isNaN(code) ? whole : String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

/**
 * Converts Clio rich-text HTML to readable plain text. Returns non-string input
 * unchanged so callers can pass a possibly-absent field straight through.
 */
export function stripHtml(input: unknown): unknown {
  if (typeof input !== "string") return input;
  if (!/[<&]/.test(input)) return input;

  const text = input
    // List items become dashes before the tags go, so structure survives.
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    // Paragraph-level blocks separate with a blank line; list wrappers with a
    // single one. `</li>` is deliberately absent, because the opening tag
    // already started the line and closing it too would space out every bullet.
    .replace(/<\/(p|div|h[1-6])\s*>/gi, "\n\n")
    .replace(/<\/(ul|ol)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  return decodeEntities(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
