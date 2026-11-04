/**
 * txqr: transfer data through an animated sequence of QR codes, using a
 * fountain code so the receiver can join at any point and survive missed
 * frames.
 *
 * Pure ECMAScript: no DOM, TextEncoder or timers, so it runs in browsers,
 * Deno/Node/Bun and embedded engines such as QuickJS.
 * @module
 */

import { crc32, utf8Decode, utf8Encode } from "./bytes.ts";
import { formatFrame, parseFrame } from "./frame.ts";
import { blockCount, blockIndices, encodeBlock, Solver, splitBlocks } from "./fountain.ts";
import { ECC_LEVELS, qrImage, qrMatrix, qrRead, qrSVG } from "./qr.ts";

export { crc32, fromBase64, toBase64, utf8Decode, utf8Encode } from "./bytes.ts";

/** QR error correction level: L 7%, M 15%, Q 25%, H 30% recovery. */
export type Ecc = "low" | "medium" | "quartile" | "high";

/** How a frame is drawn as a QR code. */
export interface RenderOptions {
  /** Error correction level. Default "medium". */
  ecc?: Ecc;
  /** Rendered image width/height in pixels. Default 300. */
  size?: number;
  /** Quiet zone width in modules. Default 4. */
  border?: number;
}

/** Encoder settings; defaults follow the original Go txqr tools. */
export interface EncoderOptions extends RenderOptions {
  /** Payload bytes carried per frame. Default 100. */
  chunkSize?: number;
  /** Frames generated per source block, i.e. frameCount = blockCount * redundancy. Default 2. */
  redundancy?: number;
}

/** RGBA (or other `format`) pixel buffer; a canvas ImageData fits. */
export interface Image {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

/** Pixel layouts accepted when reading. Planar formats only use the Y plane. */
export type PixelFormat =
  | "RGBA" | "RGBX" | "BGRA" | "BGRX" | "RGB"
  | "I420" | "I422" | "I444" | "NV12";

/** QR reader settings, passed through to the underlying decoder. */
export interface ReadOptions {
  /** Pixel layout; RGB/RGBA is detected from the data length when omitted. */
  format?: PixelFormat;
  /** Retry effort; 1 is cheapest, Infinity tries hardest. */
  effort?: number;
  /** Milliseconds allowed for optional retries; defaults to one 60 FPS frame. */
  timeLimit?: number;
}

/** Decoder limits, guarding against hostile or corrupt headers. */
export interface DecoderOptions {
  /** Largest accepted message, in bytes. Default 64 MiB. */
  maxSize?: number;
  /** Largest accepted number of source blocks. Default 16384. */
  maxBlocks?: number;
}

/**
 * Default encoder settings (from the original txqr-gif tool). Frame timing
 * is the app's job; the original showed each frame for 200 ms (5 FPS).
 */
export const DEFAULTS: Readonly<Required<EncoderOptions>> = Object.freeze({
  chunkSize: 100,
  redundancy: 2,
  size: 300,
  ecc: "medium",
  border: 4,
});

function renderOpts(opts: RenderOptions = {}): Required<RenderOptions> {
  const ecc = opts.ecc ?? DEFAULTS.ecc;
  if (!ECC_LEVELS.includes(ecc)) throw new RangeError(`invalid ecc: ${ecc}`);
  const size = opts.size ?? DEFAULTS.size;
  const border = opts.border ?? DEFAULTS.border;
  if (!(Number.isInteger(size) && size > 0)) throw new RangeError(`invalid size: ${size}`);
  if (!(Number.isInteger(border) && border > 0)) throw new RangeError(`invalid border: ${border}`);
  return { ecc, size, border };
}

/** Renders any text (normally a frame) as a QR code SVG string. */
export function renderSVG(text: string, opts?: RenderOptions): string {
  return qrSVG(text, renderOpts(opts));
}

/** Renders text as a QR code RGBA image of size x size pixels. */
export function renderImage(text: string, opts?: RenderOptions): Image {
  return qrImage(text, renderOpts(opts));
}

/** Renders text as a QR module matrix (true = dark), quiet zone included. */
export function renderMatrix(text: string, opts?: RenderOptions): boolean[][] {
  return qrMatrix(text, renderOpts(opts));
}

/** Finds and decodes a QR code in an image; undefined if none is found. */
export function readQR(image: Image, opts?: ReadOptions): string | undefined {
  return qrRead(image, opts);
}

/** Splits data into QR frame texts. */
export class Encoder {
  /** Effective settings, defaults filled in. */
  readonly options: Readonly<Required<EncoderOptions>>;
  /** Message length in bytes. */
  readonly size: number;
  /** Number of source blocks (k). */
  readonly blockCount: number;
  /**
   * Number of frames in one animation loop. How long each is shown, and
   * the loop itself, are up to the app: cycle through 0..frameCount-1.
   */
  readonly frameCount: number;
  private _blocks: Uint8Array[];
  private _crc: number;
  private _frames: (string | undefined)[];

