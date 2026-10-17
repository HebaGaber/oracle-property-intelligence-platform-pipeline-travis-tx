import "dotenv/config";
import * as restate from "@restatedev/restate-sdk";

// Local Oracle services endpoint. Services are bound here as they are authored
// (durable-workflow-builder); it starts empty.
restate.serve({ services: [], port: 9080 });
