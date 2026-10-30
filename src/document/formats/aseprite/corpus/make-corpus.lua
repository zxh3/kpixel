-- Builds the .aseprite conformance corpus with Aseprite itself, so kpixel's reader and writer
-- are tested against files Aseprite really produces. Run it through ./make-corpus.sh.
--
-- Each sprite exercises a group of features. Keep them small: they're committed to the repo.

local outputDirectory = app.params["out"]

local function rgba(r, g, b, a)
  return app.pixelColor.rgba(r, g, b, a or 255)
end

-- Fills an image with a deterministic pattern so every pixel is checked.
local function paint(image, seed, alphaMode)
  for y = 0, image.height - 1 do
    for x = 0, image.width - 1 do
      local alpha = 255
      if alphaMode == "holes" and (x + y + seed) % 5 == 0 then
        alpha = 0
      elseif alphaMode == "translucent" then
        alpha = 64 + ((x * 37 + y * 11 + seed * 13) % 160)
      end
      image:drawPixel(x, y, rgba((x * 31 + seed * 47) % 256, (y * 53 + seed * 19) % 256, (x * y * 7 + seed * 29) % 256, alpha))
    end
  end
end

local function newImageCel(sprite, layer, frame, width, height, x, y, seed, alphaMode)
  local image = Image(width, height, sprite.colorMode)
  paint(image, seed, alphaMode)
  return sprite:newCel(layer, frame, image, Point(x, y))
end

local function save(sprite, name)
  sprite:saveAs(outputDirectory .. "/" .. name .. ".aseprite")
  sprite:close()
end

-- 1. Basics: layers, frames with their own durations, layer and cel opacity, hidden layers,
--    cels positioned partly off the canvas.
do
  local sprite = Sprite(12, 10, ColorMode.RGB)
  sprite:newFrame()
  sprite:newFrame()
  sprite.frames[1].duration = 0.1
  sprite.frames[2].duration = 0.25
  sprite.frames[3].duration = 0.04
  local base = sprite.layers[1]
  base.name = "base"
  local top = sprite:newLayer()
  top.name = "top"
  top.opacity = 160
  local hidden = sprite:newLayer()
  hidden.name = "hidden"
  hidden.isVisible = false
  for frame = 1, 3 do
    newImageCel(sprite, base, frame, 12, 10, 0, 0, frame, "holes")
    local cel = newImageCel(sprite, top, frame, 6, 5, frame * 2 - 3, 3, frame + 10, "translucent")
    cel.opacity = 200 - frame * 40
  end
  newImageCel(sprite, hidden, 1, 4, 4, 2, 2, 99, nil)
  save(sprite, "basics")
end

-- 2. Every blend mode, each on its own frame over the same backdrop.
do
  local modes = {
    BlendMode.NORMAL, BlendMode.MULTIPLY, BlendMode.SCREEN, BlendMode.OVERLAY, BlendMode.DARKEN,
    BlendMode.LIGHTEN, BlendMode.COLOR_DODGE, BlendMode.COLOR_BURN, BlendMode.HARD_LIGHT,
    BlendMode.SOFT_LIGHT, BlendMode.DIFFERENCE, BlendMode.EXCLUSION, BlendMode.HSL_HUE,
    BlendMode.HSL_SATURATION, BlendMode.HSL_COLOR, BlendMode.HSL_LUMINOSITY, BlendMode.ADDITION,
    BlendMode.SUBTRACT, BlendMode.DIVIDE,
  }
  local sprite = Sprite(8, 8, ColorMode.RGB)
  local backdrop = sprite.layers[1]
  backdrop.name = "backdrop"
  for index, mode in ipairs(modes) do
    if index > 1 then
      sprite:newFrame()
    end
  end
  for index, mode in ipairs(modes) do
    newImageCel(sprite, backdrop, index, 8, 8, 0, 0, 3, "holes")
    local layer = sprite:newLayer()
    layer.name = "mode " .. (index - 1)
    layer.blendMode = mode
    newImageCel(sprite, layer, index, 6, 6, 1, 1, 7, "translucent")
  end
  save(sprite, "blend-modes")
end

