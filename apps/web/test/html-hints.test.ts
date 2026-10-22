// @vitest-environment node
// ERR-44 (TC-081): data pages waterfall HTML -> JS -> /runs/index.json -> manifest from the CID
// copy host. index.html starts the index request with the HTML and warms the cross-origin
// connection to the CID copy host. Source-level checks (jsdom has no preload scanner), plus the
// built dist/index.html when a build exists.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RUNS_INDEX_PATH, loadRunsIndex } from "../src/data/runs-index";

const WEB = join(__dirname, "..");
const html = readFileSync(join(WEB, "index.html"), "utf8");
const tags = (source: string): string[] => source.match(/<link\b[^>]*>/g) ?? [];
const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\s${name}(?:="([^"]*)")?(?=[\\s>/])`).exec(tag)?.[1] ??
  (new RegExp(`\\s${name}(?=[\\s>/])`).test(tag) ? "" : undefined);

describe("index.html resource hints", () => {
  it("preloads /runs/index.json as a same-origin credentialed-default fetch", () => {
    const tag = tags(html).find((t) => attr(t, "rel") === "preload");
    expect(tag, "no rel=preload link").toBeDefined();
    expect(attr(tag ?? "", "as")).toBe("fetch");
    expect(attr(tag ?? "", "href")).toBe("/runs/index.json");
    expect(attr(tag ?? "", "crossorigin")).toBe("anonymous");
  });

  it("preconnects to the CID copy host placeholder, crossorigin, and not to gateways", () => {
    const hosts = tags(html).filter((t) => attr(t, "rel") === "preconnect");
    const cid = hosts.find((t) => attr(t, "href") === "https://%VITE_CID_COPY_HOST%");
    expect(cid, "no CID copy preconnect").toBeDefined();
    expect(attr(cid ?? "", "crossorigin")).toBeDefined();
    expect(html).not.toMatch(/pinata|filebase/i);
  });

  it("vite.config removes the preconnect when the host is unset (no literal placeholder)", () => {
    const config = readFileSync(join(WEB, "vite.config.ts"), "utf8");
    expect(config).toContain("VITE_CID_COPY_HOST");
    expect(config).toContain("transformIndexHtml");
  });
});

describe("loadRunsIndex requests exactly the preloaded URL", () => {
  it("fetches RUNS_INDEX_PATH with no cache, credentials, mode or headers override", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("{}", { status: 404 })));
    await loadRunsIndex({ fetch: fetchMock as unknown as typeof fetch }).catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RUNS_INDEX_PATH);
    expect(RUNS_INDEX_PATH).toBe("/runs/index.json");
    expect(Object.keys(init ?? {})).toEqual([]);
  });
});

const distHtml = join(WEB, "dist", "index.html");
describe.skipIf(!existsSync(distHtml))("built dist/index.html", () => {
  const built = existsSync(distHtml) ? readFileSync(distHtml, "utf8") : "";
  it("keeps the index preload and never ships an unresolved placeholder", () => {
    expect(
      tags(built).some(
        (t) =>
          attr(t, "rel") === "preload" &&
          attr(t, "href") === "/runs/index.json" &&
          attr(t, "as") === "fetch",
      ),
    ).toBe(true);
    expect(built).not.toContain("%VITE_");
  });
  const host = process.env["VITE_CID_COPY_HOST"];
  it.skipIf(host === undefined || host === "")(
    "preconnects to the configured CID copy host",
    () => {
      expect(
        tags(built).some(
          (t) => attr(t, "rel") === "preconnect" && attr(t, "href") === `https://${host}`,
        ),
      ).toBe(true);
    },
  );
});
