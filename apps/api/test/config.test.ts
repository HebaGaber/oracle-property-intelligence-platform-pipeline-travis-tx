// A-03 T006 (G-A2): the Lambda's Zod-validated environment (plan § "Fixed texts and config
// keys"; constitution III "region from config", V "Zod on every input"). Written before
// src/config.ts exists: the red run fails with "Cannot find module '../src/config'".
// The four required keys are the names the CDK Api stack sets (T074) and the test harness
// reads (T023); a missing one must fail at load time, naming the key.
import { describe, expect, it } from "vitest";
import { REQUIRED_ENV_KEYS, loadConfig } from "../src/config.js";

type Env = Record<string, string | undefined>;

/** In-test values only (plan Notes: unit tests build their own data); nothing here is real. */
const VALID: Env = {
  CID_COPY_BUCKET: "copy-bucket",
  CID_COPY_HOST: "copy.example",
  FILEBASE_GATEWAY_HOST: "gateway.example",
  READPATH_PRIVATE_PREFIX: "private/bench/",
};

const without = (key: string): Env =>
  Object.fromEntries(Object.entries(VALID).filter(([name]) => name !== key));

describe("apps/api config (Zod env)", () => {
  it("requires exactly CID_COPY_BUCKET, CID_COPY_HOST, FILEBASE_GATEWAY_HOST, READPATH_PRIVATE_PREFIX", () => {
    expect([...REQUIRED_ENV_KEYS].sort()).toEqual([
      "CID_COPY_BUCKET",
      "CID_COPY_HOST",
      "FILEBASE_GATEWAY_HOST",
      "READPATH_PRIVATE_PREFIX",
    ]);
  });

  it("loads the four keys from the given env", () => {
    expect(loadConfig(VALID)).toEqual({
      cidCopyBucket: "copy-bucket",
      cidCopyHost: "copy.example",
      filebaseGatewayHost: "gateway.example",
      readPathPrivatePrefix: "private/bench/",
    });
  });

  it.each([...REQUIRED_ENV_KEYS])("throws naming %s when it is missing", (key) => {
    expect(() => loadConfig(without(key))).toThrow(key);
  });

  it("treats an empty value as missing and names the key", () => {
    expect(() => loadConfig({ ...VALID, CID_COPY_BUCKET: "" })).toThrow("CID_COPY_BUCKET");
  });

  it("names every missing key when several are absent", () => {
    expect(() => loadConfig({})).toThrow(
      /CID_COPY_BUCKET.*CID_COPY_HOST.*FILEBASE_GATEWAY_HOST.*READPATH_PRIVATE_PREFIX/s,
    );
  });

  it("rejects a host with a scheme or path (bare hostnames only), naming the key", () => {
    expect(() => loadConfig({ ...VALID, CID_COPY_HOST: "https://copy.example" })).toThrow(
      "CID_COPY_HOST",
    );
    expect(() => loadConfig({ ...VALID, FILEBASE_GATEWAY_HOST: "gateway.example/ipfs" })).toThrow(
      "FILEBASE_GATEWAY_HOST",
    );
  });

  it("rejects a private prefix outside private/<name>/, naming the key", () => {
    expect(() => loadConfig({ ...VALID, READPATH_PRIVATE_PREFIX: "ipfs/" })).toThrow(
      "READPATH_PRIVATE_PREFIX",
    );
    expect(() => loadConfig({ ...VALID, READPATH_PRIVATE_PREFIX: "private/bench" })).toThrow(
      "READPATH_PRIVATE_PREFIX",
    );
  });

  it("ignores unrelated keys and carries no region (the SDK reads AWS_REGION itself)", () => {
    const config = loadConfig({ ...VALID, UNRELATED: "x" });
    expect(Object.keys(config).sort()).toEqual([
      "cidCopyBucket",
      "cidCopyHost",
      "filebaseGatewayHost",
      "readPathPrivatePrefix",
    ]);
  });
});
