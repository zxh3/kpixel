# AGENTS.md

TanStack Start app on Cloudflare Workers. See README.md for the stack and layout.

## Commands

- `pnpm check` — format check, lint, typecheck. Run before finishing any change.
- `pnpm test` — unit and property-based tests (Vitest, fast-check). Run before finishing any change to logic.
- `pnpm fmt` / `pnpm lint:fix` — auto-fix formatting and lint issues.
- `pnpm build` — production build; also regenerates `src/routeTree.gen.ts`.
- `pnpm cf-typegen` — run after every `wrangler.jsonc` change.
- `pnpm test:e2e` — Playwright end-to-end tests in `e2e/`, run against the production build.

## Testing UI changes

Verify every change that affects the UI in a real browser before calling it done, and add a Playwright spec for flows users rely on. Follow the `frontend-e2e-test` skill in [.claude/skills/frontend-e2e-test/SKILL.md](.claude/skills/frontend-e2e-test/SKILL.md), which also covers attaching screenshots to PRs.

## Document model

`src/document/` is the foundation for everything else; read [docs/design/document-model.md](docs/design/document-model.md) before changing it.

- Change documents only by applying operations in transactions, never by mutating them. Documents are immutable.
- Keep `src/document/` free of React, framework and Cloudflare imports so it runs everywhere; oxlint enforces this.
- A new operation needs a TypeBox schema, an exact inverse, invariant coverage, unit tests for its preconditions, and a case in `test-support/random-operations.ts` so the property tests exercise it.
- Changing the stored document shape means bumping `DOCUMENT_SCHEMA_VERSION`, adding a migration in `migrations.ts`, and regenerating `docs/schemas/` with `pnpm test -u`. Never edit a shipped migration.
- `.aseprite` support is clean-room: work only from Aseprite's published file spec and from files Aseprite produces. Never read, copy or port Aseprite's source code; its EULA forbids reuse.

## Conventions

- Package manager is pnpm. Do not use npm or yarn.
- Give everything (variables, functions, files, directories) a clear, descriptive name that follows the established convention for its kind. Avoid cryptic abbreviations and unusual naming.
- Import from `src` with the `@/` alias (e.g. `@/components/ui/button`).
- Use oxfmt and oxlint only; there is no Prettier or ESLint.
- Use shadcn components for generic UI. Add them with `pnpm dlx shadcn@latest add <component>` rather than writing them by hand.
- Write a custom component only when it is one-off or shadcn has no equivalent. Merge classes with `cn`.
- Use Tailwind theme tokens (`bg-background`, `text-muted-foreground`, …) instead of raw colors.
- Cloudflare bindings are server-only: read them via `import { env } from "cloudflare:workers"` inside server functions (`createServerFn`) or server routes. Route loaders and components are isomorphic, so call a server function from them instead of importing `env` directly.
- Never edit `src/routeTree.gen.ts` or `worker-configuration.d.ts` by hand.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/): `type(scope): summary`, e.g. `feat(auth): add login page`.

## Roadmap and changelog

[docs/roadmap.md](docs/roadmap.md) is the living plan. When work completes a roadmap milestone or changes the plan, update the roadmap in the same commit, following its "Updating this roadmap" section.

`docs/changelog/` records milestones and decisions; see its [README](docs/changelog/README.md) for the file naming and template.

- Add an entry only for a milestone: a new feature or subsystem, a roadmap phase step, an architectural or product decision, or a change to the stack or infrastructure.
- Skip bug fixes, refactors, dependency bumps, small UI tweaks and doc edits. Most commits get no entry.
- Write the entry in the same commit as the work it describes. If one day's work extends an existing entry for the same milestone, update that entry instead of adding another.
- Never rewrite past entries beyond typo fixes. When a decision is reversed, add a new entry that links to the old one.

## React

Follow [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect). Use `useEffect` only to synchronize with an external system (browser APIs, non-React widgets, subscriptions). If no external system is involved, you don't need an Effect.

- Derive values during render instead of copying props or state into new state. Reach for `useMemo` only when a pure calculation is measurably slow.
- Put logic caused by a user action in that event handler, not in an Effect that watches state. Compute all the next state in the handler rather than chaining Effects.
- Reset a component's state on a prop change by giving it a `key`. Store IDs rather than copies of objects, and derive the object during render.
- Update the parent in the same handler that updates the child, or lift the state up. Never sync parent and child through Effects.
- Load data in route loaders that call server functions, then pass it down. If a component must fetch in an Effect, ignore stale responses in its cleanup.
- Subscribe to external sources with `useSyncExternalStore` or a zustand store, not with `useEffect` plus `useState`.
- Components must survive Strict Mode double-mounting. Run one-time app initialization at module level, not in a mount Effect.

## State management

Keep each piece of state in the narrowest place that works:

1. Server data: route loaders and server functions. Do not copy it into a store.
2. Shareable UI state (filters, tabs, pagination): URL search params via `validateSearch`.
3. State used by one component or a small subtree: `useState` or `useReducer`, lifted only as far as needed.
4. Client state shared across distant components: a zustand store.

Zustand rules:

- Put each store in `src/stores/<name>-store.ts` and export a `use<Name>Store` hook, one store per domain.
- Type stores with `create<State>()(...)`. Keep actions in the store beside the state, update immutably with `set`, and read current state inside actions with `get`.
- Keep only minimal state in the store. Compute derived values in selectors.
- Always pass a selector and pick the smallest value, e.g. `useCartStore((s) => s.count)`. Wrap selectors that return a new object or array in `useShallow`.
- Never write to a module-level store on the server (in loaders, server functions, or during render). The Worker shares it across requests, so writes leak between users, and SSR only ever sees its initial state. For state seeded from server data, create a store per request with `createStore` from `zustand/vanilla` and provide it through React context with `useState(() => createXStore(init))`.
- With `persist`, set `skipHydration: true` and call `persist.rehydrate()` once in the root after mount, so the server and client render the same first frame.
