// Explore · AI state helpers (A-14 T033; FR-012). Pure functions: the session question counter
// (sessionStorage; only an `answered` outcome counts, per docs/02-design.md), the answer split
// into text and `[n]` citations, and the "How I read this" chips built from the server's echo of
// the filters it applied (`query`), never from model text.
import { EXPLORE_BOUNDS } from "@countylens/query-core";
import { AI_TEXTS } from "@countylens/shared";
import type { AgentAskResponse } from "../data/agent-ask";

export const SESSION_KEY = "countylens.ai.questions";

/** Reads the session count; storage that is blocked or unreadable counts as zero. */
export function readSessionCount(storage: Pick<Storage, "getItem"> | undefined): number {
  try {
    const n = Number(storage?.getItem(SESSION_KEY) ?? 0);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function writeSessionCount(storage: Pick<Storage, "setItem"> | undefined, n: number): void {
  try {
    storage?.setItem(SESSION_KEY, String(n));
  } catch {
    // Private mode or blocked storage: the count then lives in component state only.
  }
}

export function sessionStorageOrUndefined(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export const limitReached = (used: number): boolean => used >= AI_TEXTS.sessionLimit;

export type AnswerPart =
  { readonly kind: "text"; readonly text: string } | { readonly kind: "cite"; readonly n: number };

/** Splits an answer at `[n]`; a number with no matching row is dropped (the server strips them
 *  too, so a broken reference is never shown). */
export function splitAnswer(answer: string, matchCount: number): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let last = 0;
  for (const m of answer.matchAll(/\[(\d+)\]/g)) {
    const index = m.index ?? 0;
    const n = Number(m[1]);
    if (index > last) parts.push({ kind: "text", text: answer.slice(last, index) });
    if (n >= 1 && n <= matchCount) parts.push({ kind: "cite", n });
    last = index + m[0].length;
  }
  if (last < answer.length) parts.push({ kind: "text", text: answer.slice(last) });
  return parts;
}

export interface EditableChip {
  readonly key: string;
  readonly label: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** The numeric filters a person can change; bounds are query-core's, never retyped. */
export const EDITABLE_CHIPS: readonly EditableChip[] = Object.freeze([
  {
    key: "radius_mi",
    label: "Radius",
    unit: "mi",
    step: 0.25,
    min: EXPLORE_BOUNDS.radiusMi[0],
    max: EXPLORE_BOUNDS.radiusMi[1],
  },
  {
    key: "roof_age_years_min",
    label: "Roof age at least",
    unit: "years",
    step: 1,
    min: EXPLORE_BOUNDS.roof[0],
    max: EXPLORE_BOUNDS.roof[1],
  },
  {
    key: "tenure_years_min",
    label: "Owner tenure at least",
    unit: "years",
    step: 1,
    min: 1,
    max: EXPLORE_BOUNDS.tenure[1],
  },
  {
    key: "open_years_min",
    label: "Permit open at least",
    unit: "years",
    step: 0.5,
    min: EXPLORE_BOUNDS.openYrs[0],
    max: EXPLORE_BOUNDS.openYrs[1],
  },
]);

/** Keys of `query` that are plumbing, not an assumption to show. */
const HIDDEN_KEYS = new Set(["manifest_cid", "area", "limit", "offset"]);

export interface ReadOnlyChip {
  readonly key: string;
  readonly text: string;
}

export interface HowChips {
  readonly editable: readonly { readonly chip: EditableChip; readonly value: number }[];
  readonly fixed: readonly ReadOnlyChip[];
}

function scalar(value: unknown): string {
  return Array.isArray(value)
    ? value.map(String).join(", ").replaceAll("_", " ")
    : String(value).replaceAll("_", " ");
}

export function howChips(query: AgentAskResponse["query"]): HowChips {
  const editableKeys = new Set(EDITABLE_CHIPS.map((c) => c.key));
  const editable = EDITABLE_CHIPS.flatMap((chip) => {
    const value = query[chip.key];
    return typeof value === "number" ? [{ chip, value }] : [];
  });
  const fixed = Object.entries(query)
    .filter(([key, value]) => {
      if (HIDDEN_KEYS.has(key) || editableKeys.has(key)) return false;
      if (value === undefined || value === null) return false;
      return Array.isArray(value) || typeof value !== "object";
    })
    .map(([key, value]) => ({ key, text: `${key.replaceAll("_", " ")}: ${scalar(value)}` }));
  return { editable, fixed };
}
