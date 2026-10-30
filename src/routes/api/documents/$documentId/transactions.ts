import { createFileRoute } from "@tanstack/react-router";

import { documentRoom, isDocumentId } from "@/rooms/document-rooms";

// GET  /api/documents/:documentId/transactions?since=N  returns { transactions } applied after
//      version N, oldest first, for clients catching up.
// POST /api/documents/:documentId/transactions  commits one transaction in the wire format:
//      200 { version } when applied (or already applied: retries are safe),
//      409 { version } when built on an old version, 400 { error } when it doesn't apply.
export const Route = createFileRoute("/api/documents/$documentId/transactions")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        if (!isDocumentId(params.documentId)) {
          return Response.json({ error: "Not found" }, { status: 404 });
        }
        const since = Number(new URL(request.url).searchParams.get("since") ?? 0);
        if (!Number.isInteger(since) || since < 0) {
          return Response.json({ error: "since must be a non-negative integer" }, { status: 400 });
        }
        const transactions = await documentRoom(params.documentId).transactionsSince(since);
        return new Response(transactions, { headers: { "content-type": "application/json" } });
      },
      POST: async ({ params, request }) => {
        if (!isDocumentId(params.documentId)) {
          return Response.json({ error: "Not found" }, { status: 404 });
        }
        let transaction: unknown;
        try {
          transaction = await request.json();
        } catch {
          return Response.json({ error: "The body must be JSON" }, { status: 400 });
        }
        const result = await documentRoom(params.documentId).commit(transaction);
        switch (result.status) {
          case "committed":
            return Response.json({ version: result.version });
          case "conflict":
            return Response.json(
              { error: "The document has changed", version: result.version },
              { status: 409 },
            );
          case "rejected":
          default:
            return Response.json(
              { error: result.reason },
              { status: result.reason === "the document doesn't exist" ? 404 : 400 },
            );
        }
      },
    },
  },
});
