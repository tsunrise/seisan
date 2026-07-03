import { app } from "./app";
import { CategoryPocStore } from "./do/CategoryPocStore";
import { LimitsStore } from "./do/LimitsStore";
import { LoginAttemptStore } from "./do/LoginAttemptStore";
import { ProjectStore } from "./do/ProjectStore";
import { ProjectsRegistry } from "./do/ProjectsRegistry";
import { UserAPIKeysStore } from "./do/UserAPIKeysStore";

export {
  CategoryPocStore,
  LimitsStore,
  LoginAttemptStore,
  ProjectStore,
  ProjectsRegistry,
  UserAPIKeysStore,
};

export default {
  fetch(request, env, executionContext) {
    return app.fetch(request, env, executionContext);
  },
} satisfies ExportedHandler<Env>;
