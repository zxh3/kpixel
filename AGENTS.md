# AGENTS.md

TanStack Start app on Cloudflare Workers. See README.md for the stack and layout.

## Commands

- `pnpm check` — format check, lint, typecheck. Run before finishing any change.
- `pnpm fmt` / `pnpm lint:fix` — auto-fix formatting and lint issues.
- `pnpm build` — production build; also regenerates `src/routeTree.gen.ts`.
- `pnpm cf-typegen` — run after every `wrangler.jsonc` change.

## Conventions

- Package manager is pnpm. Do not use npm or yarn.
- Import from `src` with the `@/` alias (e.g. `@/components/ui/button`).
- Use oxfmt and oxlint only; there is no Prettier or ESLint.
- Use shadcn components for generic UI. Add them with `pnpm dlx shadcn@latest add <component>` rather than writing them by hand.
- Write a custom component only when it is one-off or shadcn has no equivalent. Merge classes with `cn`.
- Use Tailwind theme tokens (`bg-background`, `text-muted-foreground`, …) instead of raw colors.
- Cloudflare bindings are server-only: read them via `import { env } from "cloudflare:workers"` inside server functions (`createServerFn`) or server routes. Route loaders and components are isomorphic, so call a server function from them instead of importing `env` directly.
- Never edit `src/routeTree.gen.ts` or `worker-configuration.d.ts` by hand.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/): `type(scope): summary`, e.g. `feat(auth): add login page`.
