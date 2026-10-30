import { createFileRoute } from "@tanstack/react-router";

import { documentRoom, isDocumentId } from "@/rooms/document-rooms";

// GET /api/documents/:documentId returns { document, version }, with the document in the wire
// format (pixels as base64).
export const Route = createFileRoute("/api/documents/$documentId/")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!isDocumentId(params.documentId)) {
          return Response.json({ error: "Not found" }, { status: 404 });
        }
        const current = await documentRoom(params.documentId).load();
        return current === undefined
          ? Response.json({ error: "Not found" }, { status: 404 })
          : new Response(current, { headers: { "content-type": "application/json" } });
      },
    },
  },
});
