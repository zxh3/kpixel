# Roadmap

**Last updated:** 2026-10-29 · **Current focus:** Phase 0 — Foundation

This is a living plan for building kpixel, not a fixed commitment. Phases, milestones and their order will change as we learn; when they do, update this file and record the reason in the [changelog](changelog/). The reasoning behind the plan is in [product research](product-research.md), and the agent design is in [AI agent harness](ai-agent-harness.md).

## How we build

- **Foundation first.** Each phase leaves behind something solid that later phases stand on. AI arrives only once the document, the commands and the cleanup pipeline can carry it.
- **One way to change a document.** UI tools, AI jobs and agents all edit through the same typed, undoable command API.
- **AI proposes, people decide.** Generated output lands as editable proposals with recorded provenance, never as silent overwrites.
- **Never break files.** The native format is versioned with migrations from v1, and `.aseprite` round-trips losslessly.

## At a glance

| Phase                                                             | Goal                                        | Status      |
| ----------------------------------------------------------------- | ------------------------------------------- | ----------- |
| [Bootstrap](#bootstrap)                                           | A clean repo and toolchain to build on      | Done        |
| [0. Foundation](#phase-0--foundation)                             | A document you can trust                    | In progress |
| [1. Editor MVP](#phase-1--editor-mvp)                             | Finish a sprite without leaving the browser | Not started |
| [2. Pixel pipeline](#phase-2--pixel-pipeline)                     | Make any AI image or messy art game-ready   | Not started |
| [3. AI generation](#phase-3--ai-generation)                       | Generation that lands as editable proposals | Not started |
| [4. Agents and collaboration](#phase-4--agents-and-collaboration) | Humans and agents in the same document      | Not started |

Status values: **Not started**, **Next**, **In progress**, **Done**. Milestones use checkboxes; tick them as they land.

## Bootstrap

TanStack Start on Cloudflare Workers, Tailwind and shadcn/ui, oxlint and oxfmt, CI, Playwright end-to-end tests, agent conventions, product research and the agent harness decision. See the changelog for [bootstrap](changelog/2026-10-29-bootstrap.md), [product research](changelog/2026-10-29-product-research.md), [AI agent harness](changelog/2026-10-29-ai-agent-harness.md) and [end-to-end testing](changelog/2026-10-29-e2e-testing.md).

## Phase 0 — Foundation

**Goal:** a document model, command log and file I/O solid enough that every later feature inherits their guarantees.

- [x] **Test setup.** Vitest and fast-check for unit and property-based tests.
- [x] **Document model.** Aseprite-shaped graph (sprite, layers, frames, cels, cel data, tags, slices, palette, user data) with a stable UUID on every entity, RGBA and indexed colour, and invariants enforced in code. See [document model](design/document-model.md).
- [x] **Commands and transactions.** Serializable ops with schemas and exact inverses; a transaction envelope with label, actor and base version; undo and redo.
- [ ] **Model completeness for `.aseprite`.** Tilesets and tilemap layers, grayscale colour mode, per-frame palettes.
- [x] **Blob store.** Content-addressed pixel blobs (SHA-256 keys), region pixel patches, local cache in IndexedDB.
- [x] **Native format.** `.kpixel` zip of a versioned JSON manifest plus blobs, with a [published schema](schemas/kpixel-file-v1.schema.json) and document migrations.
- [x] **`.aseprite` codec.** Clean-room reader and writer from the public spec, preserving extension data and the Aseprite settings kpixel doesn't model yet.
- [x] **Conformance corpus.** Files made by Aseprite that must open, save and reopen losslessly, checked against Aseprite itself; fuzzing for the codec.
- [x] **PNG import and export.** Open any PNG (indexed ones keep their palette), export frames as PNG, and a frame compositor with all 19 blend modes.
- [x] **Provenance fields.** Origin on every cel image and actor on every transaction, even before any AI exists.
- [ ] **Server skeleton.** Custom server entry, a single-user `DocumentRoom` Durable Object that stores a versioned op log, R2 for blobs, and save and load through it.

**Must make solid:** stable IDs, op versioning and migrations, property-based tests for invariants and undo.

**Done when:** open → save → reopen in Aseprite is lossless on the corpus, and every op undoes exactly.

## Phase 1 — Editor MVP

**Goal:** an Aseprite user can make and animate a small sprite entirely in kpixel.

- [ ] **Canvas and renderer.** Pixel-exact zoom and pan; compositing with blend modes, onion skin, and indexed layers drawn through a palette lookup.
- [ ] **Tool architecture.** Composable controller × joiner × point shape × ink, so new tools are combinations of parts.
- [ ] **Core tools.** Pixel-perfect pencil, eraser, fill, line and shapes, eyedropper.
- [ ] **Selection and move.**
- [ ] **Layers.** Image layers and groups, visibility, lock, opacity, blend mode, reference layers.
- [ ] **Timeline.** Frames with durations, linked cels, tags with loop direction, onion skin, playback.
- [ ] **Palettes.** Palette panel, indexed mode, Lospec and `.gpl`/`.hex` import.
- [ ] **Export.** PNG sheet plus Aseprite-style JSON (hash and array), GIF.
- [ ] **Keyboard-first.** Aseprite-like shortcuts.
- [ ] **Projects and accounts (minimal).** Sign-in, a project list, cloud save through `DocumentRoom`.

**Must make solid:** rendering performance and input latency, undo granularity that feels right (one gesture, one step).

**Done when:** an Aseprite user can redo a small walk cycle with no blockers.

## Phase 2 — Pixel pipeline

**Goal:** turn any AI image, or messy art, into palette-locked, grid-true pixels, and ship the deterministic assists that artists welcome.

- [ ] **Cleanup pipeline.** WASM (unfake-core) in a Web Worker and on the server: normalize, background and alpha, grid detection, mode-vote resample, palette lock, cleanup.
- [ ] **Import and fix.** Paste any image, preview the diff, accept it into a layer as one transaction.
- [ ] **Sprite contracts.** Size, anchor or feet line, colour count and margins as document properties, with validators.
- [ ] **Multi-frame registration.** Shared grid and palette across frames; anchor alignment.
- [ ] **Deterministic assists.** Outline, palette swap, RotSprite or cleanEdge rotation, dither.
- [ ] **Tilemaps.** Tilemap layers and a basic tileset panel.
- [ ] **"No generative AI" mode.** Enforced at the command API, not just the UI.

**Must make solid:** determinism and reproducibility (pipeline parameters stored in provenance), diff and preview UX, the indexed-colour workflow.

**Done when:** pasting a GPT Image or Nano Banana sprite gives a palette-locked, grid-true, contract-valid layer in under 10 seconds.

## Phase 3 — AI generation

**Goal:** generate inside the editor, with results that arrive as proposals you can edit, at a cost you see up front.

- [ ] **Provider layer.** Model calls through AI Gateway (Workers AI FLUX.2, gpt-image, Retro Diffusion API), swappable per task.
- [ ] **Generation jobs.** One Workflows instance per job: quote, reserve credits, call the model, clean up, write to R2, notify the document, settle or refund.
- [ ] **Credit ledger.** Quotes before spending; reservations and refunds.
- [ ] **Generation dock and candidate tray.** Prompt, references, mask and constraints in the editor; variations as candidates; accept is one transaction.
- [ ] **Masked inpainting** with palette lock.
- [ ] **Characters.** A canonical sprite with palette, references and contract; 4- and 8-direction rotations; animation cycles per direction; a contact-sheet review.
- [ ] **Tilesets.** Generated textures assembled into Wang or blob sets by deterministic code, with seam checks.

**Must make solid:** job reliability and idempotency, cost transparency, no lock-in to one provider, provenance for every generated pixel.

**Done when:** a character goes from prompt to 4-direction idle and walk, cleaned and exported, with costs shown up front.

## Phase 4 — Agents and collaboration

**Goal:** people and agents work in the same document, through the same command API.

- [ ] **Agent harness.** Pi on a per-conversation Durable Object with a kpixel extension of read and write tools (see [AI agent harness](ai-agent-harness.md)).
- [ ] **Agent perception.** Rendered frames as images plus a structured document summary.
- [ ] **Pending changesets.** Agent edits held for a human to accept or reject.
- [ ] **In-app assistant.**
- [ ] **MCP server and REST API** over the command API and a project asset spec, with token-light responses (URLs, not base64).
- [ ] **Multiplayer.** Live editing through `DocumentRoom`, presence, per-actor undo.
- [ ] **Team features.** Roles, comments, suggestion mode, named versions.
- [ ] **Engine exports.** Tiled, Godot and GameMaker presets.
- [ ] **Disclosure export.** Provenance summaries mapped to Steam and itch.io categories.

**Must make solid:** permissions and op validation in the Durable Object, async patterns that survive agent timeouts, per-actor undo.

**Done when:** a coding agent batch-produces a character set into a project, and a human fixes it and exports it into a game repo.

## Later

Ideas we expect to pick up once the base is proven. Not ordered.

- Audio tracks for lip-sync
- Mask layers
- Animated tiles and linked tile instances with flips and rotations
- Isometric and perspective helpers
- LDtk export
- Normal maps and lighting
- C2PA content credentials on export
- Offline PWA
- iPad and pencil input
- Timelapse export as proof of authorship
- Importers for `.pxo`, `.piskel`, `.pyxel` and `.psd`

## Open decisions

Questions that could reshape the phases above. Resolve them with a changelog entry.

- **Pricing model.** One-time or free editor with transparent pay-per-generation, bring-your-own-key, or subscription tiers.
- **Character document structure.** Directions as layer groups in one document, or one document per direction. Prototype against Unity, Godot and Phaser imports during Phases 1–2.
- **Default agent model.** Leaning towards Claude through AI Gateway, with a Workers AI fallback.
- **When the agent arrives.** The in-app assistant may be worth pulling earlier than Phase 4 once the command API exists.
- **Auth provider** for Phase 1 accounts.
- **Our own pixel model.** Deferred until Phase 3 shows where providers fail; consented data only.

## Updating this roadmap

- Tick milestones and update phase statuses in the same commit as the work.
- Change phases freely when plans change: add, remove, reorder or move items to **Later**. Record the reason in a changelog entry.
- Keep milestones as outcomes, one line each. Implementation detail belongs in design docs, not here.
- Update **Last updated** and **Current focus** at the top whenever you edit.
