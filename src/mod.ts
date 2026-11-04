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
  /** How long each frame stays on screen, in milliseconds. Default 200 (5 FPS). */
  frameDuration?: number;
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

/** Default encoder settings (from the original txqr-gif tool). */
export const DEFAULTS: Readonly<Required<EncoderOptions>> = Object.freeze({
  chunkSize: 100,
  redundancy: 2,
  frameDuration: 200,
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
  /** Number of frames in one animation loop. */
  readonly frameCount: number;
  #blocks: Uint8Array[];
  #crc: number;
  #frames: (string | undefined)[];

  /** Strings are encoded as UTF-8. */
  constructor(data: Uint8Array | string, options: EncoderOptions = {}) {
    const bytes = typeof data === "string" ? utf8Encode(data) : data;
    const o = { ...DEFAULTS, ...stripUndefined(options), ...renderOpts(options) };
    if (!(Number.isInteger(o.chunkSize) && o.chunkSize > 0)) {
      throw new RangeError(`invalid chunkSize: ${o.chunkSize}`);
    }
    if (!(o.redundancy >= 1)) throw new RangeError(`invalid redundancy: ${o.redundancy}`);
    if (!(o.frameDuration > 0)) throw new RangeError(`invalid frameDuration: ${o.frameDuration}`);
    this.options = Object.freeze(o);
    this.size = bytes.length;
    this.#blocks = splitBlocks(bytes, o.chunkSize);
    this.blockCount = this.#blocks.length;
    this.#crc = crc32(bytes);
    // A single block gains nothing from repetition within a loop.
    this.frameCount = this.blockCount === 1 ? 1 : Math.ceil(this.blockCount * o.redundancy);
    this.#frames = new Array(this.frameCount);
  }

  /**
   * Frame text for a block code. Codes past frameCount are valid too: the
   * fountain never runs dry, so a sender may keep producing fresh frames.
   */
  frame(code: number): string {
    if (!(Number.isInteger(code) && code >= 0 && code < 1e9)) {
      throw new RangeError(`invalid frame code: ${code}`);
    }
    const cached = this.#frames[code];
    if (cached !== undefined) return cached;
    const text = formatFrame({
      code,
      chunkSize: this.options.chunkSize,
      size: this.size,
      crc: this.#crc,
      data: encodeBlock(this.#blocks, code),
    });
    if (code < this.frameCount) this.#frames[code] = text;
    return text;
  }

  /** All frames of one animation loop. */
  frames(): string[] {
    return Array.from({ length: this.frameCount }, (_, i) => this.frame(i));
  }

  /** Length of one animation loop in milliseconds. */
  get loopDuration(): number {
    return this.frameCount * this.options.frameDuration;
  }

  /** Index of the frame to show at a time (ms) since the animation started. */
  indexAt(timeMs: number): number {
    const i = Math.floor(timeMs / this.options.frameDuration) % this.frameCount;
    return i < 0 ? i + this.frameCount : i;
  }

  /** Frame text to show at a time (ms) since the animation started. */
  frameAt(timeMs: number): string {
    return this.frame(this.indexAt(timeMs));
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
 * Frames from a different transfer (other size, chunk size or checksum)
 * restart the decoder while incomplete; once complete it ignores everything
 * until {@link Decoder.reset}.
 */
export class Decoder {
  #maxSize: number;
  #maxBlocks: number;
  #key = "";
  #size = 0;
  #chunkSize = 0;
  #k = 0;
  #crc = 0;
  #solver: Solver | undefined;
  #seen = new Set<number>();
  #result: Uint8Array | undefined;

  constructor(options: DecoderOptions = {}) {
    this.#maxSize = options.maxSize ?? 64 * 1024 * 1024;
    this.#maxBlocks = options.maxBlocks ?? 16384;
  }

  /** Whether text is a well-formed txqr frame. */
  static isFrame(text: string): boolean {
    return parseFrame(text) !== undefined;
  }

  /**
   * Adds one frame's text. Returns true once the message is complete.
   * Throws on text that isn't a txqr frame (see {@link Decoder.isFrame}).
   */
  push(text: string): boolean {
    if (this.#result) return true;
    const f = parseFrame(text);
    if (!f) throw new TypeError(`invalid txqr frame: ${JSON.stringify(text.slice(0, 40))}`);
    const key = `${f.chunkSize}/${f.size}/${f.crc}`;
    if (key !== this.#key) this.#start(key, f.size, f.chunkSize, f.crc);
    // Cameras see the same frame many times in a row; skip repeats cheaply.
    if (this.#seen.has(f.code)) return false;
    this.#seen.add(f.code);

    const solver = this.#solver!;
    solver.add(blockIndices(f.code, this.#k), f.data);
    if (solver.rank < this.#k) return false;

    const out = new Uint8Array(this.#size);
    solver.solve().forEach((b, i) => out.set(b.subarray(0, Math.min(b.length, this.#size - i * b.length)), i * b.length));
    if (crc32(out) !== this.#crc) {
      this.reset();
      throw new Error("txqr: checksum mismatch in reassembled data");
    }
    this.#result = out;
    this.#solver = undefined;
    return true;
  }

  /**
   * Reads a QR code from an image and pushes it if it's a txqr frame.
   * Returns true once the message is complete.
   */
  pushImage(image: Image, opts?: ReadOptions): boolean {
    const text = qrRead(image, opts);
    if (text === undefined || !Decoder.isFrame(text)) return this.complete;
    return this.push(text);
  }

  #start(key: string, size: number, chunkSize: number, crc: number): void {
    const k = blockCount(size, chunkSize);
    if (size > this.#maxSize) throw new RangeError(`txqr: message of ${size} bytes exceeds maxSize`);
    if (k > this.#maxBlocks) throw new RangeError(`txqr: ${k} blocks exceeds maxBlocks`);
    this.reset();
    this.#key = key;
    this.#size = size;
    this.#chunkSize = chunkSize;
    this.#k = k;
    this.#crc = crc;
    this.#solver = new Solver(k);
  }

  /** Whether the whole message has been recovered. */
  get complete(): boolean {
    return this.#result !== undefined;
  }

  /** Message size in bytes (0 until the first frame). */
  get size(): number {
    return this.#size;
  }

  /** Chunk size of the current transfer (0 until the first frame). */
  get chunkSize(): number {
    return this.#chunkSize;
  }

  /** Number of source blocks needed (0 until the first frame). */
  get blockCount(): number {
    return this.#k;
  }

  /** Distinct frames received for the current transfer. */
  get received(): number {
    return this.#seen.size;
  }

  /** Fraction recovered so far, 0..1. */
  get progress(): number {
    if (this.#result) return 1;
    return this.#k === 0 ? 0 : this.#solver!.rank / this.#k;
  }

  /** The recovered message. Throws if not complete. */
  bytes(): Uint8Array {
    if (!this.#result) throw new Error("txqr: message not complete");
    return this.#result;
  }

  /** The recovered message decoded as UTF-8. Throws if not complete. */
  text(): string {
    return utf8Decode(this.bytes());
  }

  /** Forgets everything, ready for a new transfer. */
  reset(): void {
    this.#key = "";
    this.#size = this.#chunkSize = this.#k = this.#crc = 0;
    this.#solver = this.#result = undefined;
    this.#seen = new Set();
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}
