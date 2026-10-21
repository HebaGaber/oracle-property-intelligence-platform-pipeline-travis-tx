// A-04 T010: the CLI's only channel to the pipeline: the Restate ingress
// (RESTATE_INGRESS_URL, default http://localhost:8080). The CLI never opens the Query DB.
export const DEFAULT_INGRESS_URL = "http://localhost:8080";

export interface RestateIngressClient {
  /** Request/response call: POST /<service>[/<key>]/<handler>. */
  call<T = unknown>(service: string, handler: string, body: unknown, key?: string): Promise<T>;
  /** One-way start: POST /<service>/<key>/<handler>/send. */
  send(
    service: string,
    key: string,
    handler: string,
    body: unknown,
  ): Promise<{ invocationId: string }>;
  /**
   * A workflow's result: GET /restate/workflow/<service>/<key>/output. HTTP 470 ("the invocation
   * exists but has not completed yet") is not a failure: it polls (2 s, backing off to 10 s, no
   * overall cap) until the output is ready. A workflow's own failure rejects with its message.
   */
  get<T = unknown>(service: string, key: string, options?: GetOptions): Promise<T>;
}

export interface GetOptions {
  /** Stop waiting when aborted (rejects). */
  signal?: AbortSignal;
  /** Optional overall wait cap in ms; none by default. */
  timeoutMs?: number;
}

/** HTTP status Restate answers while a workflow invocation has not completed yet. */
export const NOT_COMPLETED_STATUS = 470;
export const POLL_START_MS = 2_000;
export const POLL_MAX_MS = 10_000;

export type IngressFetch = (url: string, init: RequestInit) => Promise<Response>;

export class IngressError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "IngressError";
  }
}

/** A workflow's own failure body `{"code":500,"message":"…"}` becomes the error message. */
function workflowFailure(error: IngressError): IngressError {
  const body = error.message.slice(error.message.indexOf("HTTP ") + 4).replace(/^\d+ /, "");
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message !== "") {
      return new IngressError(
        error.status,
        `workflow failed (HTTP ${error.status}): ${parsed.message}`,
      );
    }
  } catch {
    // not JSON: keep the ingress message
  }
  return error;
}

export function createRestateIngressClient(
  options: {
    env?: Readonly<Record<string, string | undefined>>;
    fetch?: IngressFetch;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): RestateIngressClient {
  const env = options.env ?? process.env;
  const base = (env.RESTATE_INGRESS_URL ?? DEFAULT_INGRESS_URL).replace(/\/+$/, "");
  const doFetch: IngressFetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const seg = (s: string): string => encodeURIComponent(s);

  async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const response = await doFetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", accept: "application/json" },
      ...(method === "POST" ? { body: JSON.stringify(body ?? null) } : {}),
    });
    const text = await response.text();
    if (!response.ok) {
      // The ingress error body is a short Restate message; it never carries credentials.
      throw new IngressError(
        response.status,
        `ingress ${method} ${path}: HTTP ${response.status} ${text.slice(0, 300)}`,
      );
    }
    return (text.trim() === "" ? null : JSON.parse(text)) as T;
  }

  return {
    call: (service, handler, body, key) =>
      request(
        "POST",
        `/${seg(service)}${key === undefined ? "" : `/${seg(key)}`}/${seg(handler)}`,
        body,
      ),
    send: (service, key, handler, body) =>
      request("POST", `/${seg(service)}/${seg(key)}/${seg(handler)}/send`, body),
    get: async <T>(service: string, key: string, opts: GetOptions = {}): Promise<T> => {
      const path = `/restate/workflow/${seg(service)}/${seg(key)}/output`;
      let waited = 0;
      let interval = POLL_START_MS;
      for (;;) {
        if (opts.signal?.aborted === true) throw new Error(`waiting for ${service}/${key} aborted`);
        try {
          return await request<T>("GET", path);
        } catch (error) {
          if (!(error instanceof IngressError)) throw error;
          if (error.status !== NOT_COMPLETED_STATUS) throw workflowFailure(error);
        }
        if (opts.timeoutMs !== undefined && waited + interval > opts.timeoutMs) {
          throw new Error(`waiting for ${service}/${key} timed out after ${waited} ms`);
        }
        await sleep(interval);
        waited += interval;
        interval = Math.min(POLL_MAX_MS, interval * 2);
      }
    },
  };
}
