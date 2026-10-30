import * as fc from "fast-check";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";

import type { SpriteDocument, UserData } from "../../schema";

import { renderFrame } from "../../render-frame";
import { canonicalDocument } from "../../test-support/canonical-document";
import { editedDocumentArbitrary } from "../../test-support/random-documents";
import { decodePng } from "../png";
import { asepriteDataNamespace, readAseprite, writeAseprite } from "./index";

// Checks kpixel's files against a real Aseprite. Skipped where Aseprite isn't installed, such as
// CI; set ASEPRITE to its binary if it isn't at the Steam default.

const asepriteBinary =
  process.env.ASEPRITE ??
  join(
    homedir(),
    "Library/Application Support/Steam/steamapps/common/Aseprite/Aseprite.app/Contents/MacOS/aseprite",
  );
const corpusDirectory = join(__dirname, "corpus");
const corpus = [
  "basics",
  "blend-modes",
  "groups",
  "linked-cels-and-z-index",
  "tags-and-slices",
  "indexed",
  "user-data",
  "sprite-settings",
  "grayscale",
  "tilemap",
];

const workDirectory = mkdtempSync(join(tmpdir(), "kpixel-aseprite-"));
afterAll(() => rmSync(workDirectory, { recursive: true, force: true }));

function aseprite(args: string[]): string {
  return execFileSync(asepriteBinary, ["--batch", ...args], { encoding: "utf8" });
}

/** Aseprite's own description of a sprite (see corpus/describe-sprite.lua). */
function describeSprite(file: string): string {
  return aseprite([
    "--script-param",
    `file=${file}`,
    "--script-param",
    "extensions=kpixel-test/extension",
    "--script",
    join(corpusDirectory, "describe-sprite.lua"),
  ]);
}

/**
 * Aseprite's flattened render of every frame, as RGBA. Sprites are converted to RGB first: saving
 * an indexed sprite to PNG ignores cel and layer opacity, which an indexed PNG can't hold.
 */
function asepriteRenders(file: string, name: string): Uint8Array[] {
  const directory = mkdtempSync(join(workDirectory, `${name}-`));
  aseprite([file, "--color-mode", "rgb", "--save-as", join(directory, "frame-{frame0}.png")]);
  return readdirSync(directory)
    .toSorted((a, b) => Number.parseInt(a.slice(6)) - Number.parseInt(b.slice(6)))
    .map((entry) => toRgba(readFileSync(join(directory, entry))));
}

function toRgba(png: Uint8Array): Uint8Array {
  const raster = decodePng(png);
  if (raster.kind === "rgba") return raster.pixels;
  const rgba = new Uint8Array(raster.pixels.length * 4);
  raster.pixels.forEach((index, pixel) => {
    const color = raster.palette[index]!;
    rgba.set([color >>> 24, (color >>> 16) & 0xff, (color >>> 8) & 0xff, color & 0xff], pixel * 4);
  });
  return rgba;
}

