import "dotenv/config";
import * as restate from "@restatedev/restate-sdk";
import { createSourceClient, type SourceClient } from "../../oracle-runtime/travis/lib/source-client.js";
import {
  createJurisdictionProbes,
  createTravisDiscovery,
  createUs1Probes,
} from "../../oracle-runtime/travis/discovery/workflow.js";
import { writeCatalog } from "../../oracle-runtime/travis/discovery/write-catalog.js";
import {
  DEFAULT_REPO_ROOT,
  writeBlockedEvidence,
} from "../../oracle-runtime/travis/discovery/blocked-evidence.js";
import { proveDestination } from "../../oracle-runtime/travis/discovery/destination-proof.js";
import { runValidator } from "../../oracle-runtime/travis/discovery/run-validator.js";
import { TRAVIS_JURISDICTION_PROFILE } from "../../oracle-runtime/travis/profiles/jurisdictions.js";

// Local Oracle services endpoint. Services are bound here as they are authored
// (durable-workflow-builder).
//
// One Restate SDK instance: oracle-runtime imports the SDK type-only and receives this
// module's SDK here, so only pipeline/local-stack/node_modules/@restatedev/restate-sdk is
// loaded at runtime.
//
// TravisDiscovery (A-01): the probes run only when a run is started (`discover`). Every
// request (US1 sources and US2 jurisdiction evidence) goes through one shared source client
// (2 per host, identified User-Agent, StopOnBlocked). The catalog is written to
// pipeline/docs/travis-sources.yaml with the destination proof (Docker side + SQL side,
// T044); each blocked source gets its evidence file under docs/evidence/blocked/ (T037);
// the vendored readiness validator runs on the first catalog and after each `captured`
// re-probe, saving docs/evidence/A-01-readiness.json (T045). A blocked source waits on a
// durable promise until `npm --prefix pipeline/oracle-runtime run resolve` (T036).
let client: SourceClient | null = null;
const sharedClient = (): SourceClient => (client ??= createSourceClient());
const now = (): Date => new Date();

const travisDiscovery = createTravisDiscovery(restate, {
  probes: () => createUs1Probes({ client: sharedClient(), now }),
  jurisdictions: () => createJurisdictionProbes({ client: sharedClient(), now }),
  profile: TRAVIS_JURISDICTION_PROFILE,
  writeCatalog: (catalog) => writeCatalog(catalog),
  writeEvidence: (relPath, content) => {
    writeBlockedEvidence(DEFAULT_REPO_ROOT, relPath, content);
  },
  secrets: () => [process.env.SOCRATA_APP_TOKEN ?? ""].filter((s) => s.length > 0),
  destinationProof: () => proveDestination(),
  runValidator: () => runValidator(),
});

restate.serve({ services: [travisDiscovery], port: 9080 });
