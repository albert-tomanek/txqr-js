// Frame wire format, entirely within the QR alphanumeric charset:
//
//   <code>/<chunkSize>/<size>/<crc32 hex>[/<nameLen>]:<base45 block>
//
// code       block code (0..k-1 are source blocks, >= k are fountain blocks)
// chunkSize  bytes per block; every block is exactly this long (zero padded)
// size       data length in bytes, excluding the name
// crc32      CRC-32 of the whole message (name + data), uppercase hex; doubles
//            as a transfer id so a decoder notices when a new transfer starts
// nameLen    optional: the message starts with this many bytes of UTF-8 file
//            name, followed by the data. Omitted when there is no name.

import { base45Decode, base45Encode, base45Length } from "./base45.ts";

export type Frame = {
  code: number;
  chunkSize: number;
  size: number;
  crc: number;
  nameLen: number;
  data: Uint8Array;
};

const FRAME_RE =
  /^(\d{1,9})\/(\d{1,9})\/(\d{1,12})\/([0-9A-F]{8})(?:\/(\d{1,4}))?:([0-9A-Z $%*+\-./:]*)$/;

export function formatFrame(f: Frame): string {
  const crc = f.crc.toString(16).toUpperCase().padStart(8, "0");
  const name = f.nameLen ? `/${f.nameLen}` : "";
  return `${f.code}/${f.chunkSize}/${f.size}/${crc}${name}:${base45Encode(f.data)}`;
}

/** Parses a frame, or returns undefined if text isn't a well-formed frame. */
export function parseFrame(text: string): Frame | undefined {
  const m = FRAME_RE.exec(text);
  if (!m) return undefined;
  const chunkSize = Number(m[2]);
  if (chunkSize < 1 || m[6].length !== base45Length(chunkSize)) return undefined;
  let data: Uint8Array;
  try {
    data = base45Decode(m[6]);
  } catch {
    return undefined;
  }
  return {
    code: Number(m[1]),
    chunkSize,
    size: Number(m[3]),
    crc: parseInt(m[4], 16) >>> 0,
    nameLen: m[5] === undefined ? 0 : Number(m[5]),
    data,
  };
}
