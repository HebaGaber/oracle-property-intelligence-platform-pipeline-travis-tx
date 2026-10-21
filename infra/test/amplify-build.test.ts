// amplify.yml (A-03 T044) after /code-review Major 3: the build spec parses as YAML with the
// monorepo shape the Web stack expects, and the run-index step never fails a build when
// runs/index.json has not been published yet. The step is executed here with bash in a temporary
// tree laid out like the repo (apps/web as the working directory), once with and once without
// the index. When absent nothing is written: /runs/index.json then answers 404 (the SPA fallback
// excludes .json) and the Runs page shows RUN_INDEX_TEXTS.unreadable; no placeholder data.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { AMPLIFY_MONOREPO_APP_ROOT } from "../src/web-stack.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
// infra declares no YAML parser; the workspace's copy (pipeline/oracle-runtime) is used read-only.
const { parse } = createRequire(join(ROOT, "pipeline/oracle-runtime/package.json"))("yaml") as {
  parse: (text: string) => unknown;
};

interface BuildSpec {
  version: number;
  applications: {
    appRoot: string;
    frontend: {
      phases: Record<"preBuild" | "build", { commands: string[] }>;
      artifacts: { baseDirectory: string; files: string[] };
    };
  }[];
}

const spec = parse(readFileSync(join(ROOT, "amplify.yml"), "utf8")) as BuildSpec;
const app = spec.applications[0];
const preBuild = app?.frontend.phases.preBuild.commands ?? [];
const indexSteps = preBuild.filter((c) => c.includes("runs/index.json"));

let tmp: string | undefined;
afterEach(() => {
  if (tmp !== undefined) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

/** Runs the mkdir + index steps of preBuild with bash in a fresh repo-shaped tree. */
function runIndexSteps(index: string | undefined): { web: string; output: string } {
  tmp = mkdtempSync(join(tmpdir(), "amplify-yml-"));
  const web = join(tmp, AMPLIFY_MONOREPO_APP_ROOT);
  mkdirSync(web, { recursive: true });
  if (index !== undefined) {
    mkdirSync(join(tmp, "runs"));
    writeFileSync(join(tmp, "runs/index.json"), index);
  }
  const steps = preBuild.filter(
    (c) => c.startsWith("mkdir -p public/runs") || indexSteps.includes(c),
  );
  const output = execFileSync("bash", ["-euo", "pipefail", "-c", steps.join("\n")], {
    cwd: web,
    encoding: "utf8",
  });
  return { web, output };
}

describe("amplify.yml (T044): structure and the run-index step", () => {
  it("parses as YAML: version 1, one application rooted at apps/web, dist artifacts", () => {
    expect(spec.version).toBe(1);
    expect(spec.applications).toHaveLength(1);
    expect(app?.appRoot).toBe(AMPLIFY_MONOREPO_APP_ROOT);
    expect(app?.frontend.artifacts.baseDirectory).toBe("dist");
    expect(app?.frontend.phases.build.commands).toContain("pnpm exec vite build");
    for (const c of [...preBuild, ...(app?.frontend.phases.build.commands ?? [])])
      expect(typeof c).toBe("string");
  });

  it("copies runs/index.json only when it exists: a single guarded step, no bare cp", () => {
    expect(indexSteps).toHaveLength(1);
    expect(indexSteps[0]).toMatch(/if \[ -f \.\.\/\.\.\/runs\/index\.json \]/);
    expect(preBuild).not.toContain("cp ../../runs/index.json public/runs/index.json");
  });

  it("before the first publish: the step succeeds and writes no index (no placeholder data)", () => {
    const { web, output } = runIndexSteps(undefined);
    expect(existsSync(join(web, "public/runs"))).toBe(true);
    expect(existsSync(join(web, "public/runs/index.json"))).toBe(false);
    expect(output).toMatch(/runs\/index\.json/);
  });

  it("after a publish: the committed index is copied byte for byte", () => {
    const committed = '{"version":1,"runs":[]}\n';
    const { web } = runIndexSteps(committed);
    expect(readFileSync(join(web, "public/runs/index.json"), "utf8")).toBe(committed);
  });
});
