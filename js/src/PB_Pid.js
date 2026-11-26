import { add, div, f, finite, mul, sub } from "./real.js";
import { R } from "./PB_AnaMon.js";

/**
 * PB_Pid（調節計）基本版の参照実装。
 * 仕様：spec/blocks/PB_Pid_基本版.md v0.5（節の番号はこの仕様書）
 *
 * 速度形。SP・MV・モードは設定と同じ構造体（cfg）に保持する（6 章）。
 */

/** 設定の既定値（6 章） */
export function pidDefaultCfg() {
  return {
    Action: 0, Alg: 0, EuLo: 0, EuHi: 100, PB: 100, TI: 20, TD: 0, MvLo: 0, MvHi: 100,
    TrkEndMan: false, SP: 0, MV: 0, Mode: 0,
  };
}

/** 結果の番号（PB_Pid で使うもの） */
export const RP = { ...R, MODE: 4, MVLIM: 5, NO_CAS: 6, PV_BAD: 7 };
const W_OPERATOR = 1;
const W_ENGINEER = 2;
const DT_MAX = 1.0;
const ETA = 0.1;
const MAN = 0, AUT = 1, CAS = 2;

export class PB_Pid {
  constructor() {
    this.MV = 0;
    this.SP = 0;
    this.BkCas = false;
    this.BkSp = 0;
    this.STS = 0;
    this.MODE = 0;
    this.ALM = 0;
    this.DIAG = 0;
    this.AckSeq = 0;
    this.Result = 0;
    // ---- 内部 ----
    this.px = 0; // 前の x
    this.pe = 0; // 前の e
    this.D = 0; // 微分の項
    this.prevTrk = false;
    this.casShed = false;
    this.F = 0; // 外部リセットの項（15 章）
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
    const pv = f(inp.PV ?? NaN);
    const pvBad = !!inp.PvBad || !finite(pv); // 14-2
    const casGood = !!inp.CasGood;
    let trk = !!inp.TrkOn;
    const cfgErr = !this.cfgOk(cfg);

    // ① 要求の口
    let init = !!inp.Init;
    const seq = inp.ReqSeq ?? 0;
    if (init) this.AckSeq = seq;
    else if (seq !== this.AckSeq) {
      this.Result = this.request(inp.ReqItem ?? 0, inp.ReqValue, inp.ReqWriter ?? 0, cfg, { pvBad, casGood, trk });
      this.AckSeq = seq;
    }

    if (cfgErr) {
      // 14-9：MV 保持、計算しない。戻ったら Init と同じ
      this.needInit = true;
      this.prevTrk = trk;
      this.MV = finite(cfg.MV) ? f(cfg.MV) : this.MV;
      this.STS = 1 | 128 | (dtClamp ? 256 : 0);
      this.MODE = [MAN, AUT, CAS].includes(cfg.Mode) ? cfg.Mode : 0;
      this.BkCas = false;
      this.DIAG = (dtClamp ? 1 : 0) | 2;
      this.ALM = 0;
      return;
    }

    // ② Init（7 章）
    if (this.needInit) {
      init = true;
      this.needInit = false;
    }
    const span = sub(cfg.EuHi, cfg.EuLo);
    const s = cfg.Action === 1 ? 1 : -1;
    const toPct = (v) => div(mul(100, sub(v, cfg.EuLo)), span);
    if (init) trk = false; // 14-11：Init のスキャンではトラッキングを見ない（戻り信号がまだ正しくない）
    if (init) {
      cfg.Mode = MAN;
      this.prevTrk = trk;
      this.casShed = false;
    }

    // ③ PV 異常で MAN、CAS で上位が使えなければ AUT
    if (pvBad) cfg.Mode = MAN;
    if (cfg.Mode === CAS && !casGood) {
      cfg.Mode = AUT;
      this.casShed = true;
    }

    // ④ CAS の SP（14-6）
    if (cfg.Mode === CAS) {
      const c = f(inp.CasIn ?? NaN);
      if (finite(c)) cfg.SP = Math.min(f(cfg.EuHi), Math.max(f(cfg.EuLo), add(cfg.EuLo, div(mul(c, span), 100))));
    }

    const x = pvBad ? this.px : mul(s, toPct(pv));
    const e = pvBad ? this.pe : mul(s, div(mul(100, sub(pv, cfg.SP)), span));
    if (init) {
      this.px = x;
      this.pe = e;
      this.D = 0;
    }

    // ⑤ トラッキング（14-7）
    let mv = f(cfg.MV);
    const trkEnd = this.prevTrk && !trk;
    if (trk) {
      const tv = f(inp.TrkVal ?? NaN);
      if (finite(tv)) mv = tv;
    } else if (trkEnd && cfg.TrkEndMan) cfg.Mode = MAN;
    this.prevTrk = trk;

    // ⑥ PID の計算（2 章）。ErfOn なら外部リセット（15 章）
    const calc = !trk && !pvBad && (cfg.Mode === AUT || cfg.Mode === CAS);
    const K = div(100, f(cfg.PB));
    const useErf = calc && !!inp.ErfOn;
    if (useErf) {
      let Dn = this.D;
      const td = f(cfg.TD);
      const alg = cfg.Alg === 1 && cfg.Mode === CAS ? 2 : cfg.Alg;
      if (dt > 0 && td > 0) {
        const uu = alg === 0 ? e : x; // 微分は Alg のまま（I-PD・PI-D は x）。比例は Alg によらず偏差（15-7）
        const pu = alg === 0 ? this.pe : this.px;
        const etd = mul(f(ETA), td);
        Dn = div(add(mul(etd, this.D), mul(td, sub(uu, pu))), add(etd, dt));
      } else if (dt > 0) Dn = 0;
      const ev = f(inp.ErfVal ?? NaN);
      if (finite(ev) && dt > 0) {
        const ti = f(cfg.TI);
        this.F = ti > 0 ? add(this.F, div(mul(sub(ev, this.F), dt), add(ti, dt))) : ev;
      }
      mv = add(this.F, mul(K, add(e, Dn)));
      if (dt > 0) {
        this.D = Dn;
        this.px = x;
        this.pe = e;
      }
    } else if (calc && dt > 0) {
      const alg = cfg.Alg === 1 && cfg.Mode === CAS ? 2 : cfg.Alg; // I-PD は CAS 中だけ PI-D
      const u = alg === 0 ? e : x; // 微分をかける信号
      const pu = alg === 0 ? this.pe : this.px;
      const td = f(cfg.TD);
      let Dn = 0;
      if (td > 0) {
        const etd = mul(f(ETA), td);
        Dn = div(add(mul(etd, this.D), mul(td, sub(u, pu))), add(etd, dt));
      }
      const prop = alg === 1 ? sub(x, this.px) : sub(e, this.pe);
      const integ = f(cfg.TI) > 0 ? mul(div(dt, f(cfg.TI)), e) : 0;
      const dmv = mul(K, add(add(prop, integ), sub(Dn, this.D)));
      mv = add(mv, dmv);
      this.D = Dn;
      this.px = x;
      this.pe = e;
    } else if (!calc) {
      // 計算しないスキャン：前の値を今に合わせる（バンプレス）
      this.px = x;
      this.pe = e;
      this.D = 0;
    }
    // dt ≦ 0 で計算するモードのときは前の値を更新しない（14-3）

    // ⑦ MV を上下限で切る（トラッキング中を除く）
    if (!trk) mv = Math.min(f(cfg.MvHi), Math.max(f(cfg.MvLo), mv));
    cfg.MV = mv;
    // 15-4：外部リセットで計算しないスキャンは、F を今の MV に合わせておく（切り替えで跳ねない）
    if (!useErf) this.F = sub(mv, mul(K, add(e, this.D)));

    // ⑧ 出力
    this.MV = mv;
    this.SP = f(cfg.SP);
    this.BkCas = cfg.Mode === CAS && !trk && !pvBad;
    this.BkSp = toPct(cfg.SP);
    this.MODE = cfg.Mode;
    this.ALM = 0;
    this.STS = 1 | (dtClamp ? 256 : 0);
    this.DIAG =
      (dtClamp ? 1 : 0) |
      (pvBad ? 4 : 0) |
      (trk ? 8 : 0) |
      (this.casShed ? 16 : 0) |
      (!trk && mv >= f(cfg.MvHi) ? 32 : 0) |
      (!trk && mv <= f(cfg.MvLo) ? 64 : 0) |
      (useErf ? 128 : 0);
  }

