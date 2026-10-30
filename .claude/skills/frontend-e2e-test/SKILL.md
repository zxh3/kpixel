---
name: frontend-e2e-test
description: Verify kpixel frontend changes in a real browser and guard user flows with Playwright end-to-end tests, then attach screenshots to the pull request. Use this whenever a change affects what users see or do — routes, components, styles, the editor canvas and tools, keyboard shortcuts, forms, loading or error states, or server functions a page depends on — before calling the work done or opening a PR, even if nobody asked for testing. Also use it to take screenshots of the app or add them to a PR.
---

# Frontend e2e testing

A UI change isn't done until you have seen it work in a real browser. Type checks and unit tests can't tell you that a button is hidden behind a panel, a route crashes during SSR, or a stroke lands one pixel off. This skill covers three things: verifying a change by driving the app, locking important flows in with Playwright tests, and putting screenshots in front of reviewers.

## Decide what the change needs

| Change                                                       | Verify in browser | Add or update a spec                   |
| ------------------------------------------------------------ | ----------------- | -------------------------------------- |
| No UI impact (docs, config, server code no page relies on)   | No                | No; `pnpm check` is enough             |
| Visual-only tweak (spacing, colour, copy)                    | Yes, screenshot   | Rarely                                 |
| New or changed user flow, editor tool, shortcut, route, form | Yes               | Yes, if users rely on it               |
| Bug fix in the UI                                            | Yes               | Yes: a test that failed before the fix |

When in doubt, verify. It takes a minute and catches what reading code misses.

## 1. Verify in a real browser

Run the app, preferably as a background process, and reuse it if one is already running:

- `pnpm dev` serves http://localhost:4200 with hot reload. Use it while iterating.
- `pnpm preview --port 4173` builds for production and serves the Worker in workerd. Check here before a PR, because SSR and build problems only show up in the real build.

Drive it with `playwright-cli`. It is headless, keeps browser state between commands, and writes page snapshots to files instead of flooding context, which is why Playwright recommends it for coding agents. Use a named session so you don't collide with other work:

```bash
pnpm exec playwright-cli -s=kpixel open http://localhost:4200
pnpm exec playwright-cli -s=kpixel snapshot            # page structure with element refs (e12…)
pnpm exec playwright-cli -s=kpixel find "Export"       # grep the snapshot instead of reading it all
pnpm exec playwright-cli -s=kpixel click e12           # or a locator: "getByRole('button', { name: 'Export' })"
pnpm exec playwright-cli -s=kpixel fill e15 "walk cycle" --submit
pnpm exec playwright-cli -s=kpixel press Control+z
pnpm exec playwright-cli -s=kpixel console error       # any console errors?
pnpm exec playwright-cli -s=kpixel requests            # failed network calls?
pnpm exec playwright-cli -s=kpixel screenshot --filename=test-results/screenshots/export-dialog.png
pnpm exec playwright-cli -s=kpixel close
```

`pnpm exec playwright-cli --help` lists everything else: mouse moves and drags (useful for drawing on the canvas), `resize`, `set-color-scheme`, `eval`, `tracing-start`, `video-start`. If your harness has its own browser tool, such as a built-in browser pane or a Chrome DevTools MCP server, it's fine for a quick look, but use `playwright-cli` when you need screenshot files or steps someone can repeat.

What to check:

- The whole flow you changed, end to end, as a user would do it.
- At least one unhappy path: empty state, invalid input, an error from the server, very long content.
- No new console errors or failed requests.
- Keyboard use for anything in the editor, since pixel artists live on shortcuts.
- If styles changed: a narrow viewport (`resize 375 812`) and dark mode (`set-color-scheme dark`).
- If state should survive a reload, reload and confirm.

Save screenshots under `test-results/screenshots/` (gitignored) with descriptive names. For visual changes, take a "before" shot first so reviewers can compare.

## 2. Guard the flow with a Playwright test

Specs live in `e2e/<feature>.spec.ts`; `e2e/smoke.spec.ts` is the template. `pnpm test:e2e` builds the app and runs every spec against `vite preview` on port 4173, reusing a server that's already running there.

```bash
pnpm test:e2e                          # all specs
pnpm test:e2e e2e/export.spec.ts       # one file; add --headed or --debug to watch
pnpm exec playwright show-report       # after a failure, then open the trace for the failing test
```

Write tests the way a user experiences the app, so they survive refactors:

- Locate elements by role, label or text (`getByRole("button", { name: "Export" })`). Add a `data-testid` only when there is no accessible handle.
- Use web-first assertions (`await expect(locator).toBeVisible()`), which retry until they pass. Never use `waitForTimeout`.
- Keep each test independent: its own setup, no reliance on another test's state or on run order.
- One behaviour per test with a name that says what should happen. Use `test.step` to label phases of a long flow.
- To turn a manual session into a spec, `playwright-cli generate-locator <ref>` and `recording-start`/`recording-stop` print Playwright code.

**Canvas content.** The editor draws pixels on a canvas, which locators can't see into. Assert on pixel values instead: read them with `page.evaluate`, from the document model the app exposes or from the canvas with `getImageData`. Use `toHaveScreenshot()` only for stable regions at a fixed viewport, and remember its baselines differ between macOS and Linux, so generate them on the platform where CI runs them.

Run the specs you touched, and the smoke spec, before finishing. If a test fails, find out why; don't loosen the assertion until it passes.

## 3. Attach screenshots to the PR

GitHub has no API for uploading images, so screenshots go to the `kpixel-pr-screenshots` R2 bucket. It serves files through a public r2.dev URL and deletes them after 30 days.

```bash
# Upload and comment on PR 42:
.claude/skills/frontend-e2e-test/scripts/upload-screenshots.sh --comment 42 test-results/screenshots/*.png

# Or just print Markdown image links to paste into the PR description:
.claude/skills/frontend-e2e-test/scripts/upload-screenshots.sh test-results/screenshots/*.png
```

If the script reports that the bucket has no public URL, run `.claude/skills/frontend-e2e-test/scripts/setup-screenshot-bucket.sh` once; it needs `wrangler login`. Anyone with a link can open these images, so never capture secrets, tokens or real user data.

## 4. Report what you tested

In your final message, and in a "Testing" section of the PR description, say:

- what you verified in the browser and against which server (dev or preview), including viewports or colour schemes;
- which specs you added or ran, and the result;
- the screenshots;
- anything you could not verify, and why.

Report failures as failures. A clear "the export button works, but the GIF option throws an error" is far more useful than a vague "tested".
