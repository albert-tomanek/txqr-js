// Systematic sparse random linear fountain code over GF(2).
//
// Block codes 0..k-1 carry the source blocks verbatim, so a lossless capture
// needs only k frames. Codes >= k XOR together a pseudo-random subset of
// source blocks, each included with probability p = min(1/2, 2 ln k / k).
// Both sides derive the subset from the block code alone, so nothing but the
// code travels with the block.
//
// The receiver solves the resulting linear system incrementally (Gaussian
// elimination on bitset rows) and recovers the data as soon as the received
// equations reach full rank. That density makes the matrix behave like a
// dense random one: about k + 1.5 frames on average and rarely more than
// k + 10, for any k. (The original's LT code with a soliton distribution has
// a long tail for the small k typical of QR transfers.)

// mulberry32: small, fast, good enough for picking block subsets.
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Source block indices combined into the block with the given code. */
export function blockIndices(code: number, k: number): number[] {
  if (code < k || k === 1) return [code % k];
  const rand = prng(Math.imul(code, 0x9e3779b1) ^ Math.imul(k, 0x85ebca6b));
  const p = Math.min(0.5, (2 * Math.log(k)) / k);
  const out: number[] = [];
  for (let i = 0; i < k; i++) if (rand() < p) out.push(i);
  if (out.length === 0) out.push(Math.floor(rand() * k));
  return out;
}

export function xorInto(dst: Uint8Array, src: Uint8Array): void {
  for (let i = 0; i < dst.length; i++) dst[i] ^= src[i];
}

export function blockCount(size: number, chunkSize: number): number {
  return Math.max(1, Math.ceil(size / chunkSize));
}

/** Splits data into k zero-padded blocks of chunkSize bytes. */
export function splitBlocks(data: Uint8Array, chunkSize: number): Uint8Array[] {
  const k = blockCount(data.length, chunkSize);
  const blocks: Uint8Array[] = [];
  for (let i = 0; i < k; i++) {
    const b = new Uint8Array(chunkSize);
    b.set(data.subarray(i * chunkSize, (i + 1) * chunkSize));
    blocks.push(b);
  }
  return blocks;
}

export function encodeBlock(blocks: Uint8Array[], code: number): Uint8Array {
  const out = new Uint8Array(blocks[0].length);
  for (const i of blockIndices(code, blocks.length)) xorInto(out, blocks[i]);
  return out;
}

const ctz = (x: number): number => 31 - Math.clz32(x & -x);

type Row = { coef: Uint32Array; data: Uint8Array };

/** Incremental GF(2) solver; row i (once present) has its lowest set bit at i. */
export class Solver {
  readonly k: number;
  rank = 0;
  private _words: number;
  private _rows: (Row | undefined)[];

  constructor(k: number) {
    this.k = k;
    this._words = (k + 31) >>> 5;
    this._rows = new Array(k);
  }

  /** Adds one equation; returns true if it was linearly independent. */
  add(indices: number[], data: Uint8Array): boolean {
    const coef = new Uint32Array(this._words);
    for (const i of indices) coef[i >>> 5] ^= 1 << (i & 31);
    const buf = data.slice();
    let w = 0;
    for (;;) {
      while (w < this._words && coef[w] === 0) w++;
      if (w === this._words) return false;
      const col = (w << 5) + ctz(coef[w]);
      const pivot = this._rows[col];
      if (!pivot) {
        this._rows[col] = { coef, data: buf };
        this.rank++;
        return true;
      }
      // pivot has no bits below col, so earlier words need no work.
      for (let j = w; j < this._words; j++) coef[j] ^= pivot.coef[j];
      xorInto(buf, pivot.data);
    }
  }

  /** Back-substitutes and returns the source blocks. Requires full rank. */
  solve(): Uint8Array[] {
    if (this.rank < this.k) throw new Error("solver: not enough equations");
    const rows = this._rows as Row[];
    for (let col = this.k - 1; col >= 0; col--) {
      const row = rows[col];
      for (let w = col >>> 5; w < this._words; w++) {
        let x = row.coef[w];
        if (w === col >>> 5) x &= ~((2 << (col & 31)) - 1); // only bits above col
        while (x !== 0) {
          const j = (w << 5) + ctz(x);
          xorInto(row.data, rows[j].data); // rows[j] is already a unit row
          row.coef[w] ^= 1 << (j & 31);
          x &= x - 1;
        }
      }
    }
    return rows.map((r) => r.data);
  }
}
