import { div, f, finite, add } from "./real.js";
import { R } from "./PB_AnaMon.js";

/**
 * PB_Select（セレクタ）基本版の参照実装。
 * 仕様：spec/blocks/PB_Select_基本版.md v0.3（節の番号はこの仕様書）
 *
 * 最大 3 つの入力から高・低・中を選ぶ。信号選択（伝送器の冗長）とオーバーライド（調節計の MV）の両方に使う。
 * オーバーライドでは、調節計 n の ErfOn ← TRUE、ErfVal ← Out、TrkOn ← TrkAll、TrkVal ← Out とつなぐ（4 章、PB_Pid 15 章）。
 */

/** 設定の既定値（5 章） */
export function selectDefaultCfg() {
  return { Sel: 0, Use: 3, Fix: 0 };
}

const W_ENGINEER = 2;
const N = 3;

export class PB_Select {
  constructor() {
    this.Out = 0;
    this.Bad = false;
    this.SelNo = 0;
    this.Trk1 = true;
    this.Trk2 = true;
    this.Trk3 = true;
    this.TrkAll = true;
    this.STS = 0;
    this.MODE = 0;
    this.ALM = 0;
    this.DIAG = 0;
    this.AckSeq = 0;
    this.Result = 0;
  }

  /** 1 スキャン。順番は 15-1 */
  call(inp, cfg) {
    // ① 要求の口
    const seq = inp.ReqSeq ?? 0;
    if (inp.Init) this.AckSeq = seq;
    else if (seq !== this.AckSeq) {
      this.Result = this.request(inp.ReqItem ?? 0, inp.ReqValue, inp.ReqWriter ?? 0, cfg);
      this.AckSeq = seq;
    }

    const cfgErr = !this.cfgOk(cfg);
    const use = cfg.Use & 7;
    const vals = [];
    const ok = [];
    for (let i = 0; i < N; i++) {
      const v = f(inp[`In${i + 1}`] ?? NaN);
      vals.push(v);
      ok.push(!!(use & (1 << i)) && !inp[`Bad${i + 1}`] && finite(v));
    }
    const nUse = [0, 1, 2].filter((i) => use & (1 << i)).length;
    const nOk = ok.filter(Boolean).length;

    // ② 選ぶ（2 章・3 章）。trk[i] = 選ばれていない
    let out = this.Out;
    let selNo = 0;
    let bad = false;
    const trk = [true, true, true];
    if (cfgErr) bad = true;
    else if (cfg.Fix !== 0) {
      const i = cfg.Fix - 1;
      if (ok[i]) {
        out = vals[i];
        selNo = i + 1;
        trk[i] = false;
      } else bad = true;
    } else if (nOk === 0) bad = true;
    else if (cfg.Sel === 2 && nOk === 2) {
      const [a, b] = [0, 1, 2].filter((i) => ok[i]);
      out = div(add(vals[a], vals[b]), 2);
      trk[a] = false;
      trk[b] = false;
    } else {
      const idx = [0, 1, 2].filter((i) => ok[i]);
      let pick;
      if (cfg.Sel === 2 && nOk === 3) {
        const sorted = [...idx].sort((p, q) => vals[p] - vals[q] || p - q);
        const med = vals[sorted[1]];
        pick = idx.find((i) => vals[i] === med);
      } else {
        pick = idx[0];
        for (const i of idx) if (cfg.Sel === 0 ? vals[i] > vals[pick] : vals[i] < vals[pick]) pick = i;
      }
      out = vals[pick];
      selNo = pick + 1;
      trk[pick] = false;
    }

    // ③ 下流の戻り信号（15-5）
    const bkDown = !cfgErr && !inp.Init && !(inp.BkOkIn ?? true); // 15-10：Init では見ない
    if (bkDown) {
      trk.fill(true);
      const bv = f(inp.BkValIn ?? NaN);
      out = finite(bv) ? bv : this.Out; // 数でなければ前の Out を保持
    }

    // ④ 出力・状態ワード（7 章、15-6・15-7）
    this.Out = out;
    this.Bad = bad;
    this.SelNo = bad ? 0 : selNo;
    if (bad) trk.fill(true);
    [this.Trk1, this.Trk2, this.Trk3] = trk;
    this.TrkAll = bkDown || bad; // 15-9
    const fixed = !cfgErr && cfg.Fix !== 0;
    this.MODE = fixed ? 1 : 0;
    this.ALM = bad ? 1 : 0;
    const q = bad ? 2 : nOk < nUse ? 1 : 0;
    this.STS = 1 | (q << 3) | (q > 0 ? 32 : 0) | (fixed ? 64 : 0) | (cfgErr ? 128 : 0);
    let d = cfgErr ? 2 : 0;
    if (!cfgErr) for (let i = 0; i < N; i++) if (use & (1 << i) && !ok[i]) d |= 4 << i;
    if (bkDown) d |= 32;
    this.DIAG = d;
  }

  /** 設定異常（5 章） */
  cfgOk(c) {
    if (![0, 1, 2].includes(c.Sel)) return false;
    if (!Number.isInteger(c.Use) || (c.Use & 7) === 0 || (c.Use & ~7) !== 0) return false;
    if (![0, 1, 2, 3].includes(c.Fix)) return false;
    return c.Fix === 0 || (c.Use & (1 << (c.Fix - 1))) !== 0;
  }

  /** 要求の口（8 章、15-8） */
  request(item, value, writer, cfg) {
    if (item !== 1) return R.NO_ITEM;
    if (writer !== W_ENGINEER) return R.WRITER;
    const v = typeof value === "number" ? f(value) : NaN;
    if (!finite(v)) return R.BAD_VALUE;
    if (v < 0 || v > 3) return R.RANGE;
    if (!Number.isInteger(v)) return R.BAD_VALUE;
    if (v !== 0 && !(cfg.Use & (1 << (v - 1)))) return R.RANGE;
    cfg.Fix = v;
    return R.OK;
  }
}
