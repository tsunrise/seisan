import { app } from "./app";
import { LimitsStore } from "./do/LimitsStore";
import { LoginAttemptStore } from "./do/LoginAttemptStore";
import { ProjectStore } from "./do/ProjectStore";
import { ProjectsRegistry } from "./do/ProjectsRegistry";

export { LimitsStore, LoginAttemptStore, ProjectStore, ProjectsRegistry };

export default {
  fetch(request, env, executionContext) {
    return app.fetch(request, env, executionContext);
  },
} satisfies ExportedHandler<Env>;
