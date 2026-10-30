# Product research

Surveyed PixelLab, Ludo.ai, Aseprite and their peers, and set kpixel's direction: an editor-first, browser-native pixel studio where AI acts as constrained, attributable commands on an Aseprite-compatible document. Full write-up in [product-research.md](../product-research.md).

## Decisions

- Editor first. AI output lands as editable, grid-true, palette-locked proposals, never silent overwrites.
- Humans and agents edit through one typed command API with transactional undo.
- Every pixel carries provenance, which powers Steam and itch.io disclosure and a "No generative AI" mode.
- `.aseprite` support is written clean-room from the public spec; Aseprite's EULA rules out reusing its code.
- PixelLab is not a backend option, because its terms bar competing services. Providers sit behind AI Gateway.

## Next

- Phase 0: document model, command and transaction log, content-addressed blobs, provenance fields and `.aseprite` I/O.
