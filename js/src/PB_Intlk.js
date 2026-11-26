import { add, f, finite } from "./real.js";
import { R } from "./PB_AnaMon.js";

/**
 * PB_Intlk（インターロック）基本版の参照実装。
 * 仕様：spec/blocks/PB_Intlk_基本版.md v0.3（節の番号はこの仕様書）、バイパスは 拡張_PB_Intlk_バイパス.md v0.2（「拡張 8-x」）
 *
 * 原因 8 個を OR でまとめてラッチする。どの機器を止めるかは持たない（呼び出しコードでつなぐ）。
 */

/** 設定の既定値（6 章） */
export function intlkDefaultCfg() {
  return { ResetMode: 0, ResetBy: 1, FoEn: true, Delay: [0, 0, 0, 0, 0, 0, 0, 0], BypAllow: 0, BypMaxT: 28800 };
}

/** 結果の番号（PB_Intlk で使うもの） */
export const RI = { ...R, INTLK: 9, NOT_ACTIVE: 10, NOT_CLEAR: 11 };
const N = 8;
const W_OPERATOR = 1;
const W_ENGINEER = 2;
const DT_MAX = 1.0;

export class PB_Intlk {
  constructor() {
    this.Trip = false;
    this.ResetReady = false;
    this.Cause = 0;
    this.Raw = 0;
    this.Mem = 0;
    this.First = 0;
    this.FirstNo = 0;
    this.FirstTime = 0;
    this.Byp = 0;
    this.BypOn = false;
    this.BypLeft = 0;
    this.STS = 0;
    this.MODE = 0;
    this.ALM = 0;
    this.DIAG = 0;
    this.AckSeq = 0;
    this.Result = 0;
    // ---- 内部 ----
    this.el = new Array(N).fill(0); // 原因ごとの経過時間
    this.bel = new Array(N).fill(0); // バイパスの経過時間（拡張 8-1）
    this.needInit = true;
  }

  /** 1 スキャン。順番は 14-1 */
  call(inp, cfg) {
    let dt = f(inp.dt ?? 0);
    let dtClamp = false;
    if (!(dt > 0)) dt = 0;
    else if (dt > DT_MAX) {
      dt = f(DT_MAX);
      dtClamp = true;
    }

    // ① Raw
    let raw = 0;
    for (let i = 0; i < N; i++) if (inp[`In${i + 1}`]) raw |= 1 << i;
    this.Raw = raw;
    const cfgErr = !this.cfgOk(cfg);

    // ② 要求の口
    let init = !!inp.Init;
    const seq = inp.ReqSeq ?? 0;
    if (init) this.AckSeq = seq;
    else if (seq !== this.AckSeq) {
      this.Result = this.request(inp.ReqItem ?? 0, inp.ReqValue, inp.ReqWriter ?? 0, cfg, cfgErr);
      this.AckSeq = seq;
    }

    // ③ 設定異常（14-7）
    if (cfgErr) {
      this.needInit = true;
      this.clearLatch();
      this.el.fill(0);
      this.Byp = 0; // 拡張 8-6
      this.Trip = true;
      this.Cause = raw;
      this.ResetReady = false;
      this.out(dtClamp, true, false);
      return;
    }
    if (this.needInit) {
      init = true;
      this.needInit = false;
    }
    if (init) {
      this.clearLatch();
      this.el.fill(0);
      this.Byp = 0; // 拡張 8-6
    }

    // ③b バイパスの時間（拡張 8-1・8-4）
    this.Byp &= cfg.BypAllow ?? 0;
    let left = 0;
    for (let i = 0; i < N; i++) {
      const bit = 1 << i;
      if (!(this.Byp & bit)) continue;
      this.bel[i] = add(this.bel[i], dt);
      if (this.bel[i] >= f(cfg.BypMaxT)) this.Byp &= ~bit;
      else {
        const l = f(f(cfg.BypMaxT) - this.bel[i]);
        if (left === 0 || l < left) left = l;
      }
    }
    this.BypLeft = left;
    const eff = raw & ~this.Byp; // バイパス中の原因を除く

    // ④ 原因ごとの遅延（3 章、14-3）
    let cause = 0;
    let pending = false;
    for (let i = 0; i < N; i++) {
      const bit = 1 << i;
      if (!(eff & bit)) {
        this.el[i] = 0;
        continue;
      }
      if (init || this.Cause & bit) {
        cause |= bit;
        continue;
      }
      this.el[i] = add(this.el[i], dt);
      if (this.el[i] >= f(cfg.Delay[i])) {
        cause |= bit;
        this.el[i] = 0;
      } else pending = true;
    }
    this.Cause = cause;

    // ⑤ トリップの判定（4 章）
    if (!this.Trip && cause !== 0) {
      this.Trip = true;
      this.Mem = cause;
      if (cfg.FoEn) {
        this.First = cause;
        this.FirstNo = lowestNo(cause);
        this.FirstTime = (inp.Now ?? 0) >>> 0;
      }
    } else if (this.Trip) this.Mem |= cause;

    // ⑥ 自動リセット（14-5）
    if (this.Trip && cfg.ResetMode === 1 && eff === 0) this.clearLatch();

    // ⑦ 出力
    this.ResetReady = this.Trip && eff === 0;
    this.out(dtClamp, false, pending);
  }

