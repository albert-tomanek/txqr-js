/**
 * txqr: transfer data through an animated sequence of QR codes, using a
 * fountain code so the receiver can join at any point and survive missed
 * frames.
 *
 * Pure ECMAScript: no DOM, TextEncoder or timers, so it runs in browsers,
 * Deno/Node/Bun and embedded engines such as QuickJS.
 * @module
 */
export declare function utf8Encode(str: string): Uint8Array;
export declare function utf8Decode(bytes: Uint8Array): string;
export declare function toBase64(bytes: Uint8Array): string;
export declare function fromBase64(str: string): Uint8Array;
export declare function crc32(bytes: Uint8Array): number;
/** QR error correction level: L 7%, M 15%, Q 25%, H 30% recovery. */
export type Ecc = "low" | "medium" | "quartile" | "high";
/** How a frame is drawn as a QR code. */
export interface RenderOptions {
  /** Error correction level. Default "low". */ ecc?: Ecc;
  /** Rendered image width/height in pixels. Default 300. */
  size?: number;
  /** Quiet zone width in modules (at least 1). Default 1. */
  border?: number;
}
/** Encoder settings. */
export interface EncoderOptions extends RenderOptions {
  /** Payload bytes carried per frame. Default 800. */ chunkSize?: number;
  /** Frames generated per source block, i.e. frameCount = blockCount * redundancy. Default 2. */
  redundancy?: number;
  /**
   * File name sent along with the data (at most 1024 bytes of UTF-8), for the
   * receiver to save it under; see {@link Decoder.name}. Default "" (none).
   */
  name?: string;
}
/** RGBA (or other `format`) pixel buffer; a canvas ImageData fits. */
export interface Image {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}
/** Pixel layouts accepted when reading. Planar formats only use the Y plane. */
export type PixelFormat =
  | "RGBA"
  | "RGBX"
  | "BGRA"
  | "BGRX"
  | "RGB"
  | "I420"
  | "I422"
  | "I444"
  | "NV12";
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
  /** Largest accepted message, in bytes. Default 64 MiB. */ maxSize?: number;
  /** Largest accepted number of source blocks. Default 16384. */
  maxBlocks?: number;
}
/**
 * Default encoder settings. Frame timing is the app's job; the demo shows
 * each frame for 200 ms (5 FPS), as the original Go txqr tools did.
 */
export declare const DEFAULTS: Readonly<Required<Omit<EncoderOptions, "name">>>;
/** Renders any text (normally a frame) as a QR code SVG string. */
export declare function renderSVG(text: string, opts?: RenderOptions): string;
/** Renders text as a QR code RGBA image of size x size pixels. */
export declare function renderImage(text: string, opts?: RenderOptions): Image;
/** Renders text as a QR module matrix (true = dark), quiet zone included. */
export declare function renderMatrix(
  text: string,
  opts?: RenderOptions,
): boolean[][];
/** Finds and decodes a QR code in an image; undefined if none is found. */
export declare function readQR(
  image: Image,
  opts?: ReadOptions,
): string | undefined;
/** Splits data into QR frame texts. */
export declare class Encoder {
  /** Effective settings, defaults filled in. */ readonly options: Readonly<
    Required<EncoderOptions>
  >;
  /** Data length in bytes (the name not included). */
  readonly size: number;
  /** Number of source blocks (k). */
  readonly blockCount: number;
  /**
   * Number of frames in one animation loop. How long each is shown, and
   * the loop itself, are up to the app: cycle through 0..frameCount-1.
   */
  readonly frameCount: number;
  private _blocks;
  private _crc;
  private _nameLen;
  private _frames;
  /** Strings are encoded as UTF-8. */
  constructor(data: Uint8Array | string, options?: EncoderOptions);
  /**
   * Frame text for a block code. Codes past frameCount are valid too: the
   * fountain never runs dry, so a sender may keep producing fresh frames.
   */
  frame(code: number): string;
  /** All frames of one animation loop. */
  frames(): string[];
  /** Frame `code` as an SVG string, using this encoder's render settings. */
  renderSVG(code: number): string;
  /** Frame `code` as an RGBA image, using this encoder's render settings. */
  renderImage(code: number): Image;
  /** Frame `code` as a module matrix, using this encoder's render settings. */
  renderMatrix(code: number): boolean[][];
}
/** Convenience: all frame texts of one loop for the given data. */
export declare function encode(
  data: Uint8Array | string,
  options?: EncoderOptions,
): string[];
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
export declare class Decoder {
  private _maxSize;
  private _maxBlocks;
  private _key;
  private _size;
  private _chunkSize;
  private _k;
  private _crc;
  private _nameLen;
  private _name;
  private _solver;
  private _seen;
  private _result;
  constructor(options?: DecoderOptions);
  /** Whether a decoded QR code's content (text or raw bytes) is a txqr frame. */
  static isFrame(frame: string | Uint8Array | ArrayBuffer): boolean;
  /**
   * Adds the text content of one decoded QR code. Use this (or
   * {@link Decoder.pushBytes}) when the QR code was decoded outside this
   * library, so no QR decoding runs in JS. Returns true once the message is
   * complete. Throws on text that isn't a txqr frame (check with
   * {@link Decoder.isFrame} first if the scanner may see other QR codes).
   */
  push(text: string): boolean;
  /**
   * Like {@link Decoder.push}, for a QR code's raw payload bytes as returned
   * by native decoders (e.g. ZXing's `bytes()`), or bytes handed over from a
   * host as an ArrayBuffer. Frames are ASCII, so the bytes are the frame text.
   * Returns true once the message is complete; throws on non-frames.
   */
  pushBytes(bytes: Uint8Array | ArrayBuffer): boolean;
  /**
   * Reads a QR code from image pixels in JS and pushes it if it's a txqr
   * frame; other QR codes and frames without one are ignored. To skip
   * JS-side QR decoding, decode natively and use {@link Decoder.push} or
   * {@link Decoder.pushBytes} instead. Returns true once the message is
   * complete.
   */
  pushImage(image: Image, opts?: ReadOptions): boolean;
  private _start;
  /** Whether the whole message has been recovered. */
  get complete(): boolean;
  /** Data size in bytes, the name not included (0 until the first frame). */
  get size(): number;
  /** Chunk size of the current transfer (0 until the first frame). */
  get chunkSize(): number;
  /** Number of source blocks needed (0 until the first frame). */
  get blockCount(): number;
  /** Distinct frames received for the current transfer. */
  get received(): number;
  /** Fraction recovered so far, 0..1. */
  get progress(): number;
  /**
   * The file name the sender attached (Encoder option `name`), or undefined
   * if it sent none or the message isn't complete yet. It comes from the
   * sender unchecked: sanitize it before using it as a path.
   */
  get name(): string | undefined;
  /** The recovered message. Throws if not complete. */
  bytes(): Uint8Array;
  /** The recovered message decoded as UTF-8. Throws if not complete. */
  text(): string;
  /** Forgets everything, ready for a new transfer. */
  reset(): void;
}
