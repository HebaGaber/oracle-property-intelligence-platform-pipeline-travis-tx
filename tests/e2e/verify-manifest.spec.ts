// A-03-TC-040…043: `scripts/verify-manifest.ts` on the published run (FR-006, AM-01).
// The cases spawn the script from the repo root and assert its exact texts: the `manifest`
// byte-compare line per gateway, one line per artifact per gateway, the fixed refusal for
// a non-allowlisted host, and `ALL ARTIFACTS VERIFIED` only when everything matches.
import { existsSync, writeFileSync } from "node:fs";
import { RunManifestV1, type ManifestArtifact } from "@countylens/contract";
import { jcsBytes } from "@countylens/publish";
import { expect, test } from "./lib/fixtures.js";
import { artifactsOf, publicCid } from "./lib/manifest.js";
import {
  committedManifestPath,
  harnessConfig,
  repoRoot,
  type PublishedRun,
} from "./lib/runtime.js";
import { lines, run, type RunResult } from "./lib/spawn.js";

const SCRIPT = "scripts/verify-manifest.ts";
const SUCCESS = "ALL ARTIFACTS VERIFIED";
const RETIRED_HOSTS = ["ipfs.io", "dweb.link", "w3s.link"];

function refusalText(host: string): string {
  const { PINATA_GATEWAY_HOST, FILEBASE_GATEWAY_HOST } = harnessConfig();
  return `Refused gateway ${host}: verify-manifest only uses ${PINATA_GATEWAY_HOST}, ${FILEBASE_GATEWAY_HOST}`;
}

function gateways(): string[] {
  const { PINATA_GATEWAY_HOST, FILEBASE_GATEWAY_HOST } = harnessConfig();
  return [PINATA_GATEWAY_HOST, FILEBASE_GATEWAY_HOST];
}

/** Hosts the script must never talk to: our CID copy and the retired or non-independent gateways. */
function forbiddenHosts(): string[] {
  const copy = harnessConfig().CID_COPY_HOST;
  return copy ? [copy, ...RETIRED_HOSTS] : RETIRED_HOSTS;
}

async function verify(args: string[], label: string): Promise<RunResult> {
  const result = await run("pnpm", ["exec", "tsx", SCRIPT, ...args], {
    cwd: repoRoot,
    timeoutMs: 20 * 60_000,
  });
  await test.info().attach(`${label}.log`, {
    body: `$ ${result.command}\nexit ${result.code} after ${result.durationMs} ms\n\n${result.output}`,
    contentType: "text/plain",
  });
  return result;
}

/** The `FAIL <gateway> <name> …` lines verify-manifest prints for one artifact. */
function failLines(result: RunResult, name: string): string[] {
  return lines(result.output).filter(
    (line) => line.startsWith("FAIL") && line.includes(` ${name} `),
  );
}

function lastLine(result: RunResult): string | undefined {
  return lines(result.stdout).at(-1);
}

/**
 * A copy of the manifest with one artifact changed, written under the test's output dir as the
 * exact JCS bytes the publisher writes (`jcsBytes` from @countylens/publish), so verify-manifest
 * passes its "exact JCS bytes" guard and reaches the per-artifact checks.
 */
function tamperedManifest(
  run: PublishedRun,
  label: string,
  change: (artifact: ManifestArtifact) => ManifestArtifact,
  pick: (artifacts: ManifestArtifact[]) => ManifestArtifact | undefined,
): { path: string; artifact: ManifestArtifact } {
  const original = pick(run.manifest.artifacts);
  if (!original) throw new Error("no artifact to tamper with");
  const artifacts = run.manifest.artifacts.map((a) => (a === original ? change(a) : a));
  const path = test.info().outputPath(`tampered-${label}.json`);
  writeFileSync(path, jcsBytes(RunManifestV1.parse({ ...run.manifest, artifacts })));
  return { path, artifact: original };
}

function flipHex(hex: string): string {
  return (hex[0] === "0" ? "1" : "0") + hex.slice(1);
}

function flipCid(cid: string): string {
  const last = cid.at(-1) ?? "a";
  return cid.slice(0, -1) + (last === "a" ? "b" : "a");
}

