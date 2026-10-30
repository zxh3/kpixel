# `.aseprite` reader and writer

kpixel now opens and saves Aseprite files, written clean-room from Aseprite's published file spec and checked against Aseprite itself. Details are in [document model](../design/document-model.md#aseprite-files).

## Changes

- `readAseprite` and `writeAseprite`, built in three layers: checked binary primitives, a typed chunk structure, and the mapping to documents.
- Typed user-data properties for the user and for extensions, as natural JSON with `$type` wrappers only where needed.
- Aseprite settings kpixel doesn't model yet are kept under `kpixel/aseprite` and written back. Grayscale opens as RGBA with a warning, and tilemaps are rejected.
- Provenance travels inside `.aseprite` files as an extension property with a pixel checksum, so it survives Aseprite, and pixels edited there keep AI involvement visible.
- A conformance corpus built by Aseprite 1.3.18 (`make-corpus.lua`), with Aseprite's own renders, plus a compatibility suite that runs against a local Aseprite.
- Slice keys may now have zero width or height, which is how Aseprite hides a slice on a frame.

## Verification

- All 9 corpus sprites open, render like Aseprite (exactly, or within 2 levels for translucent compositing), and round-trip unchanged.
- Against a real Aseprite, all 8 supported corpus files rewritten by kpixel describe and render identically to the originals; 30 random kpixel documents survive Aseprite opening and re-saving them; and Aseprite renders kpixel's files within 2 levels of kpixel.
- Fuzzing with up to 50,000 corrupted and truncated files found an out-of-memory crash from trusted counts and zlib bombs. It's fixed with checked reads, bounded inflation and a pixel budget; every damaged file now opens or fails with `FileFormatError`.

## Decisions

- **Clean-room only.** Aseprite's source is under a proprietary EULA, so the codec uses the spec and Aseprite's output, never its code. AGENTS.md now says so.
- **Keep what isn't modelled yet, rather than drop it.** Settings ride along in a reserved namespace until the model grows to cover them.
- **Translucent compositing is not bit-identical** with Aseprite; matching would mean copying its arithmetic.

## Next

- Model completeness for `.aseprite`: tilemaps and tilesets, grayscale and per-frame palettes.
- The server skeleton: the `DocumentRoom` Durable Object with a versioned op log.
