import { env } from "cloudflare:workers";

// Server-only access to DocumentRoom Durable Objects. Import this only from server routes and
// server functions, which never run in the browser.

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Document ids are UUIDs; anything else is rejected before reaching a Durable Object. */
export function isDocumentId(value: string): boolean {
  return uuidPattern.test(value);
}

/** The Durable Object that owns a document. */
export function documentRoom(documentId: string) {
  return env.DOCUMENT_ROOM.getByName(documentId);
}
