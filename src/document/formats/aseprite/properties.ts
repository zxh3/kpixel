import type { ByteReader, ByteWriter } from "./binary";

import { FileFormatError } from "../../errors";

// Aseprite user data can hold typed property maps: one for the user (key 0) and one per
// extension. In kpixel they live in UserData.properties as JSON, keyed by namespace.
//
// JSON stays natural wherever it round-trips exactly: booleans, strings, 32-bit integers,
// non-integer doubles, arrays and objects. Any other type is wrapped as
// { "$type": "int16", "value": 5 }, so files keep their exact property types.

export type PropertyValue =
  | { kind: "bool"; value: boolean }
  | { kind: "int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32"; value: number }
  | { kind: "int64" | "uint64"; value: bigint }
  | { kind: "fixed" | "float" | "double"; value: number }
  | { kind: "string" | "uuid"; value: string }
  | { kind: "point"; value: { x: number; y: number } }
  | { kind: "size"; value: { width: number; height: number } }
  | { kind: "rect"; value: { x: number; y: number; width: number; height: number } }
  /** elementType is the shared type id of all items, or 0 when items carry their own. */
  | { kind: "vector"; elementType: number; items: PropertyValue[] }
  | { kind: "map"; entries: [string, PropertyValue][] };

type PropertyKind = PropertyValue["kind"];

/** A properties map: key 0 for user properties, otherwise an external-files entry id. */
export interface PropertyMap {
  key: number;
  entries: [string, PropertyValue][];
}

const typeIds: Record<PropertyKind, number> = {
  bool: 0x01,
  int8: 0x02,
  uint8: 0x03,
  int16: 0x04,
  uint16: 0x05,
  int32: 0x06,
  uint32: 0x07,
  int64: 0x08,
  uint64: 0x09,
  fixed: 0x0a,
  float: 0x0b,
  double: 0x0c,
  string: 0x0d,
  point: 0x0e,
  size: 0x0f,
  rect: 0x10,
  vector: 0x11,
  map: 0x12,
  uuid: 0x13,
};
const kindsById = new Map(Object.entries(typeIds).map(([kind, id]) => [id, kind as PropertyKind])); // oxlint-disable-line typescript/no-unsafe-type-assertion -- keys of typeIds are PropertyKinds

const maxDepth = 128;

// Binary

export function readPropertyMaps(reader: ByteReader): PropertyMap[] {
  const size = reader.dword();
  const body = reader.sub(size - 4);
  return body.array(body.dword(), 8, () => ({
    key: body.dword(),
    entries: readEntries(body, 0),
  }));
}

function readEntries(reader: ByteReader, depth: number): [string, PropertyValue][] {
  return reader.array(reader.dword(), 4, () => {
    const name = reader.string();
    return [name, readValue(reader, reader.word(), depth)];
  });
}

function readValue(reader: ByteReader, typeId: number, depth: number): PropertyValue {
  if (depth > maxDepth) {
    throw new FileFormatError("user data properties are nested too deeply");
  }
  const kind = kindsById.get(typeId);
  switch (kind) {
    case "bool":
      return { kind, value: reader.byte() !== 0 };
    case "int8":
      return { kind, value: reader.int8() };
    case "uint8":
      return { kind, value: reader.byte() };
    case "int16":
      return { kind, value: reader.short() };
    case "uint16":
      return { kind, value: reader.word() };
    case "int32":
      return { kind, value: reader.long() };
    case "uint32":
      return { kind, value: reader.dword() };
    case "int64":
      return { kind, value: reader.long64() };
    case "uint64":
      return { kind, value: reader.qword() };
    case "fixed":
      return { kind, value: reader.fixed() };
    case "float":
      return { kind, value: reader.float() };
    case "double":
      return { kind, value: reader.double() };
    case "string":
      return { kind, value: reader.string() };
    case "uuid":
      return { kind, value: reader.uuid() };
    case "point":
      return { kind, value: { x: reader.long(), y: reader.long() } };
    case "size":
      return { kind, value: { width: reader.long(), height: reader.long() } };
    case "rect":
      return {
        kind,
        value: { x: reader.long(), y: reader.long(), width: reader.long(), height: reader.long() },
      };
    case "vector": {
      const count = reader.dword();
      const elementType = reader.word();
      // Each item takes at least one byte, plus a two-byte type when types are mixed.
      const items = reader.array(count, elementType === 0 ? 3 : 1, () =>
        readValue(reader, elementType === 0 ? reader.word() : elementType, depth + 1),
      );
      return { kind, elementType, items };
    }
    case "map":
      return { kind, entries: readEntries(reader, depth + 1) };
    case undefined:
    default:
      throw new FileFormatError(`unknown user data property type ${typeId}`);
  }
}

export function writePropertyMaps(writer: ByteWriter, maps: PropertyMap[]): void {
  const start = writer.length;
  writer.dword(0); // total size, patched below
  writer.dword(maps.length);
  for (const map of maps) {
    writer.dword(map.key);
    writeEntries(writer, map.entries);
  }
  writer.patchDword(start, writer.length - start);
}

function writeEntries(writer: ByteWriter, entries: [string, PropertyValue][]) {
  writer.dword(entries.length);
  for (const [name, value] of entries) {
    writer.string(name);
    writer.word(typeIds[value.kind]);
    writeValue(writer, value);
  }
}