-- 3. Groups: nesting, collapsed groups, group opacity and blend mode, locked layers.
do
  local sprite = Sprite(10, 10, ColorMode.RGB)
  local bottom = sprite.layers[1]
  bottom.name = "bottom"
  newImageCel(sprite, bottom, 1, 10, 10, 0, 0, 1, nil)
  local outer = sprite:newGroup()
  outer.name = "outer"
  outer.opacity = 180
  local inner = sprite:newGroup()
  inner.name = "inner"
  inner.parent = outer
  inner.isCollapsed = true
  local child = sprite:newLayer()
  child.name = "child"
  child.parent = inner
  newImageCel(sprite, child, 1, 6, 6, 2, 2, 5, "holes")
  local sibling = sprite:newLayer()
  sibling.name = "sibling"
  sibling.parent = outer
  sibling.isEditable = false
  newImageCel(sprite, sibling, 1, 4, 8, 5, 1, 9, "translucent")
  save(sprite, "groups")
end

-- 4. Linked cels and z-index.
do
  local sprite = Sprite(8, 8, ColorMode.RGB)
  sprite:newFrame()
  sprite:newFrame()
  local lower = sprite.layers[1]
  lower.name = "lower"
  local upper = sprite:newLayer()
  upper.name = "upper"
  newImageCel(sprite, lower, 1, 6, 6, 0, 0, 2, nil)
  app.activeSprite = sprite
  app.range.layers = { lower }
  app.range.frames = { sprite.frames[1], sprite.frames[2], sprite.frames[3] }
  app.command.LinkCels()
  for frame = 1, 3 do
    newImageCel(sprite, upper, frame, 5, 5, 2, 2, frame + 20, nil)
  end
  -- On frame 2 the lower layer's cel moves above the upper layer.
  lower:cel(2).zIndex = 1
  save(sprite, "linked-cels-and-z-index")
end

-- 5. Tags and slices.
do
  local sprite = Sprite(16, 16, ColorMode.RGB)
  for _ = 1, 5 do
    sprite:newFrame()
  end
  newImageCel(sprite, sprite.layers[1], 1, 16, 16, 0, 0, 4, nil)
  local walk = sprite:newTag(1, 4)
  walk.name = "walk"
  walk.aniDir = AniDir.FORWARD
  walk.color = Color { r = 255, g = 64, b = 0 }
  local bounce = sprite:newTag(3, 6)
  bounce.name = "bounce"
  bounce.aniDir = AniDir.PING_PONG
  bounce.repeats = 3
  bounce.color = Color { r = 0, g = 128, b = 255 }
  bounce.data = "overlaps walk"
  local back = sprite:newTag(5, 6)
  back.name = "back"
  back.aniDir = AniDir.REVERSE
  local button = sprite:newSlice(Rectangle(1, 2, 12, 9))
  button.name = "button"
  button.center = Rectangle(3, 3, 6, 3)
  button.pivot = Point(6, 8)
  button.data = "nine-slice"
  local hitbox = sprite:newSlice(Rectangle(4, 4, 5, 7))
  hitbox.name = "hitbox"
  save(sprite, "tags-and-slices")
end

-- 6. Indexed colour with a translucent palette entry, named colours and a non-zero
--    transparent index.
do
  local sprite = Sprite(8, 6, ColorMode.INDEXED)
  local palette = Palette(6)
  palette:setColor(0, Color { r = 20, g = 20, b = 30, a = 255 })
  palette:setColor(1, Color { r = 255, g = 0, b = 0, a = 255 })
  palette:setColor(2, Color { r = 0, g = 0, b = 0, a = 0 })
  palette:setColor(3, Color { r = 0, g = 200, b = 80, a = 255 })
  palette:setColor(4, Color { r = 40, g = 90, b = 255, a = 128 })
  palette:setColor(5, Color { r = 250, g = 240, b = 200, a = 255 })
  sprite:setPalette(palette)
  sprite.transparentColor = 2
  local image = Image(8, 6, ColorMode.INDEXED)
  for y = 0, 5 do
    for x = 0, 7 do
      image:drawPixel(x, y, (x + y * 3) % 6)
    end
  end
  sprite:newCel(sprite.layers[1], 1, image, Point(0, 0))
  save(sprite, "indexed")
end

