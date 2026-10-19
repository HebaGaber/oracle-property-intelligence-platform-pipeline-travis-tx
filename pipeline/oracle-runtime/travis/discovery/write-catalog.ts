// T013: block-style YAML emit and read for pipeline/docs/travis-sources.yaml (research R5).
//
// The kit validator reads the catalog with PyYAML when it is installed and with its own
// simplified indent parser otherwise. To make both read the same values:
// - block style only: no flow collections (so empty collections are refused), no anchors;
// - every string is a single-line double-quoted scalar (FIPS, IDs, dates, '#' and ':' are
//   therefore always quoted; no bare yes/no);
// - strings may not contain '"', '\' or control characters, because the fallback parser
//   strips the quotes without processing escapes;
// - inside a list, each map starts with a scalar key (the fallback parser cannot nest a
//   map on the "- key:" line).
// The catalog is validated with the Zod schema before anything is written.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { CatalogSchema, type Catalog } from "./catalog.schema.js";

export const DEFAULT_CATALOG_PATH = fileURLToPath(
  new URL("../../../docs/travis-sources.yaml", import.meta.url),
);

const KEY = /^[a-z][a-z0-9_]*$/;
// eslint-disable-next-line no-control-regex -- control characters are exactly what we refuse
const UNSAFE_STRING = /["\\\u0000-\u001f\u007f]/;

type Plain = string | number | boolean | null | Plain[] | { [key: string]: Plain };

function isComplex(value: Plain): boolean {
  return value !== null && typeof value === "object";
}

/** Checks every value is emittable and returns a copy with list-item maps scalar-first. */
function normalize(value: unknown, path: string, inList: boolean): Plain {
  if (value === null) return null;
  if (typeof value === "string") {
    if (UNSAFE_STRING.test(value)) {
      throw new Error(`write-catalog: ${path} contains a quote, backslash or control character`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`write-catalog: ${path} is not a finite number`);
    return value;
  }
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new Error(`write-catalog: ${path} is an empty list (flow style only); omit it`);
    }
    return value.map((item, i) => normalize(item, `${path}[${i}]`, true));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) {
      throw new Error(`write-catalog: ${path} is an empty map (flow style only); omit it`);
    }
    const out: Array<[string, Plain]> = entries.map(([k, v]) => {
      if (!KEY.test(k)) throw new Error(`write-catalog: key "${k}" at ${path} is not snake_case`);
      return [k, normalize(v, `${path}.${k}`, false)];
    });
    if (inList) {
      const scalars = out.filter(([, v]) => !isComplex(v));
      if (scalars.length === 0) {
        throw new Error(`write-catalog: list item ${path} needs at least one scalar field`);
      }
      return Object.fromEntries([...scalars, ...out.filter(([, v]) => isComplex(v))]);
    }
    return Object.fromEntries(out);
  }
  throw new Error(`write-catalog: ${path} has unsupported type ${typeof value}`);
}

export function emitCatalogYaml(catalog: Catalog): string {
  const plain = normalize(catalog, "catalog", false);
  const text = stringify(plain, {
    defaultStringType: "QUOTE_DOUBLE",
    defaultKeyType: "PLAIN",
    lineWidth: 0,
    minContentWidth: 0,
    indent: 2,
    indentSeq: true,
    aliasDuplicateObjects: false,
    nullStr: "null",
    trueStr: "true",
    falseStr: "false",
  });
  if (text.includes("\\")) {
    throw new Error("write-catalog: emitter produced an escape sequence; refuse to write");
  }
  return text;
}

export function parseCatalogYaml(text: string): Catalog {
  return CatalogSchema.parse(parse(text, { schema: "core", uniqueKeys: true }));
}

export function readCatalog(path: string = DEFAULT_CATALOG_PATH): Catalog {
  return parseCatalogYaml(readFileSync(path, "utf8"));
}

/** Validates, emits and atomically writes the catalog. Nothing is written on failure. */
export function writeCatalog(catalog: Catalog, path: string = DEFAULT_CATALOG_PATH): void {
  const valid = CatalogSchema.parse(catalog);
  const text = emitCatalogYaml(valid);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
}
