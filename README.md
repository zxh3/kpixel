# kpixel

[TanStack Start](https://tanstack.com/start) app deployed to [Cloudflare Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/).

## Stack

- **Framework** — TanStack Start + TanStack Router (file-based routes in `src/routes`)
- **Runtime** — Cloudflare Workers via `@cloudflare/vite-plugin` (dev runs in `workerd`)
- **UI** — Tailwind CSS v4, shadcn/ui (Base UI, `base-nova` style), lucide icons
- **Tooling** — Vite 8, TypeScript 7, [oxlint](https://oxc.rs/docs/guide/usage/linter) (type-aware), [oxfmt](https://oxc.rs/docs/guide/usage/formatter)

## Getting started

Requires Node 24+ and pnpm (`corepack enable`).

```bash
pnpm install
pnpm dev
```

The app runs at http://localhost:3000.

## Scripts

| Script            | Description                                                  |
| ----------------- | ------------------------------------------------------------ |
| `pnpm dev`        | Start the dev server (runs inside the Workers runtime)       |
| `pnpm build`      | Production build                                             |
| `pnpm preview`    | Build and preview the production bundle locally              |
| `pnpm deploy`     | Build and deploy with Wrangler                               |
| `pnpm cf-typegen` | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc` |
| `pnpm check`      | Format check + lint + typecheck (what CI runs)               |
| `pnpm fmt`        | Format with oxfmt                                            |
| `pnpm lint`       | Lint with oxlint                                             |
| `pnpm typecheck`  | Typecheck with `tsc`                                         |

## Project layout

```
src/
  components/ui/   shadcn/ui components (add with `pnpm dlx shadcn@latest add <name>`)
  lib/             shared utilities
  routes/          file-based routes (`__root.tsx` is the HTML shell)
  router.tsx       router factory
  styles.css       Tailwind entry + shadcn theme tokens
wrangler.jsonc     Worker config (bindings, vars, compatibility)
```

Generated files — `src/routeTree.gen.ts` and `worker-configuration.d.ts` — are committed and must not be edited by hand.

## Cloudflare

Bindings (KV, D1, R2, Durable Objects, Queues, …) are declared in `wrangler.jsonc`. After changing it, run `pnpm cf-typegen`. Access bindings in server-only code via:

```ts
import { env } from "cloudflare:workers";
```

Local secrets go in `.dev.vars` (gitignored). Production secrets: `pnpm wrangler secret put <NAME>`.

To add Queues, Cron Triggers, Durable Objects, or Workflows, create a custom server entry (e.g. `src/server.ts`) and point `main` in `wrangler.jsonc` at it — see the [Cloudflare guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/#custom-entrypoints).

## Deploy

```bash
pnpm wrangler login
pnpm deploy
```

Or connect the repo to [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) for deploys on push.