describe.skipIf(!existsSync(asepriteBinary))("compatibility with Aseprite", () => {
  test.each(corpus)(
    "Aseprite sees %s unchanged after kpixel rewrites it",
    (name) => {
      const original = join(corpusDirectory, `${name}.aseprite`);
      const rewritten = join(workDirectory, `${name}.aseprite`);
      writeFileSync(rewritten, writeAseprite(readAseprite(readFileSync(original)).document));

      expect(describeSprite(rewritten)).toBe(describeSprite(original));
      const before = asepriteRenders(original, `${name}-original`);
      const after = asepriteRenders(rewritten, `${name}-rewritten`);
      expect(after).toEqual(before);
    },
    60_000,
  );

  test("documents made in kpixel survive Aseprite opening and saving them", () => {
    for (const [index, document] of fc
      .sample(editedDocumentArbitrary, { numRuns: 30, seed: 2026 })
      .entries()) {
      const written = join(workDirectory, `kpixel-${index}.aseprite`);
      const resaved = join(workDirectory, `kpixel-${index}-resaved.aseprite`);
      writeFileSync(written, writeAseprite(document));
      aseprite([written, "--save-as", resaved]);

      const reopened = readAseprite(readFileSync(resaved));
      expect(reopened.warnings).toEqual([]);
      expect(canonicalDocument(asAsepriteSaves(reopened.document))).toStrictEqual(
        canonicalDocument(asAsepriteSaves(document)),
      );
    }
  }, 120_000);

  test("Aseprite renders kpixel's files like kpixel does", () => {
    for (const [index, document] of fc
      .sample(editedDocumentArbitrary, { numRuns: 12, seed: 7 })
      .entries()) {
      const file = join(workDirectory, `render-${index}.aseprite`);
      writeFileSync(file, writeAseprite(document));
      const renders = asepriteRenders(file, `render-${index}`);
      for (const [frameIndex, frame] of document.frames.entries()) {
        const ours = renderFrame(document, frame.id);
        const theirs = renders[frameIndex]!;
        for (let offset = 0; offset < ours.length; offset += 4) {
          if (ours[offset + 3] === 0 && theirs[offset + 3] === 0) continue;
          for (let channel = 0; channel < 4; channel++) {
            expect(
              Math.abs(ours[offset + channel]! - theirs[offset + channel]!),
            ).toBeLessThanOrEqual(2);
          }
        }
      }
    }
  }, 120_000);
});

/**
 * Applies what Aseprite itself changes when it saves a file, so documents can be compared after
 * Aseprite re-saves them. Anything else that differs is a kpixel bug.
 *
 * - Unless its "composite groups separately" preference is on, Aseprite saves without that flag
 *   and drops group opacity and blend modes.
 * - It resets the transparent index of RGBA and grayscale sprites, where it has no effect, to 0.
 * - It drops user data whose text is empty.
 * - It reorders slices.
 */
function asAsepriteSaves(document: SpriteDocument): SpriteDocument {
  const storedData = document.userData?.properties?.[asepriteDataNamespace];
  const spriteData: Record<string, unknown> =
    typeof storedData === "object" && storedData !== null ? { ...storedData } : {};
  delete spriteData.compositeGroupsSeparately;
  const properties = { ...document.userData?.properties };
  if (Object.keys(spriteData).length > 0) properties[asepriteDataNamespace] = spriteData;
  else delete properties[asepriteDataNamespace];
  const { properties: _properties, ...spriteUserData } = document.userData ?? {};
  const userData: UserData =
    Object.keys(properties).length > 0 ? { ...spriteUserData, properties } : spriteUserData;

  const normalized: SpriteDocument = withoutEmptyText({
    ...document,
    userData,
    transparentIndex: document.colorMode === "indexed" ? document.transparentIndex : 0,
    layers: Object.fromEntries(
      Object.entries(document.layers).map(([id, layer]) => [
        id,
        withoutEmptyText(
          layer.kind === "group" ? { ...layer, opacity: 255, blendMode: "normal" as const } : layer,
        ),
      ]),
    ),
    celData: Object.fromEntries(
      Object.entries(document.celData).map(([id, celData]) => [id, withoutEmptyText(celData)]),
    ),
    tags: document.tags.map(withoutEmptyText),
    tilesets: document.tilesets.map((tileset) =>
      withoutEmptyText({ ...tileset, tiles: tileset.tiles.map(withoutEmptyText) }),
    ),
    slices: document.slices
      .map(withoutEmptyText)
      .toSorted((a, b) =>
        JSON.stringify({ ...a, id: "" }).localeCompare(JSON.stringify({ ...b, id: "" })),
      ),
  });
  if (normalized.userData && Object.keys(normalized.userData).length === 0) {
    const { userData: _empty, ...rest } = normalized;
    return rest;
  }
  return normalized;
}

/** Drops user data whose text is empty and which holds nothing else, as Aseprite does. */
function withoutEmptyText<T extends { userData?: UserData }>(entity: T): T {
  if (entity.userData?.text !== "") return entity;
  const { text: _empty, ...rest } = entity.userData;
  if (Object.keys(rest).length > 0) return { ...entity, userData: rest };
  const copy = { ...entity };
  delete copy.userData;
  return copy;
}