  /** Strings are encoded as UTF-8. */
  constructor(data: Uint8Array | string, options: EncoderOptions = {}) {
    const bytes = typeof data === "string" ? utf8Encode(data) : data;
    const o = { ...DEFAULTS, ...stripUndefined(options), ...renderOpts(options) };
    if (!(Number.isInteger(o.chunkSize) && o.chunkSize > 0)) {
      throw new RangeError(`invalid chunkSize: ${o.chunkSize}`);
    }
    if (!(o.redundancy >= 1)) throw new RangeError(`invalid redundancy: ${o.redundancy}`);
    this.options = Object.freeze(o);
    this.size = bytes.length;
    this._blocks = splitBlocks(bytes, o.chunkSize);
    this.blockCount = this._blocks.length;
    this._crc = crc32(bytes);
    // A single block gains nothing from repetition within a loop.
    this.frameCount = this.blockCount === 1 ? 1 : Math.ceil(this.blockCount * o.redundancy);
    this._frames = new Array(this.frameCount);
  }

  /**
   * Frame text for a block code. Codes past frameCount are valid too: the
   * fountain never runs dry, so a sender may keep producing fresh frames.
   */
  frame(code: number): string {
    if (!(Number.isInteger(code) && code >= 0 && code < 1e9)) {
      throw new RangeError(`invalid frame code: ${code}`);
    }
    const cached = this._frames[code];
    if (cached !== undefined) return cached;
    const text = formatFrame({
      code,
      chunkSize: this.options.chunkSize,
      size: this.size,
      crc: this._crc,
      data: encodeBlock(this._blocks, code),
    });
    if (code < this.frameCount) this._frames[code] = text;
    return text;
  }

  /** All frames of one animation loop. */
  frames(): string[] {
    return Array.from({ length: this.frameCount }, (_, i) => this.frame(i));
  }

  /** Frame `code` as an SVG string, using this encoder's render settings. */
  renderSVG(code: number): string {
    return qrSVG(this.frame(code), this.options);
  }

  /** Frame `code` as an RGBA image, using this encoder's render settings. */
  renderImage(code: number): Image {
    return qrImage(this.frame(code), this.options);
  }

  /** Frame `code` as a module matrix, using this encoder's render settings. */
  renderMatrix(code: number): boolean[][] {
    return qrMatrix(this.frame(code), this.options);
  }
}

/** Convenience: all frame texts of one loop for the given data. */
export function encode(data: Uint8Array | string, options?: EncoderOptions): string[] {
  return new Encoder(data, options).frames();
}

/**
 * Reassembles a message from frames, in any order, with gaps and repeats.
 *
 * Feed it in one of two ways:
 * - {@link Decoder.pushImage}: camera pixels; the QR code is read in JS.
 * - {@link Decoder.push} / {@link Decoder.pushBytes}: the content of a QR code
 *   your host already decoded (e.g. natively with ZXing or a platform
 *   scanner), so no QR decoding runs in JS at all.
 *
 * Frames from a different transfer (other size, chunk size or checksum)
 * restart the decoder while incomplete; once complete it ignores everything
 * until {@link Decoder.reset}.
 */
export class Decoder {
  private _maxSize: number;
  private _maxBlocks: number;
  private _key = "";
  private _size = 0;
  private _chunkSize = 0;
  private _k = 0;
  private _crc = 0;
  private _solver: Solver | undefined;
  private _seen = new Set<number>();
  private _result: Uint8Array | undefined;

  constructor(options: DecoderOptions = {}) {
    this._maxSize = options.maxSize ?? 64 * 1024 * 1024;
    this._maxBlocks = options.maxBlocks ?? 16384;
  }

  /** Whether a decoded QR code's content (text or raw bytes) is a txqr frame. */
  static isFrame(frame: string | Uint8Array | ArrayBuffer): boolean {
    return parseFrame(frameText(frame)) !== undefined;
  }

