import { add, f, finite } from "./real.js";
import { R } from "./PB_AnaMon.js";

/**
 * PB_BinMon（ディジタル入力監視）基本版の参照実装。
 * 仕様：spec/blocks/PB_BinMon_基本版.md v0.4（節の番号はこの仕様書）
 *
 * 使い方：
 *   const cfg = binMonDefaultCfg();
 *   const fb = new PB_BinMon();
 *   fb.call({ In, ChFault, dt, Init, ReqSeq, ReqItem, ReqValue, ReqWriter }, cfg);
 *   fb.Active, fb.STS, fb.ALM ...
 */

/** 設定の既定値（6 章）。Invert：FALSE = NO（常時開）・TRUE = NC（常時閉） */
export function binMonDefaultCfg() {
  return { Invert: false, OnDelay: 0, OffDelay: 0, Inh: 0x0001, FailMode: 0, SimValue: false, SuppMask: 0x0001, SuppOffT: 0, SubOn: false, SubValue: false };
}

const W_ENGINEER = 2;
const DT_MAX = 1.0;
const DELAY_MAX = 60;

export class PB_BinMon {
  constructor() {
    // ---- 出力 ----
    this.Active = false;
    this.InAct = false;
    this.ActAlm = false; // 動作の警報（ST で ALM とぶつからない名前）
    this.Fail = false;
    this.Bad = false;
    this.SUPALM = 0; // 抑制中で条件が成立している警報（拡張 8-3）
    this.STS = 0;
    this.MODE = 0;
    this.ALM = 0;
    this.DIAG = 0;
    this.AckSeq = 0;
    this.Result = 0;
    // ---- 内部 ----
    this.oos = false;
    this.sim = false;
    this.elapsed = 0; // 遅延の経過時間
    this.fault = false; // 前のスキャンで入力異常だったか（13-2）
    this.needInit = true; // 設定異常から戻ったとき
    this.supping = false; // 抑制中（拡張 8-2）
    this.suppT = 0;
  }

  /** 1 スキャン。順番は 13-1 */
  call(inp, cfg) {
    let dt = f(inp.dt ?? 0);
    let dtClamp = false;
    if (!(dt > 0)) dt = 0;
    else if (dt > DT_MAX) {
      dt = f(DT_MAX);
      dtClamp = true;
    }

    // ① 要求の口。Init のときは番号だけ合わせる（7 章）
    let initLike = !!inp.Init;
    const seq = inp.ReqSeq ?? 0;
    if (inp.Init) this.AckSeq = seq;
    else if (seq !== this.AckSeq) {
      const was = { oos: this.oos, sim: this.sim, sub: !!cfg.SubOn };
      this.Result = this.request(inp.ReqItem ?? 0, inp.ReqValue, inp.ReqWriter ?? 0, cfg);
      this.AckSeq = seq;
      if ((was.oos && !this.oos) || (was.sim && !this.sim) || (was.sub && !cfg.SubOn)) initLike = true; // 7 章、拡張 8-6
    }

    // ③ 入力の選択・反転（停止中・設定異常でも InAct は計算する：13-5）
    const inAct = this.sim ? !!cfg.SimValue : !!inp.In !== !!cfg.Invert;
    this.InAct = inAct;

    const cfgErr = !this.cfgOk(cfg);
    let q = 0;
    let fail = false;
    let pending = false;
    let ch = false;
    let onSub = false; // 代替値で動いている（拡張 8-4・8-5）

    if (cfgErr) {
      // 設定異常：Active 保持、警報なし、Bad（計器）
      this.needInit = true;
      this.elapsed = 0;
      this.fault = false;
      q = 2;
    } else {
      if (this.needInit) {
        initLike = true;
        this.needInit = false;
      }
      if (this.oos) {
        // 停止中：Active 保持、警報も入力異常も見ない（5 章）
        this.elapsed = 0;
        this.fault = false;
        if (initLike) this.Active = inAct;
        q = 3;
      } else {
        // ④ 入力異常（模擬中は見ない：13-4）
        ch = !this.sim && !!inp.ChFault;
        if (this.fault && !ch) initLike = true; // 戻ったスキャン（13-2）
        this.fault = ch;
        if (initLike) {
          this.Active = inAct;
          this.elapsed = 0;
        }
        if (ch) {
          // ⑥ 異常時の値（処理 5）。遅延は数えない（3 章）
          this.elapsed = 0;
          if (cfg.FailMode === 1) this.Active = true;
          else if (cfg.FailMode === 2) this.Active = false;
          fail = true;
          q = 2;
        } else if (inAct !== this.Active) {
          // ⑤ ON/OFF 遅延（3 章、13-6）
          this.elapsed = add(this.elapsed, dt);
          const delay = f(inAct ? cfg.OnDelay : cfg.OffDelay);
          if (this.elapsed >= delay) {
            this.Active = inAct;
            this.elapsed = 0;
          } else pending = true;
        } else this.elapsed = 0;
        // 代替値（拡張 8-5）：入力異常は上で判定したまま、Active を置き換える。模擬中は模擬が優先
        if (!this.sim && cfg.SubOn) {
          onSub = true;
          this.Active = !!cfg.SubValue;
          this.elapsed = 0;
          pending = false;
          q = 1;
        }
      }
    }

    // 抑制（拡張 8-2）
    if (initLike || cfgErr) {
      this.supping = !!inp.Supp;
      this.suppT = 0;
    } else if (inp.Supp) {
      this.supping = true;
      this.suppT = 0;
    } else if (this.supping) {
      this.suppT = add(this.suppT, dt);
      if (this.suppT >= f(cfg.SuppOffT ?? 0)) this.supping = false;
    }

    // ⑦ 警報・⑧ 状態ワード
    this.Fail = fail;
    this.ActAlm = q === 0 && this.Active && !(cfg.Inh & 1);
    const raw = (this.ActAlm ? 1 : 0) | (this.Fail ? 2 : 0);
    const mask = this.supping ? (cfg.SuppMask ?? 0) & 3 : 0; // 拡張 8-3
    this.ALM = raw & ~mask;
    this.SUPALM = raw & mask;
    this.Bad = q >= 2;
    this.STS =
      (this.oos ? 2 : 1) |
      (this.sim ? 4 : 0) |
      (q << 3) |
      (q === 2 || onSub ? 32 : 0) |
      ((this.sim || onSub) && !this.oos ? 64 : 0) |
      (cfgErr ? 128 : 0) |
      (dtClamp ? 256 : 0);
    this.DIAG = (dtClamp ? 1 : 0) | (cfgErr ? 2 : 0) | (ch ? 4 : 0) | (pending ? 8 : 0) | (this.supping ? 16 : 0);
    this.MODE = 0;
  }

