# Bootstrap

Set up the repo as a TanStack Start app on Cloudflare Workers, with the tooling and conventions every later change builds on. No product features yet.

## Changes

- TanStack Start + Router on Workers via `@cloudflare/vite-plugin`; `wrangler.jsonc` with `nodejs_compat`, observability and source-map upload.
- Tailwind CSS v4 and shadcn/ui (Base UI, `base-nova` style).
- oxlint (type-aware) and oxfmt; `pnpm check` runs format check, lint and typecheck. CI runs it plus `cf-typegen --check` and a build.
- TypeScript 7 in strict mode, including `noUncheckedIndexedAccess`.
- Product named kpixel. Added zustand and the React, state management and naming rules in [AGENTS.md](../../AGENTS.md).

## Decisions

- One `@/*` import alias, matching shadcn's expectations.
- Generated files (`src/routeTree.gen.ts`, `worker-configuration.d.ts`) are committed so typechecking works on a fresh clone.
- No deploy workflow yet; deploys use `pnpm deploy` or Workers Builds.
