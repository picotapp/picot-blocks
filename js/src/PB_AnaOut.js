import { add, div, f, finite, mul, sub } from "./real.js";
import { R } from "./PB_AnaMon.js";

/**
 * PB_AnaOut（調節弁の出力）基本版の参照実装。
 * 仕様：spec/blocks/PB_AnaOut_基本版.md v0.2（節の番号はこの仕様書）
 *
 * 調節計の MV（弁の開度 %）を AO のカウントにする。弁の向きはこのブロックで反転する。
 * 調節計の値を使っていないとき（安全側・MAN・AO の異常・設定異常）は BkOk = FALSE で調節計を追従させる。
 */

/** 設定の既定値（7 章） */
export function anaOutDefaultCfg() {
  return {
    Act: 0, RawLo: 0, RawHi: 32000, SafePct: 0, PosUse: false, PosRawLo: 0, PosRawHi: 32000,
    DevLim: 10, DevHys: 2, DevT: 30, ManPct: 0, Mode: 1,
  };
}

/** 結果の番号（PB_AnaOut で使うもの） */
export const RO = { ...R, MODE: 4 };
const W_OPERATOR = 1;
const W_ENGINEER = 2;
const DT_MAX = 1.0;
const MAN = 0, AUT = 1;
const POS_FAIL_PCT = -2.5; // 3.6 mA 相当（14-6）

const clamp100 = (v) => Math.min(100, Math.max(0, v));

export class PB_AnaOut {
  constructor() {
    this.Out = 0;
    this.OutPct = 0;
    this.mA = 0;
    this.Pos = 0;
    this.Dev = 0;
    this.BkOk = false;
    this.BkVal = 0;
    this.STS = 0;
    this.MODE = 0;
    this.ALM = 0;
    this.DIAG = 0;
    this.AckSeq = 0;
    this.Result = 0;
    // ---- 内部 ----
    this.devEl = 0; // 偏差の経過時間
    this.devAlm = false;
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
    const safe = !!inp.Safe;
    const chFault = !!inp.ChFault;

    // ① 要求の口
    let init = !!inp.Init;
    const seq = inp.ReqSeq ?? 0;
    if (init) this.AckSeq = seq;
    else if (seq !== this.AckSeq) {
      this.Result = this.request(inp.ReqItem ?? 0, inp.ReqValue, inp.ReqWriter ?? 0, cfg, safe);
      this.AckSeq = seq;
    }

    // ② 設定異常（14-8）
    if (!this.cfgOk(cfg)) {
      this.needInit = true;
      this.devEl = 0;
      this.devAlm = false;
      this.BkOk = false;
      this.BkVal = this.OutPct;
      this.MODE = cfg.Mode === MAN || cfg.Mode === AUT ? cfg.Mode : 0;
      this.ALM = 0;
      this.STS = 1 | (2 << 3) | 32 | 128 | (dtClamp ? 256 : 0);
      this.DIAG = (dtClamp ? 1 : 0) | 2;
      return;
    }
    if (this.needInit) {
      init = true;
      this.needInit = false;
    }
    if (init) {
      this.devEl = 0;
      this.devAlm = false;
    }

    // ③ 出力の元（3 章）：安全側 ＞ MAN ＞ AUT
    const inV = f(inp.In ?? NaN);
    const inNaN = cfg.Mode === AUT && !safe && !finite(inV);
    let pct = this.OutPct;
    if (safe) pct = f(cfg.SafePct);
    else if (cfg.Mode === MAN) pct = f(cfg.ManPct);
    else if (!inNaN) pct = inV;
    pct = clamp100(pct);
    if (safe || cfg.Mode !== MAN) cfg.ManPct = pct; // 14-2
    this.OutPct = pct;

    // ④ 弁の向き・カウント（4 章、14-5）
    const sig = cfg.Act === 1 ? sub(100, pct) : pct;
    this.Out = add(cfg.RawLo, mul(div(sig, 100), sub(cfg.RawHi, cfg.RawLo)));
    this.mA = add(4, mul(sig, 0.16));

    // ⑤ 開度の監視（6 章、14-6・14-7）
    let posFail = false;
    let devPend = false;
    if (cfg.PosUse) {
      const pin = f(inp.PosIn ?? 0);
      let p = NaN;
      if (finite(pin)) p = div(mul(100, sub(pin, cfg.PosRawLo)), sub(cfg.PosRawHi, cfg.PosRawLo));
      posFail = !!inp.PosFault || !finite(p) || p < POS_FAIL_PCT;
      if (posFail) {
        this.Dev = 0;
        this.devEl = 0;
        this.devAlm = false;
      } else {
        this.Pos = p;
        this.Dev = sub(p, pct);
        const ad = Math.abs(this.Dev);
        if (ad > f(cfg.DevLim)) {
          if (!this.devAlm) {
            this.devEl = add(this.devEl, dt);
            if (this.devEl >= f(cfg.DevT)) {
              this.devAlm = true;
              this.devEl = 0;
            } else devPend = true;
          }
        } else {
          this.devEl = 0;
          if (ad <= sub(cfg.DevLim, cfg.DevHys)) this.devAlm = false;
        }
      }
    } else {
      this.Pos = 0;
      this.Dev = 0;
      this.devEl = 0;
      this.devAlm = false;
    }

    // ⑥ 戻り信号（5 章）
    this.BkOk = !safe && cfg.Mode === AUT && !chFault;
    this.BkVal = pct;

    // ⑦ 状態ワード（9 章、14-10）
    this.MODE = cfg.Mode;
    this.ALM = (this.devAlm ? 1 : 0) | (chFault ? 2 : 0) | (posFail ? 4 : 0);
    this.STS = 1 | (chFault ? (2 << 3) | 32 : 0) | (safe || cfg.Mode === MAN ? 64 : 0) | (dtClamp ? 256 : 0);
    this.DIAG = (dtClamp ? 1 : 0) | (safe ? 4 : 0) | (inNaN ? 8 : 0) | (devPend ? 16 : 0);
  }

