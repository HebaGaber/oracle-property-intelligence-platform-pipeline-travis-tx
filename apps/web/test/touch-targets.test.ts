// A-13 hosted smeargle defects D1-D5 (docs/evidence/A-13-smeargle.md): every interactive target
// is at least 48 x 48 px (Atlas § 14.1: min-width / min-height / width / height var(--space-9))
// and every form control takes its font from the tokens (ERR-12). Source-level checks on the CSS
// Modules, in the style of app-shell.test.tsx: jsdom computes no layout.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = (file: string): string => readFileSync(join(__dirname, "../src", file), "utf8");

/** The declarations of every plain rule that names `.name` (comments stripped; `:hover` skipped). */
function ruleBody(css: string, name: string): string {
  const bodies: string[] = [];
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of plain.matchAll(/(?:^|\n)([^{}@]+)\{([^}]*)\}/g)) {
    const selectors = (m[1] ?? "").split(",").map((s) => s.trim());
    if (selectors.includes(`.${name}`)) bodies.push(m[2] ?? "");
  }
  return bodies.join("\n");
}

const TARGET = "var\\(--space-9\\)";
const has = (body: string, prop: string): boolean =>
  new RegExp(`(^|[;\\s])${prop}:\\s*${TARGET}\\s*;`).test(body);

describe("D1: the header wordmark is a 48 px target", () => {
  const body = ruleBody(src("components/AppShell.module.css"), "titleLink");
  it("has min-height var(--space-9) and is a flex box so the text stays centred", () => {
    expect(has(body, "min-height"), body).toBe(true);
    expect(body).toMatch(/display:\s*inline-flex/);
    expect(body).toMatch(/align-items:\s*center/);
  });
});

describe("D2: Hub footer links are at least 48 wide", () => {
  const body = ruleBody(src("routes/Hub.module.css"), "link");
  it("has min-width and min-height var(--space-9)", () => {
    expect(has(body, "min-width"), body).toBe(true);
    expect(has(body, "min-height"), body).toBe(true);
  });
});

describe("D3: Data · Manifest controls are at least 48 x 48", () => {
  it("the Verify action links have both minimums", () => {
    const body = ruleBody(src("routes/DataManifest.module.css"), "actionLink");
    expect(has(body, "min-width"), body).toBe(true);
    expect(has(body, "min-height"), body).toBe(true);
  });
  it("the Copy CID button cannot shrink below 48 inside the flex CID display", () => {
    const body = ruleBody(src("components/CidDisplay.module.css"), "copy");
    expect(has(body, "min-width"), body).toBe(true);
    expect(has(body, "min-height"), body).toBe(true);
    expect(body).toMatch(/flex:\s*none/);
  });
});

describe("D4: Explore checkboxes are 48 px targets with the token font", () => {
  const body = ruleBody(src("components/FilterSheet.module.css"), "box");
  it("the checkbox input is 48 x 48", () => {
    expect(has(body, "width"), body).toBe(true);
    expect(has(body, "height"), body).toBe(true);
  });
  it("takes its font from the tokens (a UA checkbox computes Arial)", () => {
    expect(body).toMatch(/(^|[;\s])font:\s*inherit\s*;/);
  });
  it("every input, select and textarea class sets a token font", () => {
    const uses: [string, string, string][] = [
      ["components/FilterSheet.module.css", "input", "FilterSheet.tsx"],
      ["components/CountySelect.module.css", "select", "CountySelect.tsx"],
      ["routes/Explore.module.css", "editor", "ExploreSql.tsx"],
    ];
    for (const [css, cls] of uses) {
      const b = ruleBody(src(css), cls);
      const ok = /font:\s*inherit\s*;/.test(b) || /font-family:\s*var\(--/.test(b);
      expect(ok, `${css} .${cls}`).toBe(true);
    }
  });
});

describe("D5: Property drawer source links and name", () => {
  it("the provenance link is a 48 px high flex box", () => {
    const body = ruleBody(src("components/Provenance.module.css"), "link");
    expect(has(body, "min-height"), body).toBe(true);
    expect(body).toMatch(/display:\s*inline-flex/);
  });
  it("the drawer dialog is named by its heading at every width", () => {
    const tsx = src("routes/PropertyDrawer.tsx");
    expect(tsx).toMatch(/aria-labelledby=\{titleId\}/);
    expect(tsx).toMatch(/<h3 id=\{titleId\}/);
  });
});

describe("N1: Runs and Compare in-page links are 48 px high (smeargle run 2, build a285dbe)", () => {
  const body = ruleBody(src("routes/Runs.module.css"), "link");
  it("is a flex box with min-height var(--space-9) so the text stays centred", () => {
    expect(has(body, "min-height"), body).toBe(true);
    expect(body).toMatch(/display:\s*inline-flex/);
    expect(body).toMatch(/align-items:\s*center/);
  });
});

describe("N2: icon glyphs have a fixed 1em box (TC-072 under load, build d3ae47e: 'more_horiz' 111 px wide)", () => {
  // Until the symbols font arrives, the glyph name shows as fallback text; without a clipped box it
  // widens the bottom nav to 406 px at 390 (horizontal scroll and layout shift on slow networks).
  const boxed = (body: string): void => {
    expect(body, body).toMatch(/(^|[;\s])width:\s*1em\s*;/);
    expect(body, body).toMatch(/(^|[;\s])height:\s*1em\s*;/);
    expect(body, body).toMatch(/overflow:\s*hidden/);
    expect(body, body).toMatch(/white-space:\s*nowrap/);
  };
  it("Icon `.icon` is a clipped 1em box", () => {
    boxed(ruleBody(src("components/Icon.module.css"), "icon"));
  });
  it("the app shell's `.glyph` is a clipped 1em box and Glyph uses it", () => {
    boxed(ruleBody(src("components/AppShell.module.css"), "glyph"));
    expect(src("components/AppShell.tsx")).toMatch(/material-symbols-rounded \$\{styles\.glyph\}/);
  });
});