  /**
   * Adds the text content of one decoded QR code. Use this (or
   * {@link Decoder.pushBytes}) when the QR code was decoded outside this
   * library, so no QR decoding runs in JS. Returns true once the message is
   * complete. Throws on text that isn't a txqr frame (check with
   * {@link Decoder.isFrame} first if the scanner may see other QR codes).
   */
  push(text: string): boolean {
    if (this._result) return true;
    const f = parseFrame(text);
    if (!f) throw new TypeError(`invalid txqr frame: ${JSON.stringify(text.slice(0, 40))}`);
    const key = `${f.chunkSize}/${f.size}/${f.crc}`;
    if (key !== this._key) this._start(key, f.size, f.chunkSize, f.crc);
    // Cameras see the same frame many times in a row; skip repeats cheaply.
    if (this._seen.has(f.code)) return false;
    this._seen.add(f.code);

    const solver = this._solver!;
    solver.add(blockIndices(f.code, this._k), f.data);
    if (solver.rank < this._k) return false;

    const out = new Uint8Array(this._size);
    solver.solve().forEach((b, i) => out.set(b.subarray(0, Math.min(b.length, this._size - i * b.length)), i * b.length));
    if (crc32(out) !== this._crc) {
      this.reset();
      throw new Error("txqr: checksum mismatch in reassembled data");
    }
    this._result = out;
    this._solver = undefined;
    return true;
  }

  /**
   * Like {@link Decoder.push}, for a QR code's raw payload bytes as returned
   * by native decoders (e.g. ZXing's `bytes()`), or bytes handed over from a
   * host as an ArrayBuffer. Frames are ASCII, so the bytes are the frame text.
   * Returns true once the message is complete; throws on non-frames.
   */
  pushBytes(bytes: Uint8Array | ArrayBuffer): boolean {
    return this.push(frameText(bytes));
  }

  /**
   * Reads a QR code from image pixels in JS and pushes it if it's a txqr
   * frame; other QR codes and frames without one are ignored. To skip
   * JS-side QR decoding, decode natively and use {@link Decoder.push} or
   * {@link Decoder.pushBytes} instead. Returns true once the message is
   * complete.
   */
  pushImage(image: Image, opts?: ReadOptions): boolean {
    const text = qrRead(image, opts);
    if (text === undefined || !Decoder.isFrame(text)) return this.complete;
    return this.push(text);
  }

  private _start(key: string, size: number, chunkSize: number, crc: number): void {
    const k = blockCount(size, chunkSize);
    if (size > this._maxSize) throw new RangeError(`txqr: message of ${size} bytes exceeds maxSize`);
    if (k > this._maxBlocks) throw new RangeError(`txqr: ${k} blocks exceeds maxBlocks`);
    this.reset();
    this._key = key;
    this._size = size;
    this._chunkSize = chunkSize;
    this._k = k;
    this._crc = crc;
    this._solver = new Solver(k);
  }

  /** Whether the whole message has been recovered. */
  get complete(): boolean {
    return this._result !== undefined;
  }

  /** Message size in bytes (0 until the first frame). */
  get size(): number {
    return this._size;
  }

  /** Chunk size of the current transfer (0 until the first frame). */
  get chunkSize(): number {
    return this._chunkSize;
  }

  /** Number of source blocks needed (0 until the first frame). */
  get blockCount(): number {
    return this._k;
  }

  /** Distinct frames received for the current transfer. */
  get received(): number {
    return this._seen.size;
  }

  /** Fraction recovered so far, 0..1. */
  get progress(): number {
    if (this._result) return 1;
    return this._k === 0 ? 0 : this._solver!.rank / this._k;
  }

  /** The recovered message. Throws if not complete. */
  bytes(): Uint8Array {
    if (!this._result) throw new Error("txqr: message not complete");
    return this._result;
  }

  /** The recovered message decoded as UTF-8. Throws if not complete. */
  text(): string {
    return utf8Decode(this.bytes());
  }

  /** Forgets everything, ready for a new transfer. */
  reset(): void {
    this._key = "";
    this._size = this._chunkSize = this._k = this._crc = 0;
    this._solver = this._result = undefined;
    this._seen = new Set();
  }
}

// Frames are ASCII, so bytes map 1:1 to characters; anything else fails parsing.
function frameText(frame: string | Uint8Array | ArrayBuffer): string {
  if (typeof frame === "string") return frame;
  const bytes = ArrayBuffer.isView(frame)
    ? new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength)
    : new Uint8Array(frame);
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 8192)));
  }
  return out;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}