  /** 設定異常（6 章） */
  cfgOk(c) {
    for (const k of ["EuLo", "EuHi", "PB", "TI", "TD", "MvLo", "MvHi", "SP", "MV"]) if (!finite(c[k])) return false;
    if (!(f(c.EuLo) < f(c.EuHi))) return false;
    if (!(c.PB > 0) || c.TI < 0 || c.TD < 0) return false;
    if (!(f(c.MvLo) < f(c.MvHi))) return false;
    if (c.Action !== 0 && c.Action !== 1) return false;
    if (![0, 1, 2].includes(c.Alg)) return false;
    return [MAN, AUT, CAS].includes(c.Mode);
  }

  /** 要求の口（9 章、14-4） */
  request(item, value, writer, cfg, ctx) {
    if (![1, 2, 3, 10, 11, 12, 13, 14].includes(item)) return R.NO_ITEM;
    const opItem = item <= 3;
    if (opItem ? writer !== W_OPERATOR && writer !== W_ENGINEER : writer !== W_ENGINEER) return R.WRITER;
    const v = typeof value === "number" ? f(value) : NaN;
    if (!finite(v)) return R.BAD_VALUE;
    switch (item) {
      case 1:
        if (![MAN, AUT, CAS].includes(v)) return R.BAD_VALUE;
        if (v !== MAN && ctx.pvBad) return RP.PV_BAD;
        if (v === CAS && !ctx.casGood) return RP.NO_CAS;
        cfg.Mode = v;
        this.casShed = false; // 14-5
        return R.OK;
      case 2:
        if (cfg.Mode === CAS) return RP.MODE;
        if (v < f(cfg.EuLo) || v > f(cfg.EuHi)) return R.RANGE;
        cfg.SP = v;
        return R.OK;
      case 3:
        if (cfg.Mode !== MAN || ctx.trk) return RP.MODE;
        if (v < f(cfg.MvLo) || v > f(cfg.MvHi)) return RP.MVLIM;
        cfg.MV = v;
        return R.OK;
      case 10:
        if (v < 1 || v > 1000) return R.PARAM;
        cfg.PB = v;
        return R.OK;
      case 11:
        if (v < 0 || v > 10000) return R.PARAM;
        cfg.TI = v;
        return R.OK;
      case 12:
        if (v < 0 || v > 1000) return R.PARAM;
        cfg.TD = v;
        return R.OK;
      case 13:
      case 14: {
        if (v < 0 || v > 100) return R.PARAM;
        const lo = item === 13 ? v : f(cfg.MvLo);
        const hi = item === 14 ? v : f(cfg.MvHi);
        if (!(lo < hi)) return R.ORDER;
        cfg[item === 13 ? "MvLo" : "MvHi"] = v;
        return R.OK;
      }
    }
    return R.NO_ITEM;
  }
}
