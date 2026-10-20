// Zod row schemas generated from columns.ts (mew C.7): one per view, strict, in column order.
import { z } from "zod";
import { CidV1, IsoDateTime } from "./cid.js";
import { VIEWS, type Column, type ViewName } from "./columns.js";
import { Missing } from "./provenance.js";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

function base(column: Column): z.ZodType {
  switch (column.kind) {
    case "cid":
      return CidV1;
    case "string":
      return z.string();
    case "enum":
      return z.enum(column.enum as [string, ...string[]]);
    case "integer":
      return z.number().int();
    case "double":
      return z.number();
    case "boolean":
      return z.boolean();
    case "date":
      return DATE;
    case "timestamptz":
      return IsoDateTime;
    case "missing":
      return z.array(Missing);
    case "json":
      return z.unknown();
    case "list":
      return z.array(z.record(z.string(), z.unknown()));
  }
}

const cache = new Map<ViewName, z.ZodObject>();

export function rowSchema(view: ViewName): z.ZodObject {
  const known = cache.get(view);
  if (known) return known;
  const shape: Record<string, z.ZodType> = {};
  for (const column of VIEWS[view]) {
    const s = base(column);
    shape[column.name] = column.nullable ? s.nullable() : s;
  }
  const schema = z.object(shape).strict();
  cache.set(view, schema);
  return schema;
}

export const PropertyRow = rowSchema("v_property");
export const RoofingPermitRow = rowSchema("v_roofing_permit");
export const ContractorRow = rowSchema("v_contractor");
export const RunRow = rowSchema("v_run");
