#!/usr/bin/env bash
# Regenerates the .aseprite corpus and Aseprite's own renders of every frame.
# Needs a local Aseprite; set ASEPRITE to its binary if it isn't at the Steam default.
set -euo pipefail

aseprite="${ASEPRITE:-$HOME/Library/Application Support/Steam/steamapps/common/Aseprite/Aseprite.app/Contents/MacOS/aseprite}"
corpus="$(cd "$(dirname "$0")" && pwd)"

rm -f "$corpus"/*.aseprite "$corpus"/renders/*.png
mkdir -p "$corpus/renders"
"$aseprite" --batch --script-param "out=$corpus" --script "$corpus/make-corpus.lua"

# Aseprite's flattened render of each frame, as kpixel's reference. Sprites are converted to RGB
# first: saving an indexed sprite to PNG ignores cel and layer opacity.
for file in "$corpus"/*.aseprite; do
  name="$(basename "$file" .aseprite)"
  "$aseprite" --batch "$file" --color-mode rgb --save-as "$corpus/renders/$name-{frame0}.png"
done

"$aseprite" --version
