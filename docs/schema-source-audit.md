# Schema Source Audit

This audit records duplicated logical data shapes found while adding project-member config. It is
an inventory for later cleanup, not authorization to move Worker schemas into frontend code or to
make frontend modules depend on Worker modules. Frontend response types may remain duplicated until
a separately scoped shared-contract design is chosen.

## Resolved in the member-config change

The Worker has one canonical Zod definition for each member-related shape in `worker/project.ts`:

- `ProjectMember`
- `ProjectMemberFull`
- `ProjectMemberConfig`
- `ProjectMemberConfigPatch`

`worker/model.ts`, project routes, and `ProjectStore` reuse those schemas instead of repeating their
fields. Durable Object RPC envelopes compose the config schemas and infer their TypeScript input
types from the resulting envelope schemas. The frontend keeps local response-type declarations and
does not import Worker code.

## Existing duplication left for later work

The following pre-existing groups have parallel type or schema declarations. Inline
`TODO(schema-source)` comments mark the relevant backend and Node-client definitions:

- Project primitives, ACLs, money maps, record descriptions, records, summaries, and project HTTP
  request/response bodies across `worker/project.ts`, `worker/routes/project.ts`, and
  `worker/model.ts`.
- Category documents, classifications, and write-operation inputs across `worker/category`, category
  routes, OpenAPI models, and the Node client.
- Login request bodies across login routes and OpenAPI models.
- API-key metadata and API-key wire-format validation across Worker code and the Node client.
- Registry administrative result shapes across the registry Durable Object and API consumers.
- Test-only response shapes that manually mirror public project responses.

Limits and other frontend API response interfaces also mirror backend contracts. They are noted
here but intentionally have no audit-driven frontend edits.

## Architectural constraint

Importing `worker/project.ts` from frontend code is not a safe shortcut for sharing types. That
module transitively imports Worker-only modules, including code using Cloudflare globals such as
`KVNamespace`, so it breaks the frontend TypeScript environment and couples the browser bundle to
backend implementation boundaries. Any future cross-environment contract sharing should use a
deliberately runtime-neutral module and be handled as a separately scoped refactor.
