import { Hono } from "hono";

import type { EnvWithIdentity } from "./auth";
import { LimitsStore } from "./do/LimitsStore";
import { LoginAttemptStore } from "./do/LoginAttemptStore";
import { ProjectStore } from "./do/ProjectStore";
import { ProjectsRegistry } from "./do/ProjectsRegistry";
import { adminApp } from "./routes/admin";
import { loginApp } from "./routes/login";
import { projectApp } from "./routes/project";
import { registryApp } from "./routes/registry";

export { LimitsStore, LoginAttemptStore, ProjectStore, ProjectsRegistry };

const app = new Hono<EnvWithIdentity>();

app.route("/api/admin", adminApp);
app.route("/api", loginApp);
app.route("/api", registryApp);
app.route("/api", projectApp);

app.get("/api/ping", (context) => {
  console.log("ping called");
  return context.text("Hello World");
});

export default {
  fetch(request, env, executionContext) {
    return app.fetch(request, env, executionContext);
  },
} satisfies ExportedHandler<Env>;
