// Run events (A-13 T014, research R5, data-model.md RunEvent): the Runs · Log list, built only
// from manifest timestamps: each run's `startedAt`, every `sources[].captured_at` (with its source
// name), and `finishedAt` with the run's limitations. A manifest cannot carry its own publish or
// verify time (its CID is fixed before upload), so no such event is invented. Events are sorted
// ascending by time across every run; on equal times the run's own order (started, captured,
// finished) is kept.
import type { RunManifestV1 } from "@countylens/contract";

export type RunEvent =
  | { readonly time: string; readonly runId: string; readonly kind: "started" }
  | {
      readonly time: string;
      readonly runId: string;
      readonly kind: "captured";
      readonly source: string;
    }
  | {
      readonly time: string;
      readonly runId: string;
      readonly kind: "finished";
      readonly limitations: readonly string[];
    };

const RANK: Record<RunEvent["kind"], number> = { started: 0, captured: 1, finished: 2 };

export function runEvents(manifests: readonly RunManifestV1[]): RunEvent[] {
  const events: RunEvent[] = manifests.flatMap((m): RunEvent[] => [
    { time: m.startedAt, runId: m.runId, kind: "started" },
    ...m.sources.map((s): RunEvent => ({
      time: s.captured_at,
      runId: m.runId,
      kind: "captured",
      source: s.name,
    })),
    { time: m.finishedAt, runId: m.runId, kind: "finished", limitations: m.limitations },
  ]);
  return events
    .map((event, index) => ({ event, index }))
    .sort(
      (a, b) =>
        Date.parse(a.event.time) - Date.parse(b.event.time) ||
        RANK[a.event.kind] - RANK[b.event.kind] ||
        a.index - b.index,
    )
    .map(({ event }) => event);
}
