// A-14 T015 (data-model.md "Spend counter (new persisted entity)"; agent-design.md § "ash" >
// "Spend-cap + alarm design"; constitution A7 / P0-19): one on-demand DynamoDB item per UTC
// day, read before each model call (pre-empt to `paused` when `spent_usd >= $3`), incremented
// after a successful call. No TTL attribute is ever written — the item is one tiny row per
// day, cost is in on-demand request units, not storage, and a counter that silently expired
// mid-day would let spend quietly reset to zero.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

/** The daily spend cap (USD) past which `agent.ask` returns `outcome: "paused"` (CLAUDE.md, A7). */
export const DAILY_SPEND_CAP_USD = 3;

export interface SpendStatus {
  /** `SPEND#<utc-date>`'s date part, e.g. "2026-10-23". */
  readonly date: string;
  readonly spentUsd: number;
  readonly modelCalls: number;
  /** `spentUsd >= DAILY_SPEND_CAP_USD`: the caller must not place another model call today. */
  readonly paused: boolean;
}

/** `SpendCounter.pk` for a given UTC date (data-model.md). */
export function spendKey(date: string): string {
  return `SPEND#${date}`;
}

/** Today's UTC date key (`YYYY-MM-DD`), never the Lambda's local time. */
export function utcDateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function statusFromItem(
  date: string,
  item: Record<string, unknown> | undefined,
): SpendStatus {
  const spentUsd = typeof item?.spent_usd === "number" ? item.spent_usd : 0;
  const modelCalls = typeof item?.model_calls === "number" ? item.model_calls : 0;
  return { date, spentUsd, modelCalls, paused: spentUsd >= DAILY_SPEND_CAP_USD };
}

/**
 * Reads today's spend without mutating it — the pre-call check (`agent.ask` calls this before
 * ever invoking the model; `paused` means no model call is placed this request).
 */
export async function readSpend(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  now: Date = new Date(),
): Promise<SpendStatus> {
  const date = utcDateKey(now);
  const { Item } = await ddb.send(
    new GetCommand({ TableName: tableName, Key: { pk: spendKey(date) } }),
  );
  return statusFromItem(date, Item);
}

/**
 * Adds `deltaUsd` to today's spend and increments `model_calls` by one, after a model call
 * completes. Uses an atomic `ADD` (not a read-modify-write) so concurrent requests on the same
 * UTC day never lose an increment. Never sets a TTL attribute.
 */
export async function recordSpend(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  deltaUsd: number,
  now: Date = new Date(),
): Promise<SpendStatus> {
  const date = utcDateKey(now);
  const { Attributes } = await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pk: spendKey(date) },
      UpdateExpression: "ADD spent_usd :delta, model_calls :one",
      ExpressionAttributeValues: { ":delta": deltaUsd, ":one": 1 },
      ReturnValues: "ALL_NEW",
    }),
  );
  return statusFromItem(date, Attributes);
}

/** Lazily-constructed singleton Document client (one per Lambda sandbox, like `s3-read.ts`). */
let documentClient: DynamoDBDocumentClient | undefined;

export function getSpendDocumentClient(): DynamoDBDocumentClient {
  documentClient ??= DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return documentClient;
}