  /** 設定異常にするのは計算できない設定だけ（6 章） */
  cfgOk(c) {
    if (!finite(c.OnDelay) || !finite(c.OffDelay)) return false;
    if (c.OnDelay < 0 || c.OffDelay < 0) return false;
    if (!(c.FailMode === 0 || c.FailMode === 1 || c.FailMode === 2)) return false;
    // 拡張 8-7（足した設定は書かれていなければ 0：基本版と同じ）
    const sm = c.SuppMask ?? 0;
    if (!Number.isInteger(sm) || sm < 0 || sm > 3) return false;
    return finite(c.SuppOffT ?? 0) && (c.SuppOffT ?? 0) >= 0;
  }

  /** 要求の口（9 章）。結果の番号を返す */
  request(item, value, writer, cfg) {
    if (![1, 2, 3, 4, 5, 10, 11, 16, 22, 23].includes(item)) return R.NO_ITEM;
    if (writer !== W_ENGINEER) return R.WRITER;
    const v = typeof value === "number" ? f(value) : NaN;
    if (!finite(v)) return R.BAD_VALUE;
    if (item === 22) {
      if (v < 0 || v > 3) return R.PARAM;
      if (!Number.isInteger(v)) return R.BAD_VALUE;
      cfg.SuppMask = v;
      return R.OK;
    }
    if (item === 23) {
      if (v < 0 || v > 3600) return R.PARAM;
      cfg.SuppOffT = v;
      return R.OK;
    }
    if (item === 10 || item === 11) {
      if (v < 0 || v > DELAY_MAX) return R.PARAM;
      cfg[item === 10 ? "OnDelay" : "OffDelay"] = v;
      return R.OK;
    }
    if (v !== 0 && v !== 1) return R.BAD_VALUE;
    if (item === 1) this.oos = v === 1;
    else if (item === 2) this.sim = v === 1;
    else if (item === 3) cfg.SimValue = v === 1;
    else if (item === 4) cfg.SubOn = v === 1; // 拡張 8-8
    else if (item === 5) cfg.SubValue = v === 1;
    else cfg.Inh = v === 0 ? cfg.Inh | 1 : cfg.Inh & ~1;
    return R.OK;
  }
}
