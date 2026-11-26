import { add, div, f, finite, mul, sub } from "./real.js";

/**
 * PB_Split（スプリットレンジ）基本版の参照実装。
 * 仕様：spec/blocks/PB_Split_基本版.md v0.2（節の番号はこの仕様書）
 *
 * 調節計の MV（%）を 2 つの開度 A・B（%）に分ける。どちらかの下流が調節計の値を使っていなければ、
 * 調節計をその場で止める（BkOk = FALSE、BkVal = 今の In）。dt・Init・要求の口を持たない。
 */

/** 設定の既定値（4 章） */
export function splitDefaultCfg() {
  return { InLoA: 0, InHiA: 50, OutLoA: 0, OutHiA: 100, InLoB: 50, InHiB: 100, OutLoB: 0, OutHiB: 100 };
}

const KEYS = ["InLoA", "InHiA", "OutLoA", "OutHiA", "InLoB", "InHiB", "OutLoB", "OutHiB"];

/** In を InLo〜InHi で切って OutLo〜OutHi に（15-1） */
function conv(x, inLo, inHi, outLo, outHi) {
  const c = Math.min(f(inHi), Math.max(f(inLo), x));
  return add(outLo, mul(div(sub(c, inLo), sub(inHi, inLo)), sub(outHi, outLo)));
}

export class PB_Split {
  constructor() {
    this.OutA = 0;
    this.OutB = 0;
    this.BkOk = false;
    this.BkVal = 0;
    this.STS = 0;
    this.MODE = 0;
    this.ALM = 0;
    this.DIAG = 0;
  }

  call(inp, cfg) {
    const x = f(inp.In ?? NaN);
    const inOk = finite(x);
    if (inOk) this.BkVal = x; // 15-3・15-4：数でなければ最後の数
    const bkA = !!inp.BkOkA;
    const bkB = !!inp.BkOkB;
    this.MODE = 0;
    this.ALM = 0;

    if (!this.cfgOk(cfg)) {
      this.BkOk = false;
      this.STS = 1 | (2 << 3) | 32 | 128;
      this.DIAG = 2;
      return;
    }
    if (inOk) {
      this.OutA = conv(x, cfg.InLoA, cfg.InHiA, cfg.OutLoA, cfg.OutHiA);
      this.OutB = conv(x, cfg.InLoB, cfg.InHiB, cfg.OutLoB, cfg.OutHiB);
    }
    this.BkOk = bkA && bkB;
    this.STS = 1;
    this.DIAG = (inOk ? 0 : 8) | (bkA ? 0 : 16) | (bkB ? 0 : 32);
  }

  /** 設定異常（4 章） */
  cfgOk(c) {
    for (const k of KEYS) if (!finite(c[k]) || c[k] < 0 || c[k] > 100) return false;
    return f(c.InLoA) < f(c.InHiA) && f(c.InLoB) < f(c.InHiB);
  }
}
