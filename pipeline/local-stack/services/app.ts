import "dotenv/config";
import * as restate from "@restatedev/restate-sdk";
import { createTravisDiscovery } from "../../oracle-runtime/travis/discovery/workflow.js";

// Local Oracle services endpoint. Services are bound here as they are authored
// (durable-workflow-builder).
//
// One Restate SDK instance: oracle-runtime imports the SDK type-only and receives this
// module's SDK here, so only pipeline/local-stack/node_modules/@restatedev/restate-sdk is
// loaded at runtime.
const travisDiscovery = createTravisDiscovery(restate);

restate.serve({ services: [travisDiscovery], port: 9080 });
