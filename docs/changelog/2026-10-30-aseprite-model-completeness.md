# `.aseprite` model completeness

The document model now covers everything an `.aseprite` file holds: tilesets and tilemap layers, grayscale and per-frame palettes. Aseprite files now open without conversion (apart from tilesets stored only in an external file), which completes Phase 0. Details are in [document model](../design/document-model.md).

## Changes

- Document schema version 2, with a migration from version 1 and a real version 1 file as a test fixture. The [published schema](../schemas/kpixel-file-v1.schema.json) is regenerated.
- Grayscale colour mode (`graya8` images), rendered and exported as grey-and-alpha PNGs.
- Palette changes on later frames, with `setFramePalette` and `paletteAt`; rendering and PNG export use the palette in force at each frame.
- Tilesets and tilemap layers: `tile32` cels with flips, and operations to add, change and remove tilesets and tiles, each with an exact inverse.
- The `.aseprite` reader and writer carry all of these over exactly, including tileset and tile user data, instead of warning or rejecting.
- The corpus gains a tilemap with every flip combination and tile user data, and a translucent grayscale layer. Corpus renders now come from Aseprite's RGB render.

## Verification

- All 10 corpus sprites open with no warnings, render like Aseprite and round-trip unchanged; the tilemap's flips match Aseprite's render.
- Against a real Aseprite, 150 random documents in all three colour modes, half with tilemaps, survived Aseprite opening and re-saving them, and Aseprite rendered 60 within 2 levels of kpixel.

## Decisions

- **Tile 0 is always empty, and tiles change only at the end of a tileset.** References never need renumbering, so tile operations stay small and exactly invertible. Tile 0 may only be refilled with transparency, such as when the transparent index changes.
- **Preconditions never refuse what a transaction may pass through.** Tile references are checked only at the end of a transaction, so `removeLastTile` doesn't refuse tiles still in use; the invariants do. The property tests found the undo failure the stricter check caused.
- **One flip layout for kpixel.** Files with 8- or 16-bit tile references, or other flip masks, are converted to `tile32` on read and written back as 32-bit references.
- **kpixel always applies cel and layer opacity.** Aseprite ignores them when it saves an indexed sprite as PNG, because an indexed PNG can't hold partial alpha. kpixel matches what Aseprite shows on screen instead.
- **Aseprite quirks are accepted, not fought.** When a palette shrinks on a later frame, Aseprite writes stale entries past the new size; the reader ignores them rather than rejecting the file.

## Next

- Phase 1: the editor, starting with the canvas, renderer and tool architecture.
