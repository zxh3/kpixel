# AI agent harness

Chose Pi, run durably in Durable Objects through Cloudflare's `PiHarness`, as kpixel's agent harness. Documented in [ai-agent-harness.md](../ai-agent-harness.md); not bootstrapped yet.

## Decisions

- One agent Durable Object per conversation, separate from the document's `DocumentRoom` object.
- The agent edits only through typed tools over the command API. Its writes land as pending changesets, which also stands in for Pi's missing tool-approval step.
- Models go through AI Gateway (Workers AI plus Anthropic and OpenAI catalog models), so the Worker holds no provider keys.
- Image generation stays in Workflows jobs; the agent starts and tracks them rather than running them in its loop.

## Next

- Bootstrap alongside the document `DocumentRoom` work: add the `ai` binding, the agent Durable Object, and a custom server entry.
- Verify that tools can return images, so the agent can see rendered pixels.
