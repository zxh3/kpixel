// The Worker's entry point: TanStack Start handles HTTP, and the Durable Object classes the
// Worker hosts are exported here so Cloudflare can find them.
import handler from "@tanstack/react-start/server-entry";

export { DocumentRoom } from "@/rooms/document-room";

export default {
  // Workers call fetch(request, env, ctx), but TanStack's second parameter is its own request
  // options, so pass only the request. Bindings are read from "cloudflare:workers" instead.
  fetch: (request) => handler.fetch(request),
} satisfies ExportedHandler<Env>;
