// Parquet footers for Data · Catalog (A-13 T014, research R4): each table part's footer is read
// by HTTP Range from the CID copy with hyparquet 1.31.2 (pure JS, pinned). This module is imported
// only by the Catalog page (a lazy route), so hyparquet stays out of every other page's bundle.
// It gives the columns, their types and the row count of the published file ("rows in the
// published file"); it cannot check a CID (each CID links to Verify for that). `catalogTables`
// groups the manifest's table parts by table, from the manifest only.
import type { RunManifestV1 } from "@countylens/contract";
import {
  parquetMetadataAsync,
  parquetSchema,
  type AsyncBuffer,
  type SchemaElement,
} from "hyparquet";
import { browserFetch } from "./http";

export interface ParquetColumn {
  readonly name: string;
  readonly type: string;
}

export interface ParquetFooter {
  readonly columns: readonly ParquetColumn[];
  readonly rows: number;
}

export interface ReadFooterOptions {
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
}

/** The type label of a schema element: logical type, else converted type, else physical. */
function typeOf(element: SchemaElement, hasChildren: boolean): string {
  const logical = element.logical_type?.type;
  if (logical !== undefined) return logical;
  if (element.converted_type !== undefined) return element.converted_type;
  if (element.type !== undefined) return element.type;
  return hasChildren ? "GROUP" : "UNKNOWN";
}

/** An AsyncBuffer over `url` that reads each slice with one `Range: bytes=a-b` GET. */
function rangeBuffer(url: string, size: number, options: ReadFooterOptions): AsyncBuffer {
  const fetchImpl = options.fetch ?? browserFetch;
  return {
    byteLength: size,
    async slice(start: number, end: number = size): Promise<ArrayBuffer> {
      const init: RequestInit = { headers: { Range: `bytes=${start}-${end - 1}` } };
      if (options.signal !== undefined) init.signal = options.signal;
      const response = await fetchImpl(url, init);
      if (response.status === 206) return response.arrayBuffer();
      if (response.status === 200) return (await response.arrayBuffer()).slice(start, end);
      throw new Error(`${new URL(url).host} answered ${response.status}`);
    },
  };
}

/** Columns, types and row count of one published Parquet part of `size` bytes. */
export async function readParquetFooter(
  url: string,
  size: number,
  options: ReadFooterOptions = {},
): Promise<ParquetFooter> {
  const metadata = await parquetMetadataAsync(rangeBuffer(url, size, options));
  const tree = parquetSchema(metadata);
  return {
    columns: tree.children.map((child) => ({
      name: child.element.name,
      type: typeOf(child.element, child.children.length > 0),
    })),
    rows: Number(metadata.num_rows),
  };
}

export interface CatalogPart {
  readonly name: string;
  readonly cid: string;
  readonly size: number;
}

export interface CatalogTable {
  /** `{group}.{table}`, e.g. "county.property". */
  readonly table: string;
  readonly parts: readonly CatalogPart[];
  /** Sum of the parts' manifest sizes. */
  readonly size: number;
}

/** "tables/<group>/<table>/<part>" → "<group>.<table>". */
function tableName(name: string): string | undefined {
  const [root, group, table, part, ...rest] = name.split("/");
  return root === "tables" && group && table && part && rest.length === 0
    ? `${group}.${table}`
    : undefined;
}

/** The manifest's table parts grouped by table, in manifest order. */
export function catalogTables(manifest: RunManifestV1): CatalogTable[] {
  const tables = new Map<string, CatalogPart[]>();
  for (const a of manifest.artifacts) {
    if (a.kind !== "table") continue;
    const table = tableName(a.name);
    if (table === undefined) continue;
    tables.set(table, [...(tables.get(table) ?? []), { name: a.name, cid: a.cid, size: a.size }]);
  }
  return [...tables].map(([table, parts]) => ({
    table,
    parts,
    size: parts.reduce((n, p) => n + p.size, 0),
  }));
}