  out(dtClamp, cfgErr, pending) {
    if (cfgErr) this.BypLeft = 0;
    this.BypOn = this.Byp !== 0;
    this.MODE = 0;
    this.ALM = this.BypOn ? 1 : 0; // 拡張 8-9
    this.STS = 1 | (cfgErr ? 128 : 0) | (dtClamp ? 256 : 0);
    this.DIAG = (dtClamp ? 1 : 0) | (cfgErr ? 2 : 0) | (pending ? 4 : 0);
  }

  clearLatch() {
    this.Trip = false;
    this.Mem = 0;
    this.First = 0;
    this.FirstNo = 0;
    this.FirstTime = 0;
  }

  /** 設定異常（6 章） */
  cfgOk(c) {
    if (c.ResetMode !== 0 && c.ResetMode !== 1) return false;
    if (c.ResetBy !== 1 && c.ResetBy !== 2) return false;
    if (!Array.isArray(c.Delay) || c.Delay.length !== N) return false;
    if (!c.Delay.every((d) => finite(d) && d >= 0)) return false;
    // 拡張 8-5：BypAllow = 0 なら BypMaxT を見ない
    const allow = c.BypAllow ?? 0;
    if (!Number.isInteger(allow) || allow < 0 || allow > 255) return false;
    return allow === 0 || (finite(c.BypMaxT) && c.BypMaxT >= 60 && c.BypMaxT <= 86400);
  }

  /** 要求の口（9 章、14-7） */
  request(item, value, writer, cfg, cfgErr) {
    if (item === 2 || item === 3) return this.bypass(item, value, writer, cfg, cfgErr);
    if (item !== 1) return R.NO_ITEM;
    const ok = cfg.ResetBy === 1 ? writer === W_OPERATOR || writer === W_ENGINEER : writer === W_ENGINEER;
    if (!ok) return R.WRITER;
    if (!(typeof value === "number" && f(value) === 1)) return R.BAD_VALUE;
    if (cfgErr) return RI.NOT_CLEAR;
    if (!this.Trip) return RI.NOT_ACTIVE;
    if ((this.Raw & ~this.Byp) !== 0) return RI.NOT_CLEAR; // 拡張 8-8
    this.clearLatch();
    return R.OK;
  }
}

/** バイパスする（項目 2）・外す（項目 3）。拡張 2 章・8-7 */
PB_Intlk.prototype.bypass = function (item, value, writer, cfg, cfgErr) {
  if (item === 2 ? writer !== W_ENGINEER : writer !== W_OPERATOR && writer !== W_ENGINEER) return R.WRITER;
  const v = typeof value === "number" ? f(value) : NaN;
  if (!finite(v) || !Number.isInteger(v) || v < 1 || v > 255) return R.BAD_VALUE;
  if (item === 3) {
    this.Byp &= ~v;
    return R.OK;
  }
  if (cfgErr) return RI.NOT_CLEAR;
  if ((v & ~(cfg.BypAllow ?? 0)) !== 0) return R.PARAM;
  if (this.Trip) return RI.INTLK;
  this.Byp |= v;
  for (let i = 0; i < N; i++) if (v & (1 << i)) this.bel[i] = 0; // 拡張 8-2
  return R.OK;
};

/** 立っているビットのうち一番小さい原因の番号（1〜8） */
function lowestNo(w) {
  for (let i = 0; i < N; i++) if (w & (1 << i)) return i + 1;
  return 0;
}