-- 7. User data and typed properties on the sprite, layers, cels, tags and slices.
do
  local sprite = Sprite(4, 4, ColorMode.RGB)
  local layer = sprite.layers[1]
  local cel = newImageCel(sprite, layer, 1, 4, 4, 0, 0, 1, nil)
  sprite.data = "sprite text"
  sprite.color = Color { r = 10, g = 20, b = 30, a = 255 }
  sprite.properties.title = "corpus"
  sprite.properties.count = 42
  sprite.properties.ratio = 0.75
  sprite.properties.enabled = true
  sprite.properties.tags = { "a", "b", "c" }
  sprite.properties.nested = { depth = 2, label = "inner" }
  sprite.properties.big = 5000000000
  layer.data = "layer text"
  layer.color = Color { r = 200, g = 100, b = 0, a = 255 }
  layer.properties("kpixel-test/extension").speed = 3
  layer.properties("kpixel-test/extension").name = "fast"
  cel.data = "cel text"
  cel.color = Color { r = 0, g = 255, b = 0, a = 128 }
  cel.properties.frameNote = "first"
  local tag = sprite:newTag(1, 1)
  tag.name = "idle"
  tag.data = "tag text"
  tag.properties.loop = false
  local slice = sprite:newSlice(Rectangle(0, 0, 2, 2))
  slice.name = "corner"
  slice.color = Color { r = 1, g = 2, b = 3, a = 255 }
  slice.properties.kind = "spawn"
  save(sprite, "user-data")
end

-- 8. Sprite settings: pixel ratio, grid, a reference layer and a background layer.
do
  local sprite = Sprite(6, 6, ColorMode.RGB)
  sprite.pixelRatio = Size(2, 1)
  sprite.gridBounds = Rectangle(1, 2, 4, 3)
  local background = sprite.layers[1]
  newImageCel(sprite, background, 1, 6, 6, 0, 0, 8, nil)
  app.activeSprite = sprite
  app.activeLayer = background
  app.command.BackgroundFromLayer()
  local paint = sprite:newLayer()
  paint.name = "paint"
  newImageCel(sprite, paint, 1, 3, 3, 1, 1, 12, "holes")
  app.activeLayer = paint
  app.command.NewLayer { reference = true }
  local reference = app.activeLayer
  reference.name = "reference"
  newImageCel(sprite, reference, 1, 6, 6, 0, 0, 30, nil)
  save(sprite, "sprite-settings")
end

-- 9. Grayscale: grey and alpha pixels, and a translucent layer over them.
do
  local sprite = Sprite(5, 4, ColorMode.GRAYSCALE)
  local image = Image(5, 4, ColorMode.GRAYSCALE)
  for y = 0, 3 do
    for x = 0, 4 do
      image:drawPixel(x, y, app.pixelColor.graya((x * 60 + y * 20) % 256, (x + y) % 3 == 0 and 0 or 255))
    end
  end
  sprite:newCel(sprite.layers[1], 1, image, Point(0, 0))
  local top = sprite:newLayer()
  top.name = "top"
  local translucent = Image(3, 2, ColorMode.GRAYSCALE)
  for y = 0, 1 do
    for x = 0, 2 do
      translucent:drawPixel(x, y, app.pixelColor.graya(x * 90 + y * 40, 64 + x * 60 + y * 30))
    end
  end
  sprite:newCel(top, 1, translucent, Point(1, 1)).opacity = 128
  save(sprite, "grayscale")
end

-- 10. Tilemaps: a tileset with tile user data, a tilemap cel that uses every flip, and a second
--     frame where the tilemap is moved partly off the canvas and drawn translucent.
do
  local flipX, flipY, flipDiagonal = 0x80000000, 0x40000000, 0x20000000
  local sprite = Sprite(12, 9, ColorMode.RGB)
  sprite:newFrame()
  app.activeSprite = sprite
  local background = sprite.layers[1]
  background.name = "background"
  newImageCel(sprite, background, 1, 12, 9, 0, 0, 3, "holes")
  app.command.NewLayer { tilemap = true, gridBounds = Rectangle(0, 0, 3, 3) }
  local layer = app.activeLayer
  layer.name = "map"
  local tileset = layer.tileset
  tileset.name = "terrain"
  for seed = 1, 3 do
    paint(sprite:newTile(tileset).image, seed * 5, seed == 3 and "holes" or nil)
  end
  tileset:tile(1).data = "grass"
  tileset:tile(2).color = Color { r = 0, g = 0, b = 255, a = 255 }
  tileset:tile(3).properties.solid = true
  local flips = { 0, flipX, flipY, flipX | flipY, flipDiagonal, flipDiagonal | flipX, flipDiagonal | flipY, flipDiagonal | flipX | flipY }
  local map = Image(4, 3, ColorMode.TILEMAP)
  for y = 0, 2 do
    for x = 0, 3 do
      local cell = y * 4 + x
      map:drawPixel(x, y, app.pixelColor.tile(cell % 4, flips[cell % #flips + 1]))
    end
  end
  sprite:newCel(layer, 1, map, Point(0, 0))
  sprite:newCel(layer, 2, map, Point(-3, 3)).opacity = 140
  save(sprite, "tilemap")
end
