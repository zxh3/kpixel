import { FileFormatError } from "../../errors";

// Little-endian primitives used by the .aseprite format, named after the spec's types
// (https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md#references).

const textDecoder = new TextDecoder("utf-8", { fatal: false });
const textEncoder = new TextEncoder();

export class ByteReader {
  readonly #view: DataView;
  readonly #bytes: Uint8Array;
  #offset: number;
  readonly #end: number;

  constructor(bytes: Uint8Array, start = 0, end = bytes.length) {
    this.#bytes = bytes;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.#offset = start;
    this.#end = end;
  }

  get offset(): number {
    return this.#offset;
  }

  get remaining(): number {
    return this.#end - this.#offset;
  }

  /** A reader over the next `length` bytes, advancing past them. */
  sub(length: number): ByteReader {
    this.#need(length);
    const reader = new ByteReader(this.#bytes, this.#offset, this.#offset + length);
    this.#offset += length;
    return reader;
  }

  /**
   * Reads `count` items. Counts come from the file, so check first that the bytes left can
   * hold them at `minBytesEach` each: a damaged count must not trigger a huge allocation.
   */
  array<T>(count: number, minBytesEach: number, read: (index: number) => T): T[] {
    if (count * minBytesEach > this.remaining) {
      throw new FileFormatError("the file is truncated or damaged");
    }
    return Array.from({ length: count }, (_, index) => read(index));
  }

  skip(length: number): void {
    this.#need(length);
    this.#offset += length;
  }

  byte(): number {
    this.#need(1);
    return this.#view.getUint8(this.#offset++);
  }

  int8(): number {
    this.#need(1);
    return this.#view.getInt8(this.#offset++);
  }

  word(): number {
    return this.#read(2, (offset) => this.#view.getUint16(offset, true));
  }

  short(): number {
    return this.#read(2, (offset) => this.#view.getInt16(offset, true));
  }

  dword(): number {
    return this.#read(4, (offset) => this.#view.getUint32(offset, true));
  }

  long(): number {
    return this.#read(4, (offset) => this.#view.getInt32(offset, true));
  }

  qword(): bigint {
    return this.#read(8, (offset) => this.#view.getBigUint64(offset, true));
  }

  long64(): bigint {
    return this.#read(8, (offset) => this.#view.getBigInt64(offset, true));
  }

  /** A 16.16 fixed-point number. */
  fixed(): number {
    return this.long() / 65_536;
  }

  float(): number {
    return this.#read(4, (offset) => this.#view.getFloat32(offset, true));
  }

  double(): number {
    return this.#read(8, (offset) => this.#view.getFloat64(offset, true));
  }

  bytes(length: number): Uint8Array {
    this.#need(length);
    const slice = this.#bytes.slice(this.#offset, this.#offset + length);
    this.#offset += length;
    return slice;
  }

  string(): string {
    return textDecoder.decode(this.bytes(this.word()));
  }

  /** A UUID, formatted as a lowercase hyphenated string. */
  uuid(): string {
    const hex = Array.from(this.bytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  #read<T>(length: number, read: (offset: number) => T): T {
    this.#need(length);
    const value = read(this.#offset);
    this.#offset += length;
    return value;
  }

  #need(length: number) {
    if (length < 0 || this.#offset + length > this.#end) {
      throw new FileFormatError("the file is truncated or damaged");
    }
  }
}

export class ByteWriter {
  #bytes = new Uint8Array(1024);
  #view = new DataView(this.#bytes.buffer);
  #length = 0;

  get length(): number {
    return this.#length;
  }

  /** The bytes written so far. */
  toBytes(): Uint8Array {
    return this.#bytes.slice(0, this.#length);
  }

  byte(value: number): void {
    this.#write(1, (offset) => this.#view.setUint8(offset, value));
  }

  int8(value: number): void {
    this.#write(1, (offset) => this.#view.setInt8(offset, value));
  }

  word(value: number): void {
    this.#write(2, (offset) => this.#view.setUint16(offset, value, true));
  }

  short(value: number): void {
    this.#write(2, (offset) => this.#view.setInt16(offset, value, true));
  }

  dword(value: number): void {
    this.#write(4, (offset) => this.#view.setUint32(offset, value, true));
  }

  long(value: number): void {
    this.#write(4, (offset) => this.#view.setInt32(offset, value, true));
  }

  qword(value: bigint): void {
    this.#write(8, (offset) => this.#view.setBigUint64(offset, value, true));
  }

  long64(value: bigint): void {
    this.#write(8, (offset) => this.#view.setBigInt64(offset, value, true));
  }

  fixed(value: number): void {
    this.long(Math.round(value * 65_536));
  }

  float(value: number): void {
    this.#write(4, (offset) => this.#view.setFloat32(offset, value, true));
  }

  double(value: number): void {
    this.#write(8, (offset) => this.#view.setFloat64(offset, value, true));
  }

  zeros(length: number): void {
    this.#reserve(length);
    this.#length += length; // new buffer space is already zeroed
  }

  bytes(bytes: Uint8Array): void {
    this.#reserve(bytes.length);
    this.#bytes.set(bytes, this.#length);
    this.#length += bytes.length;
  }

  string(value: string): void {
    const encoded = textEncoder.encode(value);
    if (encoded.length > 0xff_ff) {
      throw new RangeError(`a string of ${encoded.length} bytes is too long for .aseprite`);
    }
    this.word(encoded.length);
    this.bytes(encoded);
  }

  uuid(value: string): void {
    const hex = value.replaceAll("-", "");
    for (let index = 0; index < 32; index += 2) {
      this.byte(Number.parseInt(hex.slice(index, index + 2), 16));
    }
  }

  /** Overwrites a DWORD written earlier, e.g. a size known only once its content is written. */
  patchDword(offset: number, value: number): void {
    this.#view.setUint32(offset, value, true);
  }

  #write(length: number, write: (offset: number) => void) {
    this.#reserve(length);
    write(this.#length);
    this.#length += length;
  }

  #reserve(length: number) {
    if (this.#length + length <= this.#bytes.length) {
      return;
    }
    let capacity = this.#bytes.length * 2;
    while (capacity < this.#length + length) {
      capacity *= 2;
    }
    const grown = new Uint8Array(capacity);
    grown.set(this.#bytes.subarray(0, this.#length));
    this.#bytes = grown;
    this.#view = new DataView(grown.buffer);
  }
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
