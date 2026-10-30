import { createFileRoute } from "@tanstack/react-router";

import { createDocument, encodeDocument } from "@/document";
import { documentRoom, isDocumentId } from "@/rooms/document-rooms";

// POST /api/documents creates a document. The body is either a full document in the wire
// format ({ "document": … }) or optional settings for a blank one
// ({ "width": 32, "height": 32, "colorMode": "rgba" }).
//
// No authentication yet: don't deploy these endpoints publicly before accounts exist.
export const Route = createFileRoute("/api/documents/")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readJson(request);
        if (body === undefined) {
          return Response.json({ error: "The body must be a JSON object" }, { status: 400 });
        }
        const encoded =
          "document" in body
            ? body.document
            : encodeDocument(
                createDocument({
                  width: typeof body.width === "number" ? body.width : 32,
                  height: typeof body.height === "number" ? body.height : 32,
                  colorMode: body.colorMode === "indexed" ? "indexed" : "rgba",
                }),
              );
        const documentId = idOf(encoded);
        if (!documentId) {
          return Response.json({ error: "The document needs a UUID id" }, { status: 400 });
        }

        const result = await documentRoom(documentId).create(encoded);
        switch (result.status) {
          case "created":
            return Response.json({ documentId, version: result.version }, { status: 201 });
          case "exists":
            return Response.json(
              { error: "A document with this id already exists" },
              { status: 409 },
            );
          case "rejected":
          default:
            return Response.json({ error: result.reason }, { status: 400 });
        }
      },
    },
  },
});

async function readJson(request: Request): Promise<Record<string, unknown> | undefined> {
  const text = await request.text();
  if (text.trim() === "") return {};
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value))
      : undefined;
  } catch {
    return undefined;
  }
}

function idOf(encoded: unknown): string | undefined {
  if (typeof encoded !== "object" || encoded === null) return undefined;
  const id: unknown = Reflect.get(encoded, "id");
  return typeof id === "string" && isDocumentId(id) ? id : undefined;
}
