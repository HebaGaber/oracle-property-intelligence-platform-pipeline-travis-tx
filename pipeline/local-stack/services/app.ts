import "dotenv/config";
import * as restate from "@restatedev/restate-sdk";
import { createSourceClient } from "../../oracle-runtime/travis/lib/source-client.js";
import { createTravisDiscovery, createUs1Probes } from "../../oracle-runtime/travis/discovery/workflow.js";
import { writeCatalog } from "../../oracle-runtime/travis/discovery/write-catalog.js";

// Local Oracle services endpoint. Services are bound here as they are authored
// (durable-workflow-builder).
//
// One Restate SDK instance: oracle-runtime imports the SDK type-only and receives this
// module's SDK here, so only pipeline/local-stack/node_modules/@restatedev/restate-sdk is
// loaded at runtime.
//
// TravisDiscovery (A-01): the US1 probes run only when a run is started (`discover`); every
// request goes through the single source client (2 per host, identified User-Agent,
// StopOnBlocked). The catalog is written to pipeline/docs/travis-sources.yaml.
const travisDiscovery = createTravisDiscovery(restate, {
  probes: () => createUs1Probes({ client: createSourceClient(), now: () => new Date() }),
  writeCatalog: (catalog) => writeCatalog(catalog),
});

restate.serve({ services: [travisDiscovery], port: 9080 });
