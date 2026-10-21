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
  /** A workflow's result: GET /restate/workflow/<service>/<key>/output. */
  get<T = unknown>(service: string, key: string): Promise<T>;
}

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

export function createRestateIngressClient(
  options: { env?: Readonly<Record<string, string | undefined>>; fetch?: IngressFetch } = {},
): RestateIngressClient {
  const env = options.env ?? process.env;
  const base = (env.RESTATE_INGRESS_URL ?? DEFAULT_INGRESS_URL).replace(/\/+$/, "");
  const doFetch: IngressFetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
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
    get: (service, key) => request("GET", `/restate/workflow/${seg(service)}/${seg(key)}/output`),
  };
}
