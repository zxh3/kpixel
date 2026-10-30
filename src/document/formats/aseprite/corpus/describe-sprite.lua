-- Prints everything Aseprite knows about a sprite, as Aseprite itself sees it, in a stable text
-- form. Two files with the same description are the same sprite to Aseprite. Used by the
-- compatibility tests to check files written by kpixel.
--
--   aseprite --batch --script-param file=sprite.aseprite --script describe-sprite.lua

local sprite = app.open(app.params["file"])

local function color(value)
  if not value then
    return "none"
  end
  return string.format("%d,%d,%d,%d", value.red, value.green, value.blue, value.alpha)
end

-- json.encode sorts keys, so equal properties print equally.
local function userData(object, extensions)
  local properties = { user = object.properties }
  for _, extension in ipairs(extensions) do
    properties[extension] = object.properties(extension)
  end
  return string.format("data=%q color=%s properties=%s", object.data or "", color(object.color), json.encode(properties))
end

-- Extension namespaces aren't listed by the API, so the caller names the ones to check.
local extensions = {}
for extension in string.gmatch(app.params["extensions"] or "", "[^,]+") do
  extensions[#extensions + 1] = extension
end

print("sprite", sprite.width, sprite.height, sprite.colorMode, #sprite.frames, sprite.transparentColor,
  sprite.pixelRatio.width .. "x" .. sprite.pixelRatio.height,
  string.format("grid=%d,%d,%d,%d", sprite.gridBounds.x, sprite.gridBounds.y, sprite.gridBounds.width, sprite.gridBounds.height),
  userData(sprite, extensions))

for _, frame in ipairs(sprite.frames) do
  print("frame", frame.frameNumber, math.floor(frame.duration * 1000 + 0.5))
end

local function describeLayers(layers, depth)
  for _, layer in ipairs(layers) do
    print("layer", depth, layer.name, layer.isGroup, layer.isVisible, layer.isEditable, layer.opacity, layer.blendMode,
      layer.isBackground, layer.isReference, layer.isGroup and layer.isCollapsed or false, userData(layer, extensions))
    if layer.isGroup then
      describeLayers(layer.layers, depth + 1)
    end
  end
end
describeLayers(sprite.layers, 0)

for _, cel in ipairs(sprite.cels) do
  local linked = {}
  for _, other in ipairs(sprite.cels) do
    if other ~= cel and other.layer == cel.layer and other.image == cel.image then
      linked[#linked + 1] = other.frameNumber
    end
  end
  print("cel", cel.layer.name, cel.frameNumber, cel.position.x, cel.position.y, cel.opacity, cel.zIndex,
    cel.image.width .. "x" .. cel.image.height, "linked=" .. table.concat(linked, ","), userData(cel, extensions))
end

for _, tag in ipairs(sprite.tags) do
  print("tag", tag.name, tag.fromFrame.frameNumber, tag.toFrame.frameNumber, tag.aniDir, tag.repeats, color(tag.color),
    userData(tag, extensions))
end

for _, slice in ipairs(sprite.slices) do
  local center = slice.center and string.format("%d,%d,%d,%d", slice.center.x, slice.center.y, slice.center.width, slice.center.height) or "none"
  local pivot = slice.pivot and string.format("%d,%d", slice.pivot.x, slice.pivot.y) or "none"
  print("slice", slice.name, string.format("%d,%d,%d,%d", slice.bounds.x, slice.bounds.y, slice.bounds.width, slice.bounds.height),
    "center=" .. center, "pivot=" .. pivot, userData(slice, extensions))
end

-- sprite.palettes raises an error past its end rather than returning nil, so index it by count.
for index = 1, #sprite.palettes do
  local palette = sprite.palettes[index]
  local colors = {}
  for entry = 0, #palette - 1 do
    colors[#colors + 1] = color(palette:getColor(entry))
  end
  print("palette", index, #palette, table.concat(colors, " "))
end
