# PNG import and export

kpixel can now open PNGs as documents and export frames as PNGs, built on a new frame compositor that the editor, thumbnails and agent screenshots will reuse. Details are in [document model](../design/document-model.md#rendering-and-png).

## Changes

- `renderFrame`: flattens a frame with visibility, layer and cel opacity, z-index, isolated groups, indexed palettes and all 19 blend modes.
- `decodePng` and `importPng`: every PNG colour type and bit depth; indexed PNGs open as indexed documents with their exact palette and indexes, trimmed to their content.
- `exportFramePng`: indexed PNGs (with transparency) for indexed documents when the colours allow, RGBA otherwise, with optional nearest-neighbour upscaling.

## Decisions

- **fast-png** for decoding and plain encoding: MIT, pure JavaScript on fflate, which we already use. It doesn't write palette transparency, so we add the `tRNS` chunk ourselves. It also rejects RGB images under 3 pixels that have a `tRNS` chunk; that's documented and rare enough to leave for now.
- **Blend modes follow the W3C spec** rather than Aseprite's integer arithmetic, so results can differ from Aseprite by rounding. Revisit if `.aseprite` round-trips need pixel-identical renders.
- **Groups composite in isolation**, so a group's opacity and blend mode apply to its flattened result.

## Verification

Beyond the unit and property tests, exported PNGs were cross-checked against two independent decoders: Chromium decoded 60 exported files (23 indexed with transparency, 37 RGBA) to exactly the rendered pixels, and macOS ImageIO read the test PNGs and exports with the expected bit depths and alpha.

## Next

- The clean-room `.aseprite` reader and writer, with a conformance corpus.
