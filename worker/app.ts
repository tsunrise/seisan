import { Hono } from "hono";
import { describeRoute } from "hono-openapi";

import type { EnvWithIdentity } from "./auth";
import { OpenApiResponses } from "./model";
import { adminApp } from "./routes/admin";
import { apiKeysApp } from "./routes/apiKeys";
import { loginApp } from "./routes/login";
import { projectApp } from "./routes/project";
import { registryApp } from "./routes/registry";

export const app = new Hono<EnvWithIdentity>();

app.route("/api/admin", adminApp);
app.route("/api", loginApp);
app.route("/api", apiKeysApp);
app.route("/api", registryApp);
app.route("/api", projectApp);

app.get(
  "/api/ping",
  describeRoute({
    tags: ["System"],
    summary: "Ping the Worker API.",
    responses: {
      200: OpenApiResponses.Ping,
    },
  }),
  (context) => {
    console.log("ping called");
    return context.text("Hello World");
  },
);
