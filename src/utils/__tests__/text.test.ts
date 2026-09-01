import { describe, it, expect } from "vitest";
import { stripHtml } from "../text.js";

describe("stripHtml", () => {
  it("returns plain text unchanged and without allocating", () => {
    expect(stripHtml("Discussed settlement terms.")).toBe("Discussed settlement terms.");
  });

  it("passes non-strings straight through", () => {
    expect(stripHtml(null)).toBeNull();
    expect(stripHtml(undefined)).toBeUndefined();
    expect(stripHtml(42)).toBe(42);
  });

  it("unwraps the inline tags Clio's rich text uses", () => {
    expect(stripHtml("<p>Spoke to <strong>client</strong> about the <em>dispute</em>.</p>")).toBe(
      "Spoke to client about the dispute."
    );
  });

  it("keeps list structure readable as dashes with no blank lines between items", () => {
    expect(stripHtml("<ul><li>First</li><li>Second</li><li>Third</li></ul>")).toBe("- First\n- Second\n- Third");
  });

  it("turns paragraph breaks into blank lines", () => {
    expect(stripHtml("<p>One</p><p>Two</p>")).toBe("One\n\nTwo");
  });

  it("honours explicit line breaks", () => {
    expect(stripHtml("Line one<br>Line two<br/>Line three")).toBe("Line one\nLine two\nLine three");
  });

  it("decodes named, decimal and hex entities", () => {
    expect(stripHtml("Smith &amp; Jones &lt;tag&gt; &quot;quoted&quot;")).toBe('Smith & Jones <tag> "quoted"');
    expect(stripHtml("caf&#233; &#x2014; done")).toBe("café — done");
  });

  it("leaves an unknown entity alone rather than mangling it", () => {
    expect(stripHtml("100&fake;")).toBe("100&fake;");
  });

  it("collapses runs of blank lines left behind by nested markup", () => {
    expect(stripHtml("<div><p>A</p></div><div><p>B</p></div>")).toBe("A\n\nB");
  });

  it("keeps link text and drops the anchor", () => {
    expect(stripHtml('See <a href="https://example.com">the order</a> for detail.')).toBe(
      "See the order for detail."
    );
  });
});