function writeValue(writer: ByteWriter, property: PropertyValue) {
  switch (property.kind) {
    case "bool":
      return writer.byte(property.value ? 1 : 0);
    case "int8":
      return writer.int8(property.value);
    case "uint8":
      return writer.byte(property.value);
    case "int16":
      return writer.short(property.value);
    case "uint16":
      return writer.word(property.value);
    case "int32":
      return writer.long(property.value);
    case "uint32":
      return writer.dword(property.value);
    case "int64":
      return writer.long64(property.value);
    case "uint64":
      return writer.qword(property.value);
    case "fixed":
      return writer.fixed(property.value);
    case "float":
      return writer.float(property.value);
    case "double":
      return writer.double(property.value);
    case "string":
      return writer.string(property.value);
    case "uuid":
      return writer.uuid(property.value);
    case "point":
      writer.long(property.value.x);
      return writer.long(property.value.y);
    case "size":
      writer.long(property.value.width);
      return writer.long(property.value.height);
    case "rect":
      writer.long(property.value.x);
      writer.long(property.value.y);
      writer.long(property.value.width);
      return writer.long(property.value.height);
    case "vector":
      writer.dword(property.items.length);
      writer.word(property.elementType);
      for (const item of property.items) {
        if (property.elementType === 0) {
          writer.word(typeIds[item.kind]);
        }
        writeValue(writer, item);
      }
      return;
    case "map":
      return writeEntries(writer, property.entries);
  }
}

// JSON

/** Converts a property value to JSON, natural where that round-trips exactly. */
export function propertyToJson(property: PropertyValue): unknown {
  switch (property.kind) {
    case "bool":
    case "string":
      return property.value;
    case "int32":
      return property.value;
    case "double":
      return isPlainNumberDouble(property.value)
        ? property.value
        : wrap(property.kind, property.value);
    case "vector": {
      const items = property.items.map(propertyToJson);
      return inferElementType(property.items) === property.elementType
        ? items
        : { $type: "vector", elementType: property.elementType, value: items };
    }
    case "map": {
      const object = entriesToJson(property.entries);
      return "$type" in object ? { $type: "map", value: object } : object;
    }
    case "int64":
    case "uint64":
      return wrap(property.kind, property.value.toString());
    case "int8":
    case "uint8":
    case "int16":
    case "uint16":
    case "uint32":
    case "fixed":
    case "float":
    case "uuid":
    case "point":
    case "size":
    case "rect":
      return wrap(property.kind, property.value);
    default:
      throw new Error(`Unhandled property kind: ${JSON.stringify(property)}`);
  }
}

export function entriesToJson(entries: [string, PropertyValue][]): Record<string, unknown> {
  return Object.fromEntries(entries.map(([name, value]) => [name, propertyToJson(value)]));
}

/** Converts JSON back to a property value, inferring types for natural JSON. */
export function propertyFromJson(json: unknown, path = "property"): PropertyValue {
  if (typeof json === "boolean") {
    return { kind: "bool", value: json };
  }
  if (typeof json === "string") {
    return { kind: "string", value: json };
  }
  if (typeof json === "number") {
    return Number.isInteger(json) && json >= -2_147_483_648 && json <= 2_147_483_647
      ? { kind: "int32", value: json }
      : { kind: "double", value: json };
  }
  if (Array.isArray(json)) {
    const items = json.map((item, index) => propertyFromJson(item, `${path}[${index}]`));
    return { kind: "vector", elementType: inferElementType(items), items };
  }
  if (typeof json === "object" && json !== null) {
    const record = Object.fromEntries(Object.entries(json));
    return typeof record.$type === "string"
      ? wrappedFromJson(record, path)
      : { kind: "map", entries: entriesFromJson(record, path) };
  }
  throw new RangeError(`${path} can't be stored in an Aseprite file: ${String(json)}`);
}

export function entriesFromJson(
  object: Record<string, unknown>,
  path = "properties",
): [string, PropertyValue][] {
  return Object.entries(object).map(([name, value]) => [
    name,
    propertyFromJson(value, `${path}.${name}`),
  ]);
}

function wrappedFromJson(record: Record<string, unknown>, path: string): PropertyValue {
  const { $type: kind, value } = record;
  const fail = () => {
    throw new RangeError(`${path} has an invalid ${String(kind)} value`);
  };
  switch (kind) {
    case "int8":
    case "uint8":
    case "int16":
    case "uint16":
    case "int32":
    case "uint32":
    case "fixed":
    case "float":
    case "double":
      return typeof value === "number" ? { kind, value } : fail();
    case "int64":
    case "uint64":
      return typeof value === "string" ? { kind, value: BigInt(value) } : fail();
    case "uuid":
      return typeof value === "string" ? { kind, value } : fail();
    case "point":
    case "size":
    case "rect":
      return isNumberRecord(value) ? ({ kind, value } as PropertyValue) : fail(); // oxlint-disable-line typescript/no-unsafe-type-assertion -- field names are checked when written
    case "vector": {
      if (!Array.isArray(value) || typeof record.elementType !== "number") return fail();
      return {
        kind,
        elementType: record.elementType,
        items: value.map((item, index) => propertyFromJson(item, `${path}[${index}]`)),
      };
    }
    case "map":
      return typeof value === "object" && value !== null && !Array.isArray(value)
        ? { kind, entries: entriesFromJson(Object.fromEntries(Object.entries(value)), path) }
        : fail();
    default:
      return fail();
  }
}

function wrap(kind: PropertyKind, value: unknown) {
  return { $type: kind, value };
}

/** A double that natural JSON would read back as a double rather than an int32. */
function isPlainNumberDouble(value: number): boolean {
  return (
    Number.isFinite(value) &&
    !(Number.isInteger(value) && value >= -2_147_483_648 && value <= 2_147_483_647)
  );
}

/** The vector element type that natural JSON implies: shared if all items agree, else 0. */
function inferElementType(items: PropertyValue[]): number {
  const [first, ...rest] = items.map((item) => typeIds[item.kind]);
  return first !== undefined && rest.every((id) => id === first) ? first : 0;
}

function isNumberRecord(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((field) => typeof field === "number")
  );
}
