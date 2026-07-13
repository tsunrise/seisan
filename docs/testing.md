# Testing

Use this before adding or changing tests.

## Worker Tests

- Tests use `@cloudflare/vitest-pool-workers` and `cloudflare:test`.
- Use `runInDurableObject` to inspect or seed Durable Object storage in unit-style tests.
- Use `runDurableObjectAlarm` to manually run Durable Object alarms.
- HTTP test helpers should call `waitOnExecutionContext()` after `worker.fetch()` so `ctx.waitUntil()` work completes before assertions.
- After `waitOnExecutionContext()`, tests should directly assert expected `waitUntil` side effects such as configured alarms.
- Avoid polling helpers for those cases unless testing eventual external behavior explicitly.
- Mock external services such as Email and Turnstile in tests; tests should not depend on real network calls.
- Keep malformed schema tests for zod-covered request bodies.
- After changing bindings or Wrangler config, regenerate `worker-configuration.d.ts`.

## Frontend Checks

For frontend-only changes, usually run:

```sh
pnpm run typecheck:frontend
pnpm run format:check
pnpm run lint
```

Run `pnpm run build` when touching routing, theme/styles, Vite config, shared imports, or assets used by the production bundle.

## Node CLI Tests

Run `pnpm run test:client` for the Node API client and CLI credential behavior. These tests use the Node test runner separately from the Worker-runtime Vitest suite.

## Browser Verification

Use browser verification when changing visible layout, responsive behavior, scrolling, or user flows, or when explicitly requested.

- Always use the in-app Browser plugin (`[@Browser](plugin://browser@openai-bundled)`) instead of standalone Playwright for this verification.
- Do not run full browser-flow checks for every small code cleanup.
- When verifying visual changes, take a screenshot with the in-app Browser and inspect it visually with multimodal capability.
- Do not rely only on DOM geometry, computed styles, or coordinate checks for UI quality.
- When changing timeline pagination or scroll restoration, verify the main cases when practical: initial latest-record positioning, loading older records without scroll jumps, record detail navigation and back, and mobile fixed action clearance.