  /** 設定異常（7 章、14-3） */
  cfgOk(c) {
    for (const k of ["RawLo", "RawHi", "SafePct", "PosRawLo", "PosRawHi", "DevLim", "DevHys", "DevT", "ManPct"]) if (!finite(c[k])) return false;
    if (f(c.RawLo) === f(c.RawHi)) return false;
    if (c.Act !== 0 && c.Act !== 1) return false;
    if (c.Mode !== MAN && c.Mode !== AUT) return false;
    if (c.SafePct < 0 || c.SafePct > 100 || c.ManPct < 0 || c.ManPct > 100) return false;
    if (c.PosUse && f(c.PosRawLo) === f(c.PosRawHi)) return false;
    if (c.DevLim < 1 || c.DevLim > 50 || c.DevHys < 0 || f(c.DevHys) > f(c.DevLim)) return false;
    return c.DevT >= 0 && c.DevT <= 600;
  }

  /** 要求の口（10 章、14-9） */
  request(item, value, writer, cfg, safe) {
    if (![1, 2, 10, 11, 12].includes(item)) return R.NO_ITEM;
    const opItem = item <= 2;
    if (opItem ? writer !== W_OPERATOR && writer !== W_ENGINEER : writer !== W_ENGINEER) return R.WRITER;
    const v = typeof value === "number" ? f(value) : NaN;
    if (!finite(v)) return R.BAD_VALUE;
    switch (item) {
      case 1:
        if (v !== MAN && v !== AUT) return R.BAD_VALUE;
        cfg.Mode = v;
        return R.OK;
      case 2:
        if (cfg.Mode !== MAN || safe) return RO.MODE;
        if (v < 0 || v > 100) return R.RANGE;
        cfg.ManPct = v;
        return R.OK;
      case 10:
        if (v < 1 || v > 50) return R.PARAM;
        if (v < f(cfg.DevHys)) return R.ORDER;
        cfg.DevLim = v;
        return R.OK;
      case 11:
        if (v < 0 || v > 50) return R.PARAM;
        if (v > f(cfg.DevLim)) return R.ORDER;
        cfg.DevHys = v;
        return R.OK;
      case 12:
        if (v < 0 || v > 600) return R.PARAM;
        cfg.DevT = v;
        return R.OK;
    }
    return R.NO_ITEM;
  }
}
