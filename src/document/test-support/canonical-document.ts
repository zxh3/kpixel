import type { SpriteDocument } from "../schema";

/**
 * Renames every id in a document to a stable name derived from structure (frame 0, layer 2,
 * cel 2/0, …), so documents can be compared after a trip through a format that doesn't store
 * kpixel's ids, such as .aseprite.
 */
export function canonicalDocument(document: SpriteDocument): SpriteDocument {
  const frameName = new Map(document.frames.map((frame, index) => [frame.id, `frame ${index}`]));
  const layerName = new Map<string, string>();
  const visit = (layerIds: readonly string[]) => {
    for (const layerId of layerIds) {
      layerName.set(layerId, `layer ${layerName.size}`);
      const layer = document.layers[layerId]!;
      if (layer.kind === "group") visit(layer.childIds);
    }
  };
  visit(document.rootLayerIds);

  const cels = Object.values(document.cels).toSorted((a, b) =>
    `${layerName.get(a.layerId)}/${frameName.get(a.frameId)}`.localeCompare(
      `${layerName.get(b.layerId)}/${frameName.get(b.frameId)}`,
    ),
  );
  const celName = (cel: (typeof cels)[number]) =>
    `cel ${layerName.get(cel.layerId)}/${frameName.get(cel.frameId)}`;
  const celDataName = new Map<string, string>();
  for (const cel of cels.toSorted(
    (a, b) =>
      document.frames.findIndex((f) => f.id === a.frameId) -
      document.frames.findIndex((f) => f.id === b.frameId),
  )) {
    if (!celDataName.has(cel.celDataId)) celDataName.set(cel.celDataId, `data of ${celName(cel)}`);
  }

  return {
    ...document,
    id: "document",
    frames: document.frames.map((frame) => ({ ...frame, id: rename(frameName, frame.id) })),
    layers: Object.fromEntries(
      Object.values(document.layers).map((layer) => {
        const id = rename(layerName, layer.id);
        const renamed =
          layer.kind === "group"
            ? {
                ...layer,
                id,
                childIds: layer.childIds.map((childId) => rename(layerName, childId)),
              }
            : { ...layer, id };
        return [id, renamed];
      }),
    ),
    rootLayerIds: document.rootLayerIds.map((id) => rename(layerName, id)),
    cels: Object.fromEntries(
      cels.map((cel) => [
        celName(cel),
        {
          ...cel,
          id: celName(cel),
          layerId: rename(layerName, cel.layerId),
          frameId: rename(frameName, cel.frameId),
          celDataId: rename(celDataName, cel.celDataId),
        },
      ]),
    ),
    celData: Object.fromEntries(
      Object.values(document.celData).map((data) => [
        rename(celDataName, data.id),
        { ...data, id: rename(celDataName, data.id) },
      ]),
    ),
    tags: document.tags.map((tag, index) => ({
      ...tag,
      id: `tag ${index}`,
      fromFrameId: rename(frameName, tag.fromFrameId),
      toFrameId: rename(frameName, tag.toFrameId),
    })),
    slices: document.slices.map((slice, index) => ({
      ...slice,
      id: `slice ${index}`,
      keys: slice.keys.map((key) => ({ ...key, frameId: rename(frameName, key.frameId) })),
    })),
  };
}

function rename(names: Map<string, string>, id: string): string {
  return names.get(id) ?? id;
}
