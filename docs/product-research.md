# Product research

**Summary (2026-10-29).** In late 2026 the pixel art tool market splits in two. AI generators ship without real editors: PixelLab borrows open-source Pixelorama and an Aseprite plugin, and Ludo.ai, Retro Diffusion's website and the rest are generate-and-export apps. Real editors ship without AI: Aseprite's team is reportedly opposed to generative AI, and Pixelorama, Pixie and the iPad apps have none built in. So every AI workflow ends with a manual cleanup round-trip, usually in Aseprite. One 2026 review summed PixelLab up as "80% of a sprite set in minutes. The last 20% is fixing the frames" ([Techsy](https://techsy.io/en/blog/meshy-vs-higgsfield-vs-pixellab)). At the same time, MCP servers and APIs have become standard among AI asset vendors, so agent access alone no longer sets a product apart. ksprite should therefore be editor-first. AI output arrives as grid-true, palette-locked, editable layers with a recorded origin, inside a document that round-trips with Aseprite. People and coding agents drive that document through the same typed command API. Sentiment toward generative AI is at a record low, especially among artists: 52% of developers say it harms the industry, and 64% of visual artists do ([GDC 2026](https://gdconf.com/article/gdc-2026-state-of-the-game-industry-reveals-impact-of-layoffs-generative-ai-and-more/)). That makes three things product requirements rather than marketing: deterministic assists, per-pixel provenance and a "no generative AI" project mode. The build order follows from this. First comes the foundation: an Aseprite-shaped document model with stable IDs everywhere, a command/transaction log, a deterministic cleanup pipeline, provenance, and clean-room `.aseprite` I/O. Next comes an editor good enough to finish the last 20%. Generation follows, run through AI Gateway and Workflows. Last come MCP, API and Durable Object-backed collaboration.

> **How to read the confidence markers.** _(vendor)_ means a vendor or a direct competitor wrote the source; the comparison pages from Ludo, SpriteCook and LlamaGen are the main examples. _(third-party, unverified)_ means a directory, blog or SEO review that was not checked against the vendor's own pages. _(background)_ means the researcher's prior knowledge, which was not re-checked this session. _(conflicting)_ means sources disagree. Unmarked claims were seen in the cited source on or around 2026-10-29. Reddit could not be reached during the research, so first-hand community sentiment is thinner than usual.

## The landscape splits into generators without editors and editors without AI

### PixelLab leads on animated characters but sends editing to borrowed tools

PixelLab is the most complete AI pixel product. Its catalog has grown to about 50 specialized generators, each with its own size cap, usually 64–512 px. They cover text-to-image (PixFlux up to 400×400, Pixen up to 512×512, BitForge for style reference), 4- and 8-direction characters, objects, animation, inpainting, tilesets (top-down Wang, sidescroller, isometric, hex, path and building kits), UI, fonts, portraits, lip-sync, normal maps and, since 2026-10-14, a VFX Creator that times effects to the user's own animated sprite ([PixelLab API](https://www.pixellab.ai/pixellab-api); [PixelLab MCP docs](https://api.pixellab.ai/mcp/docs); [PixelLab on X](https://x.com/PixelLabAI/status/2110291625050071449)).

**Characters and objects are persistent server-side entities.** They have rotations, "states" (outfits and variants), tags and animation groups, and this persistence is the backbone of PixelLab's consistency story. Its MCP character tool has no seed; consistency comes from a style character or a reference image ([MCP docs](https://api.pixellab.ai/mcp/docs)). Animation comes in four families:

- about 49 humanoid template animations
- Skeleton-v3, at 3–15 frames up to 256 px for $0.04–$0.06
- animate-with-text v3
- PixMiniMax, which is explicitly "powered by MiniMax H3", a third-party video model, at 4–40 frames ([PixelLab API](https://www.pixellab.ai/pixellab-api))

PixelLab reaches users through seven surfaces:

- a Simple Creator
- a Characters page
- a Map Workshop
- an in-browser editor "built on the free, open-source Pixelorama" (desktop only)
- an Aseprite extension
- a REST API with Python and JS SDKs
- a remote MCP server ([Ways to use PixelLab](https://www.pixellab.ai/docs/ways-to-use-pixellab))

The MCP server is now a full agent platform. It has async job IDs, `confirm_cost` gating, a chat agent and a cloud sandbox. Its Game Builder writes Phaser 4 games and hosts them at pixellab.run ([PixelLab MCP](https://www.pixellab.ai/mcp); [AI Game Builder](https://www.pixellab.ai/ai-game-builder)).

**Pricing** is a monthly subscription: a 40-generation free trial, then about $12, $24 and $50 per month. These tier numbers come from third parties and disagree with each other on size caps ([Cinevva](https://app.cinevva.com/guides/ai-pixel-art-generators) vs [GameDev AI Hub](https://gamedevaihub.com/retro-diffusion-vs-pixellab/)) _(third-party, conflicting)_. Pro tools consume 10–25 "generations" per call. The FAQ implies two quota currencies, generations and credits, on top of per-call USD API pricing ([MCP docs](https://api.pixellab.ai/mcp/docs); [FAQ](https://www.pixellab.ai/docs/faq)).

**Licensing.** Users own their outputs, may use them commercially, and may not train models on them. The terms reference Stable Diffusion's Open RAIL-M license, which hints that the original models are derived from Stable Diffusion. §2.2 restricts building a competing service on the API ([ToS](https://www.pixellab.ai/termsofservice)). That clause matters for us: **PixelLab is not a safe backend supplier for a competing studio.**

**What reviewers say.** They praise PixelLab's speed, its 8-direction rotation and its all-in-one pipeline. They complain about four things:

- Drift: "a belt buckle moves, a hairstyle shifts a pixel or two, a weapon changes thickness between frames" ([Techsy](https://techsy.io/en/blog/meshy-vs-higgsfield-vs-pixellab)).
- Credit burn on the best models.
- Slow large jobs: 256 px template animations "can take 30+ minutes per direction" ([MCP docs](https://api.pixellab.ai/mcp/docs)).
- A fragmented catalog of overlapping model generations (v1, v2 "Pro", v3, Pro Flash, PixMiniMax).

First-hand community data is thin. The Product Hunt page shows zero reviews ([Product Hunt](https://www.producthunt.com/products/pixellab)).

### Ludo.ai sells a whole AI game studio, with pixel art as one style among many

Ludo is a broad "AI game studio". It covers game ideation, design documents, images (20 asset types, 32 styles), 3D with auto-rigging, audio, video and, since October 2025, a Sprite Generator that animates any sprite from a text prompt, up to three keyframes, a reference video, or 641 motion presets ([Ludo pricing](https://ludo.ai/pricing); [App Developer Magazine](https://appdevelopermagazine.com/ludo.ai-debuts-sprite-generator-for-instant-2d-animation-creation/)).

**Pixel art is a model and export mode rather than the core.** A "Forge Pixel" model sits behind a "Pixel Art export mode", and only 5 of the 32 styles are pixel art. Directional Sprites renders up to 8 directions from an intermediate 3D model. Ludo offers no custom style training ([Ludo compare page](https://ludo.ai/compare/best-ai-sprite-generators)) _(vendor)_. One guide says Ludo has no tilesets ([Cinevva](https://app.cinevva.com/guides/ai-pixel-art-generators)).

**Surfaces.** The API and MCP beta launched on 2026-04-14 ([MCV UK](https://mcvuk.com/business-news/industry-news-ludo-ai-launches-api-and-mcp-beta-to-bring-ai-game-asset-creation-into-developer-workflows/)). Ludo also ships a CLI, which it says uses "far fewer tokens than MCP", and a Unity plugin. API results are kept for only 7 days, and MCP use consumes credits even on "unlimited" web plans ([Ludo: game assets in Claude](https://ludo.ai/tools/game-assets-in-claude)).

**Pricing** on annual billing is Indie at $15/mo (no API), Pro at $35/mo (API, MCP and CLI) and Studio at $300/mo (10 seats). Credits are spent per operation, for example 1.5–20 per sprite animation and 2–15 per AI "Edit Spritesheet" ([Ludo pricing](https://ludo.ai/pricing)). Ludo has **no manual pixel editor**. We found no independent user reviews of its sprite tools. Most comparison content about Ludo is written by Ludo.

### Retro Diffusion is the pixel-purist engine and the most plausible supplier

Retro Diffusion (Astropulse) is the generator that comparisons say "matches true pixel-art rules more closely" ([GameDev AI Hub](https://gamedevaihub.com/retro-diffusion-vs-pixellab/)). Its models are "trained at native resolutions of 256 × 256 pixels (or below)" ([Scenario help](https://help.scenario.com/articles/4202673551-retro-diffusion-models-the-essentials)).

**The API is a clean, usage-priced, async REST service:**

- Model tiers: RD Fast at $0.03/image, RD Plus at $0.06 and RD Pro at $0.18 (up to 9 reference images).
- Animation: walking, idle, jump, attack and custom actions from an input sprite at $0.14–$0.25; 8-direction `rotate` at $0.10.
- Tiles: Wang-style tilesets at $0.10, and `tile_x`/`tile_y` flags for seamless tiling.
- Constraints: an `input_palette` lock, and `remove_bg` for transparency.
- Utilities: Pixel Fixer for grid restoration at $0.002–$0.005.
- Operations: a free `check_cost` quote, idempotency keys, and automatic refunds for failed generations.
- Agent access: a hosted MCP with 33 typed tools.

All of the above is documented in [Retro-Diffusion/api-examples](https://github.com/Retro-Diffusion/api-examples). Scenario resells RD models, which makes RD the de facto "pixel engine" inside other platforms.

Its Aseprite extension runs locally on the user's GPU and costs $65 one-time ($20 for Lite). The website and the extension "are different tools, and use different models", which confuses buyers ([Gumroad](https://astropulse.gumroad.com/l/RetroDiffusion)). RD says its model was "trained on licensed assets from Astropulse and other pixel artists with their consent". That is the main training-data precedent in pixel art, but it is self-reported and unaudited ([itch.io](https://astropulse.itch.io/retrodiffusion)).

### The long tail converges on the same image-to-video-to-sheet pipeline

Most other generators turn a still character into motion with a video or motion model, then extract frames into a sprite sheet. Rotation comes either from a 3D intermediate or from a dedicated rotate model.

| Product         | Approach                                                                 | Notes                                                                                                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scenario**    | Studio pipelines built on custom style training                          | Pixelate post-process (grid presets, palette size, Remove Noise) and hosted RD models. $15–$75/mo, with enterprise SSO and SOC 2 ([Scenario pricing](https://www.scenario.com/pricing); [Scenario Pixelate](https://help.scenario.com/en/articles/pixelate)). |
| **Layer.ai**    | A "creative harness" over 130+ image models for on-brand marketing teams | Pixel art no longer appears on its homepage ([Layer.ai](https://www.layer.ai/)).                                                                                                                                                                              |
| **God Mode AI** | Action library and Spine auto-rigging                                    | $29/mo, all purchases final ([God Mode AI](https://www.godmodeai.co/)).                                                                                                                                                                                       |
| **AutoSprite**  | Animation-first video pipeline                                           | MCP, Unity import, $12–$29/mo ([AutoSprite](https://www.autosprite.io/)) _(third-party pricing)_.                                                                                                                                                             |
| **Sprite AI**   | The only generator with a built-in browser pixel editor                  | Editing costs no tokens. $8–$50/mo, a "full refund if not game-ready" guarantee, an Aseprite plugin and MCP ([Sprite AI](https://www.sprite-ai.art/)).                                                                                                        |
| **SpriteCook**  | MCP-first ("Your AI agent makes the sprites")                            | Ships a Pixel Grid Detector ([SpriteCook](https://www.spritecook.ai/blog/nanobanana-pixel-art-for-games)).                                                                                                                                                    |
| **Rosebud**     | Hobbyist game-maker tie-in                                               | Absorbed PixelVibe ([Rosebud](https://www.rosebud.ai/ai-game-assets)).                                                                                                                                                                                        |

The frontier general models are the free-ish baseline that everyone compares against. GPT Image 2 and the Nano Banana family produce "pixel-ish" ~1024² images "not snapped to a consistent grid", with sub-pixel noise, colour bleed and often fake checkerboard transparency ([SpriteCook blog](https://www.spritecook.ai/blog/nanobanana-pixel-art-for-games) _(vendor)_; [HN thread](https://hn-svelte.vercel.app/item/46058566)).

### Aseprite is the standard every AI workflow ends in

Aseprite v1.3.18.6 (2026-09-22, Lua API v41) costs **$19.99 one-time**. Its Steam rating is "Overwhelmingly Positive": 98% of 12,362 English reviews on the store page, and about 22.9k reviews at 99% across all languages on SteamDB ([Steam](https://store.steampowered.com/app/431730/Aseprite/); [SteamDB](https://steamdb.info/app/431730)). Third-party models estimate **1–2M owners and about 1.77M sales** ([SteamSpy](https://steamspy.com/app/431730); [VaporLens](https://vaporlens.app/app/431730/aseprite/stats/details)) _(estimates)_.

**Features.** It has 26 tools and 5 ink types, pixel-perfect freehand and symmetry. Layers come as image, group, tilemap and reference layers, with 19 blend modes. Animation uses per-frame durations, linked cels, and tags with four loop directions and a repeat count. Slices carry 9-patch and pivot data. Tilemaps have Manual, Auto and Stack modes. Color modes are RGBA, grayscale and indexed. It exports sprite sheets with JSON and has a rich CLI ([data/gui.xml](https://github.com/aseprite/aseprite/blob/main/data/gui.xml); [CLI docs](https://www.aseprite.org/docs/cli/)).

**Licensing.** Aseprite is **source-available, not open source**. The EULA allows compiling and modifying the source only "for your own personal purpose or to propose a contribution" ([EULA](https://github.com/aseprite/aseprite/blob/main/EULA.txt)). The file format spec, however, is published for third-party consumers ([ase-file-specs.md](https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md)).

**What users ask for.** The top GitHub requests by reactions are a tilemap editor, mask layers, isometric tools, audio for lip-sync, free distort, a better reference layer and APNG/PSD I/O ([GitHub issues](https://github.com/aseprite/aseprite/issues?q=is%3Aissue+is%3Aopen+sort%3Areactions-%2B1-desc)). Tilemap users complain that grid size is fixed at creation, that there are no animated tiles, and that tileset organization is weaker than Pyxel Edit's ([Aseprite community](https://community.aseprite.org/t/advanced-tileset-management/11741)).

**Stance on AI.** The team is reportedly "completely against AI 'art' trained without consent" _(secondhand; the original post could not be viewed)_ ([Scrapbox](https://scrapbox.io/kidaaam-92022284/Aseprite%20Diffusion)). AI therefore reaches Aseprite only as paid third-party Lua extensions: PixelLab, Retro Diffusion, Sprite AI and smaller ones ([itch.io extensions](https://itch.io/tools/top-sellers/tag-aseprite/tag-extension)).

**Structural gaps.** Aseprite has no web version and no collaboration.

### Other editors are stalled, native-only, or about to contest collaboration

- **Pixelorama** is the only active open-source editor that runs on the web. It is MIT-licensed and Godot-based _(license: background)_. It added tilemaps, indexed mode and audio layers in v1.1 (March 2025), 3D layers in v1.2, and **`.aseprite` export in v1.2.2 (September 2026)**. It has also broken its own `.pxo` format and extensions more than once ([Pixelorama blog](https://pixelorama.org/blog/); [v1.1 post](https://pixelorama.org/blog/pixelorama-1.1-is-out/)).
- **Pixie** is the most direct future competitor on collaboration, though it is still waitlist-only. It offers Aseprite keybindings, opens `.aseprite` files, and has real-time multiplayer, viewer/commenter/editor roles, a Suggest mode, named version history and an offline PWA. It lists no AI ([drawpixie.com](https://drawpixie.com/)).
- **Stalled tools:** Piskel ([Flathub](https://discourse.flathub.org/t/piskel-sprite-and-pixel-art-editor/2652)), LibreSprite (last release December 2023), the Lospec Pixel Editor (officially deprecated, [GitHub](https://github.com/lospec/pixel-editor)) and Pyxel Edit. Pyxel Edit's signature feature, tile references with flip and rotate transforms, is effectively orphaned ([pyxeledit.com](https://pyxeledit.com/features.php)).
- **Pro Motion NG** ($19) edits tiles in place inside the map ([cosmigo](https://cosmigo.com/pixel_animation_software)).
- **iPad apps:** Pixquare, Resprite and Pixaki. Pixquare is praised as "the closest you will get to Aseprite on iOS" and sells with "NO SUBSCRIPTION" ([App Store](https://apps.apple.com/us/app/id1659428179)).
- **PixiEditor 2.0** moved from pixel-only editing to a node-graph 2D editor ([alternativeto](https://alternativeto.net/news/2025/7/pixieditor-2-0-from-pixel-art-to-universal-2d-editing-with-new-features-and-tools/)).

**One-time pricing is the norm among editors.** Subscriptions appear only where AI compute justifies them.

### Comparison at a glance

| Product                                        | Category                        | AI capabilities                                                                                                | Real pixel editor                           | Surfaces / integrations                                       | Pricing                                                | Strengths                                                  | Complaints                                                         |
| ---------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| **PixelLab**                                   | Pixel AI platform               | ~50 generators; 4/8-dir persistent characters; template, skeleton, text and video animation; tilesets, UI, VFX | Borrowed (Pixelorama fork, Aseprite plugin) | Web, REST + SDKs, remote MCP, Game Builder                    | ~$12/$24/$50/mo _(third-party)_; API $0.008–$0.15/call | Animated-character leader, rotations                       | Frame drift, credit burn, slow 256 px jobs, fragmented catalog     |
| **Ludo.ai**                                    | All-in-one AI game studio       | Sprite animation (641 presets, video ref), 8-dir via 3D, 3D, audio, video, GDDs                                | No                                          | Web, API/MCP (Apr 2026), CLI, Unity                           | $15/$35/$300/mo annual                                 | Breadth, motion inputs                                     | Pixel is one style; no tilesets; no independent reviews            |
| **Retro Diffusion**                            | Pixel-native model + API        | Native ≤256 px models, palette lock, rotate, animation, Wang tiles, Pixel Fixer                                | Via Aseprite extension                      | REST v2, hosted MCP (33 tools), Aseprite, resold via Scenario | $0.03–$0.25 per call; $65/$20 extension                | Grid-true output, consent-trained claim, transparent costs | Website vs extension confusion; local GPU needed for the extension |
| **Scenario**                                   | Studio style-training platform  | Custom models, Pixelate, hosted RD                                                                             | No                                          | API, MCP, Unity/Unreal                                        | $15–$75/mo + enterprise                                | House-style consistency                                    | Not pixel-native                                                   |
| **God Mode / AutoSprite**                      | Animation-first                 | Image to action sprites via video pipelines; Spine (God Mode)                                                  | No                                          | API, MCP, Unity                                               | $12–$29/mo                                             | Fast action libraries                                      | Pixel fidelity undocumented                                        |
| **Sprite AI / SpriteCook**                     | Low-cost indie / agent-first    | Text-to-sprite, animation, grid detection                                                                      | Sprite AI: basic browser editor             | MCP, Aseprite plugin (Sprite AI)                              | $8–$50/mo                                              | Cheap, agent-friendly                                      | Editor depth unknown                                               |
| **Frontier models** (GPT Image 2, Nano Banana) | General image                   | Strong edits and multi-reference consistency                                                                   | No                                          | Everywhere, incl. Cloudflare `env.AI`                         | ~$0.03–$0.24/image                                     | Quality, consistency                                       | Off-grid "mixels", fake alpha, incoherent animation                |
| **Aseprite**                                   | Desktop pro editor              | None native (third-party extensions)                                                                           | Yes, reference standard                     | Lua extensions, CLI                                           | $19.99 one-time                                        | Precision, data model, ecosystem                           | Weak tilemaps, no audio or mask layers, no web or collab, anti-AI  |
| **Pixelorama**                                 | OSS editor (desktop + web)      | None native (PixelLab fork adds it)                                                                            | Yes                                         | Godot web export                                              | Free / Steam                                           | Open, tilemaps, `.aseprite` I/O                            | Format breakage, Godot web constraints                             |
| **Pixie**                                      | Collaborative editor (waitlist) | None stated                                                                                                    | Yes (claimed)                               | PWA, multiplayer                                              | Unknown                                                | Roles, suggest mode, history                               | Unlaunched                                                         |

## Users split by how they feel about AI

### Five segments want different things from the same canvas

The economy is large and still growing. itch.io lists **48,908 pixel art game assets**, and **10,816 of them (about 22%) are self-tagged as AI-generated** (both counts read live on 2026-10-29) ([itch.io pixel art](https://itch.io/game-assets/tag-pixel-art); [itch.io AI + pixel art](https://itch.io/game-assets/tag-ai-generated/tag-pixel-art)). Steam saw 6,422 pixel art games released between August 2023 and August 2025, about 3,200 a year, and only about 5% reached 500 reviews ([OP Game Marketing](https://opgamemarketing.substack.com/p/so-youre-making-a-pixel-art-game)). Commissioned sprites run $10–$30 each and take 3–7 days ([2D Will Never Die](https://2dwillneverdie.com/blog/how-much-do-sprites-cost/)). That is the cost generation competes against.

| Segment                                            | Core jobs-to-be-done                                                                                            | Top pains                                                                                                                                                                                                                                                        | What they accept from AI                                                                                                                                                                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Non-artist indie devs** (solo devs, programmers) | Get consistent, engine-ready characters, tiles and UI in one style without learning to draw                     | Consistency across frames and directions, cleanup skill gap, assembling exports                                                                                                                                                                                  | Generation, as long as it is disclosed and quality holds ([Steam discussion](https://steamcommunity.com/app/3074110/discussions/0/595137684887881384))                                                                            |
| **Agent / vibe-coding devs**                       | Have Claude Code or Cursor produce a whole asset set from one spec, written into the repo with correct metadata | Drift across calls, async jobs vs tool timeouts, token-heavy payloads, mismatched names, sizes and atlases ([Ludo](https://ludo.ai/tools/game-assets-in-claude); [Sorceress](https://sorceress.games/blog/claude-vibe-coding-for-games-you-need-more-than-code)) | Batch generation against a spec; "many varied assets from a single spec" ([r/aigamedev snapshot](https://reddit.sentinel-team.org/subreddits/aigamedev/snapshots/2026-04-10T22%3A13%3A49.687899Z))                                |
| **Pixel artists** (hobby and pro)                  | Precise manual control, fast animation, tilesets, palette work                                                  | Animation time, direction multiplication, weak tilemap tools, false "it's AI" accusations                                                                                                                                                                        | Deterministic assists (quantize, dither, cleanup, autotile, rotation aids); some use AI as reference or underpainting ([saint11](https://saint11.art/blog/big-pixel-art/))                                                        |
| **Asset-pack sellers**                             | Produce many coherent variants (palettes, tiles, directions) for marketplaces                                   | Tagging rules, proving authorship                                                                                                                                                                                                                                | Multiplication tools; provenance proof                                                                                                                                                                                            |
| **Small studios and teams**                        | Shared style, review, handoff to engine                                                                         | No collaboration or versioning in pixel tools                                                                                                                                                                                                                    | Style-consistent generation with review gates; publishers use gen AI more (58%) than studios (30%) ([GDC 2026](https://gdconf.com/article/gdc-2026-state-of-the-game-industry-reveals-impact-of-layoffs-generative-ai-and-more/)) |

Jam participants are a constraint rather than a segment. Some itch.io jams ban AI outright, and at least one pixel art entry was disqualified ([itch.io jam post](https://itch.io/post/12036465)).

### Time goes into animation, directions and the last 20% of cleanup

Practitioners consistently name animation as the main time sink. "Animation is where pixel art can become significantly more time-consuming" ([Ansimuz](https://medium.com/@ansimuz/pixel-art-for-solo-indie-developers-practical-tips-604aa4e57f3c)). Direction count multiplies the work: one artist prices 8-direction sheets at about 1.7× the 4-direction price ([EightTheKat](https://www.deviantart.com/eightthekat/art/Pixel-Art-Commission-Sheet-862226770)). Palette swaps and tile variants are the cheap multipliers ([freepixel.art](https://freepixel.art/blog/pixel-art-color-palettes-complete-guide)).

**With AI the bottleneck moves rather than disappears.** One detailed August 2026 post-mortem found that "Generative models do not respect a contract": feet lines were wrong, sprites were off-centre, hanging details broke bounding-box anchors, poses repeated, and some defects had "no threshold" to detect them. The author fixed these with scripted contract validation, per-frame colour counts, pose-difference metrics and targeted edits, because "full regeneration... alters unrelated details" ([Tokimon](https://www.tokimon.io/blog/making-ai-pixel-art-usable)). Cleanup has become its own tool category, with Pixel Snapper, PixelRefiner, Phaser's Tidy Pixel Art and PixelAid ([Sprite Fusion](https://www.spritefusion.com/pixel-snapper); [Phaser](https://phaser.io/tools/tidy-pixel-art)). Practitioners report that "enforcing palette + grid programmatically is way more important than prompt tuning" ([r/aigamedev snapshot](https://reddit.sentinel-team.org/posts/1rdukqt/snapshots/2026-02-27T17%3A01%3A22.754818Z)).

### Sentiment is hostile among artists, and that hostility shapes the product

GDC's 2026 survey of more than 2,300 developers found that **52% say generative AI harms the industry**, up from 30% in 2025 and 18% in 2024. Only 7% say it helps, and visual and technical artists are the most negative group at 64%. Even so, 36% use it at work ([GDC 2026](https://gdconf.com/article/gdc-2026-state-of-the-game-industry-reveals-impact-of-layoffs-generative-ai-and-more/)).

Pixel art communities go further:

- **Lospec**, which hosts the de facto palette database, left X, shut its subreddit feed and disassociated from r/PixelArt, citing "forced AI training" ([Lospec](https://lospec.com/)).
- Tools listed on Lospec advertise that they are "not an AI image generator".
- Lemmy's Pixel Art community lists "No AI Generated art" as rule #1 ([Lemmy](https://lemmy.world/post/45438359)).
- Hacker News critics dismiss AI pixel art because "the pixels are not all the same size" ([HN 44207304](https://news.ycombinator.com/item?id=44207304)).
- r/Art moderators have banned human artists whose work merely looked like AI ([Vice](https://www.vice.com/en/article/artist-banned-from-art-reddit/)), and an itch.io seller had to offer step-by-step files to prove authorship ([itch.io](https://pixelslime99.itch.io/buildingforge-urban-edition/comments)).

The current r/PixelArt rule text could not be verified.

These objections fall into two groups:

- **Technical** (fake pixels, inconsistency). The product can fix these with deterministic grid and palette guarantees.
- **Ethical** (consent, replacement). The product can address these only with honest provenance, clear training-data commitments, and modes that keep generative AI out entirely.

### Disclosure rules and copyright law turn provenance into a feature

**Steam.** Valve revised its AI disclosure form in January 2026. It now covers AI content "consumed by players" (in-game assets, store and marketing material) and exempts behind-the-scenes efficiency tools ([PC Gamer](https://www.pcgamer.com/software/ai/steam-updates-ai-disclosure-form-to-specify-that-its-focused-on-ai-generated-content-that-is-consumed-by-players-not-efficiency-tools-used-behind-the-scenes/)). By July 2025, 7,818 Steam games (about 7% of the catalog) disclosed generative AI. A little under 20% of 2025 releases did, and 60% of disclosures concerned asset generation ([Tom's Hardware](https://www.tomshardware.com/video-games/pc-gaming/1-in-5-steam-games-released-in-2025-use-generative-ai-up-nearly-700-percent-year-on-year-7-818-titles-disclose-genai-asset-usage-7-percent-of-entire-steam-library)).

**itch.io.** Since November 2024 every asset must be classified. "Assets using generative AI, even if subsequently modified, must be tagged appropriately, or they will not appear in our browse pages." Enforcement relies on user reports ([PC Gamer](https://pcgamer.com/software/platforms/indie-distribution-platform-itch-io-now-requires-asset-creators-to-disclose-the-use-of-generative-ai-in-their-work)). We did not confirm whether itch.io updated this policy in 2025–2026.

**Copyright.** The US Supreme Court denied cert in _Thaler v. Perlmutter_ on 2026-03-02, which leaves the human-authorship requirement in place: purely AI-generated output is uncopyrightable, while AI-assisted work is protected to the extent of the human contribution. The Copyright Office has said prompts alone are insufficient ([Mayer Brown](https://www.mayerbrown.com/en/insights/publications/2026/03/supreme-court-denies-review-in-ai-authorship-case)).

**Training data.** The only consent precedent is Retro Diffusion's self-reported licensed dataset. PixelLab says it does not train on user inputs or outputs without notifying users ([PixelLab FAQ](https://www.pixellab.ai/docs/faq)). EU AI Act transparency duties were not researched.

**What this means for the product.** We must record who or what made each pixel and export a disclosure summary that maps to Steam and itch.io categories. Edit history then doubles as evidence of human authorship, both for copyright and against false accusations. We must also commit to never training on user art without opt-in.

## Nobody owns the generate, snap, edit, export loop

The research shows nine gaps that reinforce one another:

1. **The integrated loop is unserved.** Generation tools have thin or borrowed editors. Deep editors have no native AI. No tool offers AI with full editor semantics: palette-respecting inpainting, frame-consistent edits, tile-aware generation into tilemap layers, or agent-editable project files. The closest attempt is PixelLab's AI-enabled Pixelorama fork ([PixelLab docs](https://www.pixellab.ai/docs/introduction-pixelorama)).
2. **The grid-true guarantee exists only in fragments**, across RD Pixel Fixer, Scenario Pixelate, SpriteCook's detector, Pixel Snapper and unfake.js. None of them is a default step inside an editor.
3. **Animation coherence is a harder unsolved problem than single-frame grid alignment.** It covers drift, registration and anchors. Even PixelLab's own docs say animation-to-animation "often needs manual cleanup" ([PixelLab docs](https://www.pixellab.ai/docs/tools/animation-to-animation)).
4. **Tilemap tooling is weak.** Aseprite's is weak, and Pyxel Edit's linked-transform niche is orphaned.
5. **Costs are opaque.** Credits, "generations" and per-model multipliers make spend hard to predict. RD's free cost quotes and refunds show the alternative.
6. **No tool ships provenance or disclosure tooling**, even though both storefronts now require disclosure.
7. **The browser has one serious open-source pro editor, Pixelorama Web**, and it carries Godot web-export overhead _(background)_.
8. **Collaboration and versioning are nearly absent.** Pixie is the only credible entrant, and it has no AI.
9. **Agents can generate assets but cannot finish them.** Aseprite MCP servers drive a headless desktop app ([letsagents/aseprite-mcp](https://github.com/letsagents/aseprite-mcp)), and generation MCPs return files. No hosted studio exists where an agent drafts and a human finishes in the same document.

**Positioning.** These gaps imply one position for ksprite: **a browser-native pixel studio with Aseprite-grade document semantics, where AI is a constrained, attributable set of commands on that document, shared by humans and agents.** It is editor-first and grid-true by construction. It is model-agnostic behind AI Gateway, and Aseprite-compatible so people can adopt it next to Aseprite rather than instead of it.

**What not to build.** Two things follow from the same evidence:

- **Do not fight PixelLab on catalog breadth.** Fifty generators across five model generations is a liability that we can turn into a selling point: one consistent constraint system over interchangeable backends.
- **Do not chase PixelLab's and Rosebud's "AI game builder" direction.** Engine handoff belongs in exports and the MCP, not in hosting games.

**The artist audience is reachable** only if deterministic assists and a no-generative-AI mode are real features, not afterthoughts.

## AI-native means constrained, editable, attributable and agent-drivable

"AI-native" should not mean "has a prompt box". For this product it means the eight principles below. Each one is traced to evidence from the research.

| #   | Principle                                                                      | What it means concretely                                                                                                                                                                                                                           | Evidence                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **The document is the product; AI is a set of commands on it**                 | UI tools, AI jobs and external agents all mutate the sprite only through the same typed, validated command API. Each logical action is one labelled, undoable transaction.                                                                         | Aseprite scripts and the UI share one Cmd pipeline ([cmd.h](https://github.com/aseprite/aseprite/blob/main/src/app/cmd.h)); tldraw's agent emits validated typed actions ([tldraw](https://tldraw.dev/starter-kits/agent)) |
| 2   | **Constraints are first-class and enforced deterministically**                 | Grid, palette, hard alpha and a per-asset "sprite contract" (size, anchor or feet line, max colours, margins) are document properties. Every model output passes through the cleanup pipeline and contract validation before it can become pixels. | "Generative models do not respect a contract" ([Tokimon](https://www.tokimon.io/blog/making-ai-pixel-art-usable))                                                                                                          |
| 3   | **AI output is a proposal, never a silent overwrite**                          | Results land as candidate cels, layers or branches with a diff overlay. Accepting one is a transaction; rejecting one costs nothing. N variations are siblings.                                                                                    | Photoshop's non-destructive generative layer and variations ([Adobe](https://blog.adobe.com/en/publish/2023/05/23/photoshop-new-features-ai-contextual-presets)); Pixie's suggest mode                                     |
| 4   | **Edit locally, regenerate rarely**                                            | Default to masked, palette-locked inpainting of a region or frame over whole-image regeneration.                                                                                                                                                   | Full regeneration "alters unrelated details" ([Tokimon](https://www.tokimon.io/blog/making-ai-pixel-art-usable))                                                                                                           |
| 5   | **Multiply approved masters**                                                  | A locked Character (canonical sprite, palette, references) drives directions, cycles, outfits and palette swaps. A tile master drives variants and autotile sets.                                                                                  | PixelLab's persistent characters; animation and directions are the time sinks                                                                                                                                              |
| 6   | **Every pixel has a provenance**                                               | Origin is recorded per image and per transaction (human, algorithmic, generated, generated then edited). A disclosure export and an enforceable "No generative AI" project mode follow from it.                                                    | Steam and itch.io rules; _Thaler_; Lospec's stance                                                                                                                                                                         |
| 7   | **Cost and latency are visible before spending, and jobs never block editing** | Quote before running, reserve and refund, and stream progress. Generation runs in the background while the user keeps drawing.                                                                                                                     | PixelLab's `confirm_cost`; RD's `check_cost` and refunds; 30+ minute jobs                                                                                                                                                  |
| 8   | **Model-agnostic, local where cheap, agent-economical**                        | Providers sit behind AI Gateway, and deterministic operations run in WASM on the client. Agents get a rendered PNG plus a structured summary, batched operations, and URLs rather than base64.                                                     | RD prices cleanup at $0.001; Ludo's CLI uses "far fewer tokens than MCP"; tldraw's perception model                                                                                                                        |

A ninth principle supports the others: **interop over lock-in.** Round-trip `.aseprite`, keep a documented, versioned native format, and never break files. Pixelorama's format breakages show what users punish ([Pixelorama blog](https://pixelorama.org/blog/)).

## Product design: a project of typed assets around one sprite document

### Core concepts

A **Project** is the unit of collaboration and of the "asset spec". It holds members and roles, a palette library, a style kit (reference images and a default sprite contract), an engine target and export presets. It contains **Assets**. An asset is versioned, typed, and points to one or more sprite documents plus metadata. The concepts layer like this:

| Concept                        | Definition                                                                                                                                                                                        | Backed by                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Sprite document**            | The editable artifact. An Aseprite-shaped tree of layers × frames → cels, with tags, slices, palettes and tilesets (see Foundation). Every other visual asset is ultimately one or more of these. | Document model                                                                                                                 |
| **Palette**                    | A named, ordered colour list with optional ramps and names. It can be imported from Lospec or as `.gpl`, `.hex` or `.pal` files. It can be _locked_ at project, asset or document scope.          | `Palette` entity, referenced by ID                                                                                             |
| **Character**                  | A canonical sprite (usually facing south), a palette, a reference set and a sprite contract. A direction set (1, 4 or 8) and an animation set hang off it, plus "states" such as outfits.         | One sprite document per character, with directions as layer groups or separate documents (open question). Animations are tags. |
| **Animation**                  | A named cycle (idle, walk, attack…) per direction: a tag range with per-frame durations, a loop direction, a repeat count and an anchor or pivot.                                                 | `Tag` + frame durations + `Slice` pivot                                                                                        |
| **Tileset**                    | A grid spec and a list of tiles (tile 0 empty), with optional Wang or blob terrain rules and per-tile user data. It is painted through tilemap layers.                                            | `Tileset` + tilemap layers                                                                                                     |
| **Map** (later)                | A tilemap document with tilemap layers and entities, exported to Tiled or LDtk.                                                                                                                   | Sprite document with tilemap layers                                                                                            |
| **Reference**                  | Images used for conditioning and tracing: concept art, mood boards, a style kit. They never export.                                                                                               | Reference layer flag or project assets                                                                                         |
| **Generation job / Candidate** | One provider call with its inputs (prompt, references, mask, palette, contract), quoted cost, status and candidates. A candidate becomes pixels only through an accept transaction.               | Job record + R2 blobs                                                                                                          |

### Main surfaces

The product has four surfaces:

1. **Editor.** A canvas with tools, a layers panel, a timeline with onion skin, a palette panel and a tileset panel. It also hosts a **generation dock** rather than sending users to a separate page. In the dock you choose prompt, references, mask (from the current selection) and constraints, and results appear in a candidate tray anchored to the target layer and frame.
2. **Project home.** An asset browser, a character sheet view showing a directions × animations grid as a contact sheet for review (as in Tokimon's workflow), palette and style kit management, and export presets.
3. **Agent surfaces.** An in-app assistant, a remote **MCP server**, a REST API and, later, a CLI. All of them expose the same command API plus asset-level operations.
4. **Review and history.** Version history, candidate branches, the provenance inspector and the disclosure export. Comments and suggestions arrive with collaboration.

### Key workflows

These are the workflows the product must make smooth, roughly in the order the roadmap unlocks them:

1. **Import and fix any AI image.** Paste output from any model. Run snap → palette lock → alpha binarize, preview the diff, and accept it into a layer. Provenance is set to "generated (external)". This is the cheapest way to win AI users before we generate anything ourselves.
2. **Draw and animate by hand.** Reach Aseprite parity on the top workflows: pixel-perfect pencil, fill, selection and move, layers, linked cels, tags and onion skin, then export a sheet plus JSON.
3. **Character pipeline.** Prompt or sketch → candidates → approve a canonical sprite → lock its palette and contract → generate 4 or 8 directions → generate cycles per direction → review on the contact sheet → inpaint per frame → export with an engine preset.
4. **Tileset pipeline.** Draw or generate base and transition textures. Assemble a 16-tile Wang or 47-tile blob set with deterministic code, repair seams by inpainting borders, validate edges programmatically, then paint tilemaps and export to Tiled or Godot.
5. **Agent round-trip.** A coding agent reads the project's asset spec over MCP and batch-generates into the studio. Results arrive as proposals, a human finishes the last 20%, and the agent exports files and metadata into the repo.
6. **Multiply.** Palette-swap variants, outfit states and tile variants, all from approved masters.
7. **Disclose.** Produce a per-asset or per-project provenance report for a Steam or itch.io submission, or certify a project as "No generative AI".

## Foundation: get the document, commands and pipeline right before any model call

### Model the document on Aseprite's object graph, with stable IDs everywhere

Aseprite's model is battle-tested, it is what engines import, and it is documented. Copy its structure, not its code. The graph is Document → Sprite. The Sprite holds an ImageSpec (colour mode, size, transparent index, colour space), a pixel ratio, the frame count and per-frame durations in ms, palettes keyed by frame, a root LayerGroup tree, Tags, Slices and Tilesets. Each image or tilemap Layer owns a sparse, frame-indexed list of Cels. Each Cel has a frame, a z-index and a _shared_ CelData holding the image, position, opacity and user data. **Linked cels share the whole CelData**, so they cannot differ in position or opacity ([cel.h](https://github.com/aseprite/aseprite/blob/main/src/doc/cel.h); [cel_data.h](https://github.com/aseprite/aseprite/blob/main/src/doc/cel_data.h); [sprite.h](https://github.com/aseprite/aseprite/blob/main/src/doc/sprite.h)).

**Images are tight-bounded** at the cel position, so they can lie partly or entirely off-canvas. **Tilemap cels are 32-bit tile-reference images**: a 29-bit index plus X, Y and diagonal flip bits, with tile 0 always empty ([tile.h](https://github.com/aseprite/aseprite/blob/main/src/doc/tile.h); [tileset.h](https://github.com/aseprite/aseprite/blob/main/src/doc/tileset.h)). A Grid carries odd-row and odd-column offsets, which hints at isometric and hex support. Tags carry a loop direction (forward, reverse, ping-pong, ping-pong reverse) and a repeat count. Slices are keyframed bounds with an optional 9-patch centre and pivot. **UserData** (text, colour and property maps keyed by extension namespace) attaches to the sprite, layers, cel data, tags, slices, tilesets and individual tiles ([user_data.h](https://github.com/aseprite/aseprite/blob/main/src/doc/user_data.h)).

We keep all of that, with these changes:

1. **A stable UUID on every entity.** Aseprite gives UUIDs only to layers, since v1.3.14. We need them on every entity, frames included. Collaboration, agent operations and diffing must never address anything by array index.
2. **Images as immutable, content-addressed blobs.** Linked cels and deduplication come for free, and R2 storage is natural.
3. **Typed provenance and the sprite contract** as first-class fields rather than user-data conventions.
4. **Lossless pass-through** of unknown `.aseprite` chunks and extension property maps.

```ts
// Sketch only: names and shapes to be refined in Phase 0.
type Id = string; // UUIDv7
type BlobHash = string; // sha-256 of the encoded pixel buffer, stored in R2

type ColorMode = "rgba" | "indexed" | "grayscale";
interface SpriteDoc {
  id: Id;
  schemaVersion: number;
  spec: { colorMode: ColorMode; width: number; height: number; transparentIndex?: number };
  pixelRatio: [number, number];
  frames: { id: Id; durationMs: number }[]; // order = array order
  palettes: { fromFrame: Id; paletteId: Id }[]; // frame-keyed like Aseprite; UI starts with one
  layers: Layer[]; // tree via parentId + order key
  cels: Cel[]; // sparse: at most one per (layerId, frameId)
  celData: Record<Id, CelData>; // shared by linked cels
  tags: {
    id: Id;
    name: string;
    from: Id;
    to: Id;
    dir: "fwd" | "rev" | "ping" | "pingrev";
    repeat: number;
    userData?: UserData;
  }[];
  slices: {
    id: Id;
    name: string;
    keys: { frame: Id; bounds: Rect; center?: Rect; pivot?: Point }[];
  }[];
  tilesets: Tileset[];
  contract?: SpriteContract; // canvas, anchor row, max colors, margins, palette lock
  userData?: UserData; // incl. preserved foreign extension maps
}
interface Layer {
  id: Id;
  parentId?: Id;
  order: string;
  kind: "image" | "group" | "tilemap";
  name: string;
  flags: {
    visible: boolean;
    editable: boolean;
    lockMove: boolean;
    background: boolean;
    preferLinked: boolean;
    collapsed: boolean;
    reference: boolean;
  };
  blend: BlendMode;
  opacity: number;
  tilesetId?: Id;
  userData?: UserData;
}
interface Cel {
  id: Id;
  layerId: Id;
  frameId: Id;
  celDataId: Id;
  zIndex: number;
}
interface CelData {
  id: Id;
  image: BlobHash;
  format: "rgba8" | "index8" | "gray16" | "tile32";
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  provenance: ProvenanceRef;
  userData?: UserData;
}
interface Tileset {
  id: Id;
  name: string;
  grid: Grid;
  tiles: { image: BlobHash; userData?: UserData }[]; // tiles[0] empty
  matchFlips: { x: boolean; y: boolean; d: boolean };
  terrain?: WangOrBlobRules;
}
// tile32 cell value: bits 0-28 index, bit 29 dflip, bit 30 yflip, bit 31 xflip (Aseprite layout)
```

**Colour.** Support **both indexed and RGBA** from day one. Indexed is the natural home for palette-locked AI output and makes palette swaps instant. RGBA is needed for imports and for unconstrained painting. Converting between them is an explicit, undoable command that uses nearest-colour mapping. Aseprite uses octree and RGB5A3 maps for this ([octree_map.h](https://github.com/aseprite/aseprite/blob/main/src/doc/octree_map.h)).

**Palettes stay frame-keyed** in the model for round-trip fidelity, but the UI can expose a single palette at first.

**Invariants to enforce in code and in tests:**

- At most one cel per (image layer, frame).
- Groups hold no cels.
- Frame duration belongs to the frame, not the cel.
- Tile 0 is always empty.
- Tilemap cels reference only their layer's tileset.

### Make every mutation a typed command inside an ID-addressed transaction

Aseprite routes every change through about 90 `Cmd` classes, each with execute, undo and redo. Pixel changes use region-sized diffs (`CopyRegion`), so undo memory stays proportional to the damage. A `Transaction` groups commands into one labelled step and commits or rolls back. It also records the active layer, frame and range before and after, so undo restores the editing context. History is a tree with a saved-state marker. Commands must **reference objects by ID and never hold pointers**, because several branches of the history can coexist ([cmd README](https://github.com/aseprite/aseprite/blob/main/src/app/cmd/README.md); [transaction.h](https://github.com/aseprite/aseprite/blob/main/src/app/transaction.h); [aseprite/undo](https://github.com/aseprite/undo/blob/main/undo_history.h)). Lua scripts get the same guarantee through `app.transaction()` ([Aseprite API](https://www.aseprite.org/api/app)). That is exactly the property we want for agents: one agent action is one labelled undo step.

Our version:

- Each command is a **serializable, versioned JSON op** with a schema (Zod or Valibot) and a pure `apply(doc) → doc'` plus an inverse.
- Pixel ops carry a **tile-chunked patch**: chunks of 16² or 32² with before and after blob hashes, or sparse runs for small strokes.
- A **transaction envelope** carries `{ id, label, actor: { kind: "user" | "agent" | "job", id }, baseVersion, ops[], contextBefore, contextAfter, provenance }`.
- **Grouping:** one gesture is one transaction (as in Starforge and Drawfinity, [starforge](https://github.com/Gabriel-Lacorte/starforge); [Drawfinity](https://needmorecowbell.github.io/drawfinity/architecture.html)). One candidate acceptance is one transaction, and so is one agent tool call.
- **Undo** starts linear and per-actor, because collaboration needs selective undo of _my_ transactions. The log format should still allow a branching history later.
- Op categories mirror Aseprite's catalog: cel, pixel, frame, layer, tag, slice, tile and tileset, palette and colour mode, selection, and user data. Two more join them: `acceptCandidate` and `runPipeline`.

**Do this before the editor.** The command log is the substrate for undo, persistence, sync, agent access and provenance at once. Retrofitting it later is what makes editors hard to make collaborative.

### Ship a deterministic pixel-cleanup pipeline as a core subsystem, not a feature

**The consensus technique** is a deterministic "de-AI" pass. Detect the grid (integer, fractional or _elastic_ cell sizes). Resample each cell by **dominant or mode voting, never by averaging**, so that no new colours appear. Quantize to a palette or lock to a fixed one. Binarize alpha. Finally, clean up isolated pixels and jaggies.

**unfake.js** implements all of this in an MIT-licensed Rust core (`unfake-core`) that compiles to WASM, needs no OpenCV, and includes a "reserved chroma colour" for keying ([unfake.js](https://github.com/jenissimo/unfake.js/)). **proper-pixel-art** (MIT, Python) adds a useful video mode: it fixes **one grid and one palette across all frames** to prevent flicker ([proper-pixel-art](https://github.com/KennethJAllen/proper-pixel-art)). RD sells the same operations for $0.001–$0.005 ([api-examples](https://github.com/Retro-Diffusion/api-examples)), so they are commodities that should run locally.

| Stage                       | What it does                                                                              | Notes                                                                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Normalize                | Decode, convert to sRGB, record source dimensions                                         | Store the raw provider output in R2 for provenance and re-runs                                                                                                             |
| 2. Background and alpha     | Key out a prompted flat chroma background, or take provider alpha; then binarize alpha    | Don't rely on model alpha: Cloudflare's docs say gpt-image-2 lacks transparent backgrounds ([Cloudflare](https://developers.cloudflare.com/ai/models/openai/gpt-image-2/)) |
| 3. Grid detection           | Estimate scale and offset, including fractional and elastic grids                         | Snap to the target canvas from the sprite contract when it is known                                                                                                        |
| 4. Cell resample            | Dominant, mode or quality-vote colour per cell                                            | No bilinear or area filtering, ever                                                                                                                                        |
| 5. Palette                  | Lock to the project palette, or quantize to k colours                                     | Palette lock is the hard guarantee, regardless of provider                                                                                                                 |
| 6. Cleanup                  | Remove isolated pixels, fix jaggies, optional outline pass                                | Each sub-step can be toggled                                                                                                                                               |
| 7. Registration (animation) | Shared grid and palette across frames; align anchors and feet lines                       | Addresses drift and the "sliding feet" complaints                                                                                                                          |
| 8. Contract validation      | Size, anchor row, centring, empty margin, holes, colour count, pose-difference thresholds | Tokimon's checks become built-in validators                                                                                                                                |
| 9. Preview and commit       | Diff or overlay against the target; accepting is one transaction                          | Pipeline parameters are stored in provenance                                                                                                                               |

**Where it runs.** On the client, in a Web Worker for interactive work. In a server Worker for the agent and batch path. Sprite-sized inputs fit the Workers CPU limits (30 s by default, configurable to 5 min, [Workers limits](https://developers.cloudflare.com/workers/platform/limits/index.md)); 4 MP frontier outputs should be downscaled first.

**The pipeline is also the artist-friendly face of the product.** It is deterministic, non-generative and useful on hand-drawn work too.

### Record provenance per image and per transaction, and export it as disclosure

Every CelData points to a provenance record with an origin:

- `human`
- `algorithmic` (deterministic transforms such as quantize, rotate or autotile)
- `generated` (with provider, model, prompt, reference blob hashes, seed if any, mask, pipeline parameters, cost and job ID)
- `generated+edited`

Every transaction records its actor. From these the system derives three things:

- An **asset- and project-level summary**: the share of visible pixels by origin, and which assets contain any generated content.
- A **disclosure export** that maps to Steam's player-facing categories and itch.io's graphics tag.
- An optional **edit-history and timelapse export** as evidence of human authorship.

A project-level **"No generative AI" mode** disables generation commands at the API layer, not just in the UI, and rejects imports flagged as generated. Projects can then be honestly certified for itch.io's "No AI" tag and for jams that ban AI. **C2PA** embedding on export is a later option, with Photoshop's Content Credentials as the precedent ([Adobe](https://blog.adobe.com/en/publish/2023/05/23/photoshop-new-features-ai-contextual-presets)).

### Treat `.aseprite` round-trip as the adoption wedge, implemented clean-room from the spec

The `.aseprite` format is a little-endian container derived from FLI/FLC:

- **File header:** 128 bytes, magic `0xA5E0`. Flags mark layer opacity as valid, group blend as valid, and the presence of layer UUIDs.
- **Frames:** each has a 16-byte header (magic `0xF1FA`, duration in ms) followed by typed chunks.
- **Chunks:**
  - layer (with the tree encoded as child levels)
  - cel (raw, linked, zlib image, or zlib tilemap with flip bitmasks)
  - cel extra
  - colour profile
  - external files
  - tags
  - palette (`0x2019`)
  - user data, with typed property maps
  - slice
  - tileset

**The subtle part is association.** User Data chunks attach _by position_ to the previously read object: one per tag after a Tags chunk, then one per tile after a Tileset ([ase-file-specs.md](https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md)).

**Must-preserve list:**

- All header flags.
- Linked cels, kept linked on write.
- Z-index and precise bounds.
- ICC bytes.
- Extension property maps, even when we don't understand them.
- Tag repeat counts and colours.
- Palette names and alpha.
- Slice keys.
- Tileset flip-match flags and per-tile user data.
- Unknown chunks, skipped by size and kept as opaque blobs.

**Implementation.** In the browser, a `DataView` plus `DecompressionStream('deflate')` or fflate is enough.

**Legal constraint.** The Aseprite EULA forbids reusing post-2016 Aseprite code. Pre-2016 code and LibreSprite are GPLv2. **We write the codec from the public spec only** and build our own conformance corpus. No official test corpus was found.

| Format                                                                                   | Direction    | Phase | Why                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | ------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.aseprite` / `.ase`                                                                     | Read + write | 0     | Lingua franca. Unity's official importer and Godot's Aseprite Wizard consume it directly ([Unity](https://docs.unity3d.com/Packages/com.unity.2d.aseprite@1.1/manual/index.html); [Aseprite Wizard](https://www.Github.com/viniciusgerevini/godot-aseprite-wizard))   |
| PNG (single, frames)                                                                     | Read + write | 0     | Universal; also the AI import path                                                                                                                                                                                                                                    |
| PNG sheet + JSON (Aseprite schema: hash and array, with `frameTags`, `layers`, `slices`) | Write        | 1     | Phaser and PixiJS read TexturePacker-style JSON hash and array ([Phaser](https://docs.phaser.io/api-documentation/function/textures)); key list per Aseprite's exporter ([doc_exporter.cpp](https://github.com/aseprite/aseprite/blob/main/src/app/doc_exporter.cpp)) |
| GIF                                                                                      | Read + write | 1     | Sharing and previews                                                                                                                                                                                                                                                  |
| Palettes: Lospec JSON, `.gpl`, `.hex`, `.pal`                                            | Read + write | 1     | Lospec API is single-palette by slug ([Lospec API](https://lospec.com/palettes/api)) _(file types: background)_                                                                                                                                                       |
| GameMaker strips (`_stripN`)                                                             | Write        | 2     | Cheap engine preset _(background)_                                                                                                                                                                                                                                    |
| Tiled `.tmj`/`.tsj` (+ `.tmx`/`.tsx`)                                                    | Write        | 2–3   | Tilemap standard _(background)_                                                                                                                                                                                                                                       |
| LDtk                                                                                     | Write        | 3     | Levels with auto-layer rules _(background)_                                                                                                                                                                                                                           |
| Godot `.tres` SpriteFrames / TileSet                                                     | Write        | 3     | Engine-native preset; tags map to animations _(background)_                                                                                                                                                                                                           |
| APNG, WebP                                                                               | Write        | Later | Aseprite issue #246 asks for APNG                                                                                                                                                                                                                                     |
| `.pxo`, `.piskel`, `.pyxel`, `.psd`                                                      | Read         | Later | Migration from stalled tools (Piskel and Pyxel Edit users are orphaned)                                                                                                                                                                                               |

**Native format.** A versioned JSON manifest (the document plus its op-log checkpoint) with content-addressed blobs, downloadable as a zip. Ship it with a published schema and forward-compatible migrations from v1.

**The key mapping to protect** across every export: tags become clips, with per-frame durations and loop direction.

### Keep rendering simple and off the React tree

The guidance in this subsection is all _(background)_. Little authoritative 2026 literature exists on rendering in web pixel editors.

**Renderer.** At sprite sizes (≤512²), Canvas2D with `imageSmoothingEnabled = false` is sufficient. A **WebGL2 compositor** earns its place for three things:

- Many layers with blend modes.
- Onion-skin tints.
- **Indexed layers rendered through a palette lookup texture.** Palette swaps then become a single uniform change.

Run the compositor on an `OffscreenCanvas` in a Worker, with WASM for flood fill, quantization and RotSprite or cleanEdge. Defer WebGPU: it adds complexity for little gain at these sizes. The Poxi editor shows WebGL is workable for this kind of app ([Poxi](https://www.github.com/maierfelix/poxi)).

**State.** Keep the document in an external store that React subscribes to through `useSyncExternalStore`, and keep the canvas imperative.

**Tool architecture.** Copy Aseprite's composable design: **Controller × Joiner × PointShape × Ink**. A new tool is then a combination of these parts plus parameters ([tool_box.h](https://github.com/aseprite/aseprite/blob/main/src/app/tools/tool_box.h)).

**Local persistence.** IndexedDB or OPFS holds the blob cache and a pending-op queue. The queue makes offline edits and crash recovery possible.

### Use one Durable Object per document as the authoritative sequencer

**Pixel data does not need character-level CRDTs.** A DO-sequenced op log gives a total order, which makes server authority simple. The approach:

- Clients send transactions with a `baseVersion`.
- The document DO validates each one against the schema, permissions and contract, assigns a sequence number, appends it to SQLite and broadcasts it.
- **Pixel conflicts resolve last-writer-wins per tile chunk.** Structural ops resolve by entity ID.
- Presence (cursors, selections, the active frame) travels as ephemeral messages.

This extends Aseprite's single-writer, ID-based commands with UUIDs everywhere. It matches the "LWW per cell with Lamport clocks" design small editors are converging on ([starforge](https://github.com/Gabriel-Lacorte/starforge); [vectis-crdt](https://dev.to/rafacalderon/how-i-built-a-crdt-engine-for-a-collaborative-whiteboard-in-rust-41kl)). Yjs on a DO provider or Liveblocks remain fallbacks, for example for comments _(background)_.

**Agent edits reuse the same path.** An agent's transaction arrives with `actor.kind = "agent"`. It can be held as a **pending changeset** that a human accepts or rejects, which gives us Pixie's suggest-mode pattern with AI as one more collaborator.

### Map Cloudflare primitives onto the architecture

| Primitive                    | Role in ksprite                                                                                                                                                                                                                                              | Notes and limits                                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workers** (TanStack Start) | SSR app shell, server functions, REST API, MCP endpoint, auth, export endpoints, server-side cleanup WASM                                                                                                                                                    | CPU 30 s by default, configurable to 5 min; network wait doesn't count ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/index.md)). Bindings are server-only, per this repo's conventions |
| **Durable Objects** (SQLite) | _DocumentRoom_ per sprite document: op log, snapshots, presence, WebSocket fan-out, pending agent changesets. _ProjectDO_ per project: asset index, members, palettes, asset spec, provenance roll-ups. Optionally _UserDO_ for the credit ledger and quotas | 10 GB per object; 30 s CPU per invocation by default, configurable to 5 min ([DO limits](https://developers.cloudflare.com/durable-objects/platform/limits))                                                         |
| **R2**                       | Content-addressed pixel blobs, raw provider outputs, reference images, exports and zipped native files                                                                                                                                                       | Immutable keys by hash; linked cels and dedup are free                                                                                                                                                               |
| **Workflows**                | One instance per generation job: quote → reserve credits → call the provider through AI Gateway → poll or sleep → run the cleanup pipeline → write to R2 → notify the DocumentRoom → settle or refund                                                        | Per-step wall-clock is unlimited; subrequests are configurable up to 10M ([Workflows limits](https://developers.cloudflare.com/workflows/reference/limits)); this fits RD's task polling and idempotency keys        |
| **Queues**                   | Fan-out and back-pressure: 8 directions, N variations, batch agent requests, export rendering, thumbnailing                                                                                                                                                  | Decouples bursts from provider rate limits                                                                                                                                                                           |
| **Workers AI**               | Cheap native drafts and edits: FLUX.2 [dev] (up to 4 reference images), FLUX.2 klein, FLUX.1 schnell; third-party `openai/gpt-image-2` through the same `env.AI` binding                                                                                     | Billed in Neurons ($0.011 per 1k; 10k per day free) ([pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/); [FLUX.2 blog](https://blog.cloudflare.com/flux-2-workers-ai/))                       |
| **AI Gateway**               | Front door for every model call (Workers AI, OpenAI, Google, Retro Diffusion): logging, cost analytics, caching, rate limits, fallback, Unified Billing                                                                                                      | Background or webhook mode for long image jobs reported _(unconfirmed doc page)_ ([AI Gateway](https://developers.cloudflare.com/ai-gateway/usage/rest-api/))                                                        |

## Roadmap: build from the document up

Each phase must leave behind something solid that later phases stand on. The order is deliberate. AI arrives only after the document, the commands and the cleanup pipeline can carry it.

| Phase                             | Goal                                        | Scope                                                                                                                                                                                                                                                                                                                                                                       | Must make solid                                                                                                                                                                               | Exit criteria                                                                                                   |
| --------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **0. Foundation**                 | A document you can trust                    | Document model and invariants; op and transaction schema with inverses; content-addressed blobs; local persistence; DocumentRoom DO skeleton (single user); clean-room `.aseprite` reader and writer; PNG I/O; provenance fields                                                                                                                                            | Stable IDs everywhere; op versioning and migrations; a round-trip conformance corpus built from real Aseprite files; property-based tests of invariants and undo                              | Open → save → reopen in Aseprite is lossless on the corpus; every op undoes exactly                             |
| **1. Editor MVP**                 | Finish a sprite without leaving the browser | Canvas and renderer; pencil (pixel-perfect), eraser, fill, line and shape tools, selections, move; layers and groups; frames, linked cels, tags, onion skin, playback; palette panel with indexed mode and Lospec import; sheet + JSON and GIF export                                                                                                                       | Rendering performance and input latency; undo that feels right (gesture granularity); keyboard-first, Aseprite-like shortcuts; the tool architecture (Controller × Joiner × PointShape × Ink) | An Aseprite user can redo a small walk cycle with no blockers                                                   |
| **2. Pixel pipeline and assists** | Make any AI image (or messy art) game-ready | unfake-core WASM pipeline; import-and-fix flow; palette lock; sprite contract and validators; multi-frame registration; deterministic assists (outline, palette swap, RotSprite or cleanEdge, dither); tilemap layers and a basic tileset panel; "No generative AI" mode                                                                                                    | Determinism and reproducibility (parameters in provenance); diff and preview UX; the indexed-colour workflow                                                                                  | Paste a GPT Image or Nano Banana sprite and get a palette-locked, grid-true, contract-valid layer in under 10 s |
| **3. AI generation**              | Generation that lands as editable proposals | Generation dock; AI Gateway provider layer (Workers AI FLUX.2, gpt-image, Retro Diffusion API); Workflows jobs with quotes, reservation and refunds; candidate tray and branches; masked inpainting with palette lock; Character entity with references; rotations and cycles; tile texture generation with deterministic Wang/blob assembly and seam checks; credit ledger | Job reliability and idempotency; cost transparency; provider abstraction (no single-vendor lock); provenance capture for every pixel                                                          | A character goes from prompt to 4-direction idle and walk, cleaned and exported, with costs shown up front      |
| **4. Agent and collaboration**    | Humans and agents in the same document      | Remote MCP server and REST API over the command API and asset spec; agent perception (rendered PNG plus a structured summary); pending changesets with accept and reject; in-app assistant; multiplayer via DocumentRoom; roles, comments, suggestion mode, named versions; engine export presets (Tiled, Godot, GameMaker); disclosure export                              | Permissions and op validation at the DO; token-efficient responses (URLs, not base64); async patterns that survive agent timeouts; per-actor undo                                             | A coding agent batch-produces a character set into a project, and a human fixes and exports it into the repo    |

Items that come later, once the base is proven, are mostly the long-tail requests from Aseprite users:

- audio tracks for lip-sync
- mask layers
- animated tiles
- linked tile instances with transforms
- isometric and perspective helpers
- LDtk export
- normal maps
- C2PA
- offline PWA
- iPad and pencil input
- a timelapse export

## Open questions and risks

| Question or risk                 | Why it matters                                                                                                                                                                                                                                                               | Next step                                                                                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pricing model**                | Editors sell one-time (Aseprite $19.99, Pixquare, Pro Motion). AI tools sell credits that users find opaque. RD's per-call cost floor (~$0.03–$0.25) bounds margins if we resell generation                                                                                  | Test a free or cheap editor plus transparent pay-per-generation, or bring-your-own-key, against subscription tiers                                               |
| **Artist backlash**              | 64% of visual artists say gen AI harms the industry; Lospec-style communities may reject any AI-branded tool                                                                                                                                                                 | Lead with the editor and deterministic assists; make "No generative AI" mode and the provenance guarantees credible; publish a no-training-without-opt-in policy |
| **Model supply**                 | PixelLab's ToS bars competing services; FLUX.1 Kontext [dev] weights are non-commercial ([Runware](https://runware.ai/models/bfl-flux-1-kontext-dev)); frontier models aren't pixel-native                                                                                   | Start with Workers AI and gpt-image plus our pipeline; evaluate an RD API partnership; keep providers swappable                                                  |
| **Our own pixel model?**         | A consent-trained native model could be a moat (RD precedent), but it is costly and ethically loaded                                                                                                                                                                         | Defer until Phase 3 data shows where providers fail; if pursued, use licensed or consented data only                                                             |
| **Animation quality ceiling**    | 4–16 frame cycles are usable but need cleanup; VFX and squash-and-stretch remain weak (FLIP ~0.58 failure cases vs ~0.26 typical for the best deterministic interpolator) ([arXiv 2610.27253](https://arxiv.org/html/2610.27253v1))                                          | Design the UX around per-frame proposals and inpainting rather than one-shot sheets; evaluate deterministic sprite interpolators                                 |
| **`.aseprite` fidelity**         | No official conformance corpus; the positional user-data rules are subtle; the format still changes in 1.3.x                                                                                                                                                                 | Build a corpus early; fuzz the codec; track Aseprite release notes                                                                                               |
| **Character document structure** | Directions as layer groups in one document, or separate documents per direction, affects exports, collaboration granularity and AI batching                                                                                                                                  | Prototype both against Unity, Godot and Phaser import paths in Phase 1–2                                                                                         |
| **Collaboration demand**         | No source measured pixel artists' demand for multiplayer; Pixie may launch first                                                                                                                                                                                             | Keep collaboration in Phase 4, but design ops for it in Phase 0                                                                                                  |
| **Unverified competitor facts**  | PixelLab tier prices and caps conflict; Ludo, AutoSprite and God Mode prices come from vendor or directory pages; Cloudflare's gpt-image-2 transparency note conflicts with a news preview                                                                                   | Re-verify before external messaging                                                                                                                              |
| **Policy drift**                 | Steam changed its disclosure form in January 2026; Epic's CEO calls the tags "irresponsible" ([letsdatascience](https://letsdatascience.com/news/epic-ceo-criticizes-valve-steam-ai-disclosures-06e02306)); itch.io's 2025–2026 status and the EU AI Act were not researched | Keep provenance categories granular so disclosure exports can be remapped                                                                                        |
| **GPL and code reuse**           | LibreSprite and pre-2016 Aseprite are GPLv2; the network-use implications are ambiguous; laf and undo licenses unchecked                                                                                                                                                     | Default to clean-room; get legal review before reusing any GPL code                                                                                              |

## Conclusion

The strongest finding is that the bottleneck has moved. Generating a plausible sprite is close to a commodity, available from a dozen vendors and every frontier model for cents. The hard and unowned part is everything after generation: turning output into grid-true, palette-locked, registered, contract-valid pixels; fixing the drifting 20% by hand; and proving afterwards who made what. That favours a product whose core asset is a trustworthy document and command system, not a model catalog. It also means the foundation work in Phases 0–2 is itself the AI strategy, because every generation feature we add later inherits its guarantees.

The second insight is that the market's two halves can be served by one product only if AI is optional, visible and accountable. Artists and non-artist developers want opposite things from AI but the same things from an editor. The architecture that makes agents safe, with typed commands, proposals, per-actor undo and provenance, is the same architecture that makes a "No generative AI" guarantee credible to artists. Building it first is what keeps both audiences open.

## Sources

**PixelLab**

- [PixelLab homepage](https://www.pixellab.ai/)
- [PixelLab API and pricing](https://www.pixellab.ai/pixellab-api)
- [PixelLab MCP](https://www.pixellab.ai/mcp)
- [PixelLab MCP docs](https://api.pixellab.ai/mcp/docs)
- [Ways to use PixelLab](https://www.pixellab.ai/docs/ways-to-use-pixellab)
- [Pixelorama-based editor](https://www.pixellab.ai/docs/introduction-pixelorama)
- [Animation-to-animation](https://www.pixellab.ai/docs/tools/animation-to-animation)
- [FAQ](https://www.pixellab.ai/docs/faq)
- [Terms of service](https://www.pixellab.ai/termsofservice)
- [AI Game Builder](https://www.pixellab.ai/ai-game-builder)
- [VFX Creator post](https://x.com/PixelLabAI/status/2110291625050071449)
- [Techsy hands-on](https://techsy.io/en/blog/meshy-vs-higgsfield-vs-pixellab)
- [Cinevva guide](https://app.cinevva.com/guides/ai-pixel-art-generators) _(third-party)_
- [GameDev AI Hub](https://gamedevaihub.com/retro-diffusion-vs-pixellab/) _(third-party)_

**Other AI generators**

- [Ludo pricing](https://ludo.ai/pricing)
- [Ludo compare page](https://ludo.ai/compare/best-ai-sprite-generators) _(vendor)_
- [Ludo in Claude](https://ludo.ai/tools/game-assets-in-claude)
- [MCV UK on Ludo API/MCP](https://mcvuk.com/business-news/industry-news-ludo-ai-launches-api-and-mcp-beta-to-bring-ai-game-asset-creation-into-developer-workflows/)
- [Retro Diffusion api-examples](https://github.com/Retro-Diffusion/api-examples)
- [Retro Diffusion on itch.io](https://astropulse.itch.io/retrodiffusion)
- [Scenario: Retro Diffusion models](https://help.scenario.com/articles/4202673551-retro-diffusion-models-the-essentials)
- [Scenario pricing](https://www.scenario.com/pricing)
- [Layer.ai](https://www.layer.ai/)
- [God Mode AI](https://www.godmodeai.co/)
- [AutoSprite](https://www.autosprite.io/)
- [Sprite AI](https://www.sprite-ai.art/)
- [SpriteCook blog](https://www.spritecook.ai/blog/nanobanana-pixel-art-for-games) _(vendor)_
- [Rosebud](https://www.rosebud.ai/ai-game-assets)

**Aseprite**

- [Release notes](https://aseprite.org/release-notes/)
- [Steam](https://store.steampowered.com/app/431730/Aseprite/)
- [SteamSpy](https://steamspy.com/app/431730)
- [VaporLens](https://vaporlens.app/app/431730/aseprite/stats/details)
- [File format spec](https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md)
- [src/doc model](https://github.com/aseprite/aseprite/tree/main/src/doc)
- [src/app/cmd](https://github.com/aseprite/aseprite/tree/main/src/app/cmd)
- [undo library](https://github.com/aseprite/undo/blob/main/undo_history.h)
- [EULA](https://github.com/aseprite/aseprite/blob/main/EULA.txt)
- [CLI docs](https://www.aseprite.org/docs/cli/)
- [Plugin API](https://www.aseprite.org/api/plugin)
- [Issues by reactions](https://github.com/aseprite/aseprite/issues?q=is%3Aissue+is%3Aopen+sort%3Areactions-%2B1-desc)
- [Tileset management thread](https://community.aseprite.org/t/advanced-tileset-management/11741)

**Other editors and engines**

- [Pixelorama blog](https://pixelorama.org/blog/)
- [Pixie](https://drawpixie.com/)
- [LibreSprite](https://github.com/LibreSprite/LibreSprite)
- [Lospec pixel editor](https://github.com/lospec/pixel-editor)
- [Pyxel Edit features](https://pyxeledit.com/features.php)
- [Pro Motion NG](https://cosmigo.com/pixel_animation_software)
- [Pixquare](https://apps.apple.com/us/app/id1659428179)
- [PixiEditor 2.0](https://alternativeto.net/news/2025/7/pixieditor-2-0-from-pixel-art-to-universal-2d-editing-with-new-features-and-tools/)
- [Unity Aseprite Importer](https://docs.unity3d.com/Packages/com.unity.2d.aseprite@1.1/manual/index.html)
- [Godot Aseprite Wizard](https://www.Github.com/viniciusgerevini/godot-aseprite-wizard)
- [Phaser texture parsers](https://docs.phaser.io/api-documentation/function/textures)
- [Lospec palette API](https://lospec.com/palettes/api)

**Users, sentiment and policy**

- [GDC 2026 State of the Industry](https://gdconf.com/article/gdc-2026-state-of-the-game-industry-reveals-impact-of-layoffs-generative-ai-and-more/)
- [itch.io pixel art assets](https://itch.io/game-assets/tag-pixel-art)
- [itch.io AI + pixel art](https://itch.io/game-assets/tag-ai-generated/tag-pixel-art)
- [OP Game Marketing](https://opgamemarketing.substack.com/p/so-youre-making-a-pixel-art-game)
- [Tokimon post-mortem](https://www.tokimon.io/blog/making-ai-pixel-art-usable)
- [Lospec](https://lospec.com/)
- [HN discussion](https://news.ycombinator.com/item?id=44207304)
- [Steam disclosure update (PC Gamer)](https://www.pcgamer.com/software/ai/steam-updates-ai-disclosure-form-to-specify-that-its-focused-on-ai-generated-content-that-is-consumed-by-players-not-efficiency-tools-used-behind-the-scenes/)
- [Steam AI disclosure counts (Tom's Hardware)](https://www.tomshardware.com/video-games/pc-gaming/1-in-5-steam-games-released-in-2025-use-generative-ai-up-nearly-700-percent-year-on-year-7-818-titles-disclose-genai-asset-usage-7-percent-of-entire-steam-library)
- [itch.io disclosure rule (PC Gamer)](https://pcgamer.com/software/platforms/indie-distribution-platform-itch-io-now-requires-asset-creators-to-disclose-the-use-of-generative-ai-in-their-work)
- [Thaler cert denial (Mayer Brown)](https://www.mayerbrown.com/en/insights/publications/2026/03/supreme-court-denies-review-in-ai-authorship-case)
- [r/aigamedev snapshots](https://reddit.sentinel-team.org/subreddits/aigamedev/snapshots/2026-04-10T22%3A13%3A49.687899Z)

**Techniques and architecture**

- [unfake.js](https://github.com/jenissimo/unfake.js/)
- [proper-pixel-art](https://github.com/KennethJAllen/proper-pixel-art)
- [Sprite Fusion Pixel Snapper](https://www.spritefusion.com/pixel-snapper)
- [Neural directional frame generation (arXiv 2610.27253)](https://arxiv.org/html/2610.27253v1)
- [Sprite Sheet Diffusion (arXiv 2412.03685)](https://arxiv.org/abs/2412.03685)
- [tldraw agent starter kit](https://tldraw.dev/starter-kits/agent)
- [letsagents/aseprite-mcp](https://github.com/letsagents/aseprite-mcp)
- [MJSchut/aseprite-mcp](https://github.com/MJSchut/aseprite-mcp)
- [Adobe generative layer](https://blog.adobe.com/en/publish/2023/05/23/photoshop-new-features-ai-contextual-presets)
- [Starforge](https://github.com/Gabriel-Lacorte/starforge)
- [Drawfinity architecture](https://needmorecowbell.github.io/drawfinity/architecture.html)

**Cloudflare**

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/index.md)
- [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits)
- [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits)
- [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [FLUX.2 on Workers AI](https://blog.cloudflare.com/flux-2-workers-ai/)
- [GPT Image 2 on Cloudflare](https://developers.cloudflare.com/ai/models/openai/gpt-image-2/)
- [AI Gateway REST API](https://developers.cloudflare.com/ai-gateway/usage/rest-api/)
