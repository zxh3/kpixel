# AI agent harness

**Status:** decided, not yet bootstrapped (2026-10-29).

kpixel's agent runs on [Pi](https://pi.dev/) through Cloudflare's [Pi harness](https://developers.cloudflare.com/agents/harnesses/pi/). Pi is a minimal, extensible agent harness: it owns the agent loop (transcript, inbox of follow-ups and steers, model calls, tool calls, retries, crash recovery). **Pi Durable** runs that loop inside a Durable Object, and **`PiHarness`** from the Agents SDK (`agents/harness/pi`) wires it into the object's [Lifecycle](https://developers.cloudflare.com/agents/runtime/lifecycle/) so work survives eviction and restarts.

## Why Pi

- **It fits the architecture we already chose.** [Product research](product-research.md) puts each document in a Durable Object and routes every change, human or agent, through one typed command API. Pi runs in a Durable Object too, stores its state in that object's SQLite (`pi_*` tables), and calls our code only through typed tools.
- **Durable by default.** A Lifecycle job keeps a heartbeat while Pi works; if the object is evicted mid-run, an alarm restarts it and Pi continues. Long agent tasks, such as producing a full character set, don't depend on a client staying connected.
- **Models through AI Gateway.** `agents/models/pi-ai` serves Workers AI models (`@cf/...`), AI Gateway dynamic routes (`dynamic/<route>`) and catalog models such as `anthropic/claude-opus-5.5` and `openai/gpt-5.4`. The gateway holds provider credentials (Unified Billing or BYOK), so the Worker holds no provider keys, and fallbacks, caching, retries and cost analytics come with it. This matches principle 8 of the research: model-agnostic behind AI Gateway.
- **Minimal and extensible.** Tools and prompt sections are plain extension objects; skills are supported. We stay in control of the loop's inputs instead of adopting a heavyweight framework.

## How it maps onto kpixel

| Piece                    | Design                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agent object**         | One Durable Object per conversation (Pi picks session ids itself, so per-user or per-chat isolation comes from the object, not the session). It is separate from the document's `DocumentRoom` object, so agent state and document state scale and fail independently.                                                        |
| **Tools**                | One kpixel extension exposes the command API as typed tools (TypeBox schemas from `@earendil-works/pi-ai`): read tools (document summary, render a frame or region to PNG, list palettes, validate a sprite contract) and write tools (submit a transaction, start a generation job, run the cleanup pipeline).               |
| **Writes**               | Write tools call `DocumentRoom` over RPC and submit transactions with `actor.kind = "agent"`. They land as pending changesets that a human accepts or rejects, which is also how we cover Pi's missing tool-approval step.                                                                                                    |
| **Replay safety**        | Pi reruns `replay: "safe"` tools after an interruption and gives the model an "interrupted" result for the rest. Read tools are safe. Write tools carry a client-generated transaction id that `DocumentRoom` deduplicates, which makes them safe too. Starting a generation job uses an idempotency key for the same reason. |
| **Image generation**     | Not inside the agent loop. The agent starts a Workflows job (quote, reserve, call the image model through AI Gateway, clean up, write to R2) and is told when it finishes. Pi only orchestrates.                                                                                                                              |
| **Context**              | Prompt sections render before each model request, so a section can inject a fresh summary of the active document, selection, palette and sprite contract.                                                                                                                                                                     |
| **Streaming to the app** | `session.events()` yields a snapshot and then live event batches. The app connects over WebSocket; on reconnect it gets a fresh snapshot (streams can't resume from a cursor).                                                                                                                                                |
| **External agents**      | Coding agents reach kpixel through our MCP server and REST API, which call the same command API. Pi is the in-app agent and the engine for long agent tasks, not the only way in.                                                                                                                                             |

## Setup when we bootstrap

```bash
pnpm add agents @earendil-works/pi-durable @earendil-works/pi-ai @earendil-works/chord
```

The Pi packages are optional peer dependencies of `agents`, which supports one Pi minor version per release (Pi `~1.4` from `agents` 0.30.0). Pin them together and upgrade them together.

`wrangler.jsonc` gains an `ai` binding and a SQLite-backed Durable Object class with a migration:

```jsonc
{
  "ai": { "binding": "AI" },
  "durable_objects": {
    "bindings": [{ "name": "AGENT", "class_name": "Agent" }],
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Agent"] }],
}
```

Durable Object classes are exported from the custom Worker entry, `src/server.ts`, which already exists for `DocumentRoom`; add the agent class there. Run `pnpm cf-typegen` afterwards.

Shape of the agent object, following Cloudflare's example:

```ts
export class Agent extends DurableObject<Env> {
  ai = createAI({ binding: this.env.AI });
  registry = createRegistry(); // per object, never module scope

  harness = new PiHarness({
    harness: ({ storage, context, onWake }) => {
      this.registry.install(kpixelExtension); // tools + sections; install is idempotent
      const models = createModels();
      models.setProvider(this.ai.provider);
      return Harness.open(storage, { models, registry: this.registry, onWake }, context);
    },
    defaults: { model: this.ai("anthropic/claude-opus-5.5") },
  });

  lifecycle = Lifecycle.install(this).use(this.harness);
}
```

The `harness` factory can run more than once (startup and reopen after a storage error), so it must be idempotent.

## Constraints to design around

- **Experimental.** Pi Durable's API can change in minor releases. Keep Pi behind a thin internal module so the rest of kpixel depends on our tool and event types, not Pi's.
- **No built-in tool approval.** Covered by pending changesets at the document level.
- **No stream cursor.** Clients always resync from a snapshot after a disconnect or restart.
- **Abort waits for tools.** `session.abort()` waits until running tools return, so every tool must honor `context.abortSignal`.
- **Time limits.** A single model request streaming past 15 minutes can be cut off; the harness hands off every 10 minutes; background tasks may be noticed up to 30 s late.
- **Conversations can't be deleted yet.** Before launch we need a deletion story (for example, deleting the whole conversation object), because users will expect to remove their history.
- **Provider routing gaps.** Google (`google-generative-ai`, `google-vertex`) and several other APIs can't be routed through the provider today. Plan on Anthropic, OpenAI and Workers AI models. Per-model options set with `ai(model, options)` don't reach sessions; set them on `createAI`.
- **Tool results beyond text are undocumented.** The docs only show text results. Our agent needs to see rendered pixels, so verify image results (or another way to give the model a PNG) before relying on it.

## Open questions

- **Default model.** Recommendation: a Claude model through AI Gateway for the in-app agent, for its vision and tool use, with a Workers AI model as fallback for cheap tasks. Decide after testing on real editing tasks.
- **Billing.** AI Gateway Unified Billing versus our own keys (BYOK), and how agent token costs feed the same credit ledger as image generation.
- **Skills.** Whether to ship kpixel workflows (character pipeline, tileset assembly) as Pi skills from R2, so the in-app agent and external agents share them.

## References

- [Pi harness](https://developers.cloudflare.com/agents/harnesses/pi/) and [extensions](https://developers.cloudflare.com/agents/harnesses/pi/extensions/)
- [Pi AI model provider](https://developers.cloudflare.com/agents/models/pi-ai/)
- [Lifecycle](https://developers.cloudflare.com/agents/runtime/lifecycle/)
- [Pi harness example app](https://github.com/cloudflare/agents/tree/main/examples/next/harnesses/pi)
- [Pi Durable announcement](https://earendil.com/posts/pi-durable/) and [pi.dev](https://pi.dev/)