test.describe("A-03 verify-manifest (FR-006)", () => {
  test.describe.configure({ timeout: 30 * 60_000 });

  test.beforeEach(({ run }) => {
    expect(
      existsSync(committedManifestPath(run.runId)),
      `runs/${run.runId}/manifest.json is committed`,
    ).toBe(true);
  });

  test.describe("A-03-TC-040 verify-manifest via Pinata + Filebase prints ALL ARTIFACTS VERIFIED", () => {
    test("@scenario:A-03-TC-040", async ({ run }) => {
      const result = await verify([committedManifestPath(run.runId)], "tc-040");
      const out = lines(result.output);
      expect(result.code, "exit code 0").toBe(0);
      expect(lastLine(result), "the last line").toBe(SUCCESS);

      // 1b: the manifest itself, byte-compared, once per gateway, before any artifact.
      for (const host of gateways()) {
        const manifestLine = out.findIndex((line) => /manifest/i.test(line) && line.includes(host));
        expect(manifestLine, `a manifest line for ${host}`).toBeGreaterThanOrEqual(0);
        expect(out[manifestLine], `the ${host} manifest line reports a match`).not.toMatch(
          /mismatch|fail|error/i,
        );
        const firstArtifactLine = out.findIndex((line) =>
          run.manifest.artifacts.some((a) => line.includes(publicCid(a))),
        );
        if (firstArtifactLine >= 0) {
          expect(
            manifestLine,
            `the ${host} manifest line precedes every artifact line`,
          ).toBeLessThan(firstArtifactLine);
        }
      }

      // 2: one line per artifact per gateway, each naming the fetched CID.
      const missing: string[] = [];
      for (const artifact of run.manifest.artifacts) {
        const cid = publicCid(artifact);
        for (const host of gateways()) {
          if (!out.some((line) => line.includes(cid) && line.includes(host))) {
            missing.push(`${artifact.name} (${cid}) on ${host}`);
          }
        }
      }
      expect(missing, "every artifact has a line per gateway").toEqual([]);

      // 3: nothing went to the CID copy, ipfs.io, dweb.link or w3s.link.
      for (const host of forbiddenHosts()) {
        expect(result.output, `no line mentions ${host}`).not.toContain(host);
      }
    });
  });

  test.describe("A-03-TC-041 verify-manifest fails on a size or SHA-256 mismatch", () => {
    test("@scenario:A-03-TC-041", async ({ run }) => {
      const firstTable = (artifacts: ManifestArtifact[]) =>
        artifacts.find((a) => a.kind === "table");

      const sha = tamperedManifest(
        run,
        "sha256",
        (a) => ({ ...a, sha256: flipHex(a.sha256) }),
        firstTable,
      );
      const shaResult = await verify([sha.path], "tc-041-sha256");
      expect(shaResult.code, "sha256 mismatch exits non-zero").not.toBe(0);
      expect(shaResult.output).not.toContain(SUCCESS);
      expect(shaResult.output, "names the artifact").toContain(sha.artifact.name);
      expect(shaResult.output, "names the mismatched field").toMatch(/sha256/i);
      expect(
        failLines(shaResult, sha.artifact.name).length,
        `a FAIL line names ${sha.artifact.name}`,
      ).toBeGreaterThan(0);

      const size = tamperedManifest(run, "size", (a) => ({ ...a, size: a.size + 1 }), firstTable);
      const sizeResult = await verify([size.path], "tc-041-size");
      expect(sizeResult.code, "size mismatch exits non-zero").not.toBe(0);
      expect(sizeResult.output).not.toContain(SUCCESS);
      expect(sizeResult.output, "names the artifact").toContain(size.artifact.name);
      expect(sizeResult.output, "names the mismatched field").toMatch(/size/i);
      expect(
        failLines(sizeResult, size.artifact.name).length,
        `a FAIL line names ${size.artifact.name}`,
      ).toBeGreaterThan(0);
    });
  });

  test.describe("A-03-TC-042 verify-manifest refuses non-allowlisted hosts", () => {
    test("@scenario:A-03-TC-042", async ({ run }) => {
      const copy = harnessConfig().CID_COPY_HOST;
      const hosts = copy ? [copy, ...RETIRED_HOSTS] : RETIRED_HOSTS;
      expect(
        hosts.length,
        "the CID copy host and the three retired or non-independent gateways",
      ).toBe(4);
      for (const host of hosts) {
        const result = await verify(
          [committedManifestPath(run.runId), "--gateway", host],
          `tc-042-${host}`,
        );
        expect(result.code, `${host}: exits non-zero`).not.toBe(0);
        expect(result.output, `${host}: the exact refusal`).toContain(refusalText(host));
        expect(result.output, `${host}: nothing verified`).not.toContain(SUCCESS);
        expect(result.output, `${host}: no fetch line`).not.toContain("/ipfs/");
      }
    });
  });

  test.describe("A-03-TC-043 CAR artifacts verified through their carCid bytes", () => {
    test("@scenario:A-03-TC-043", async ({ run }) => {
      const withCarCid = [
        ...artifactsOf(run.manifest, "car"),
        ...artifactsOf(run.manifest, "directory"),
      ];
      expect(withCarCid.length, "four CAR-backed artifacts").toBe(4);

      const result = await verify([committedManifestPath(run.runId), "--verbose"], "tc-043");
      expect(result.code).toBe(0);
      expect(lastLine(result)).toBe(SUCCESS);
      const out = lines(result.output);
      for (const artifact of withCarCid) {
        const carCid = publicCid(artifact);
        for (const host of gateways()) {
          expect(
            out.some((line) => line.includes(`/ipfs/${carCid}`) && line.includes(host)),
            `${artifact.name}: fetched /ipfs/${carCid} from ${host}`,
          ).toBe(true);
        }
        expect(
          out.some((line) => line.includes(`/ipfs/${artifact.cid}`)),
          `${artifact.name}: the dag-json root ${artifact.cid} is never fetched as a file`,
        ).toBe(false);
      }

      const corrupted = tamperedManifest(
        run,
        "carcid",
        (a) => ({ ...a, carCid: a.carCid ? flipCid(a.carCid) : a.carCid }),
        (artifacts) => artifacts.find((a) => a.kind === "car"),
      );
      const bad = await verify([corrupted.path, "--verbose"], "tc-043-corrupted");
      expect(bad.code, "a corrupted carCid exits non-zero").not.toBe(0);
      expect(bad.output).not.toContain(SUCCESS);
      expect(bad.output, "names the artifact").toContain(corrupted.artifact.name);
      expect(
        failLines(bad, corrupted.artifact.name).length,
        `a FAIL line names ${corrupted.artifact.name}`,
      ).toBeGreaterThan(0);
    });
  });
});
