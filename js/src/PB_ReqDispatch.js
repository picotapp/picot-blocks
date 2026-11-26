import { add, f, finite } from "./real.js";

/**
 * PB_ReqDispatch（要求の受付箱）基本版の参照実装。
 * 仕様：spec/blocks/PB_ReqDispatch_基本版.md v0.2（節の番号はこの仕様書）
 *
 * 受付箱の 1 件を、宛先の番号（BoxTag）の口（Ports）に渡し、返事を受付箱に写す。書けるかどうかの判断はしない。
 */

/** 口の数（ARRAY[1..64]） */
export const NUM_PORTS = 64;

/** 設定の既定値（6 章） */
export function reqDispatchDefaultCfg() {
  return { NumPorts: NUM_PORTS, TimeOut: 1.0 };
}

/** 口の配列（PB_ReqPort × 64）。JS では Ports[1] を ports[0] に置く */
export function newPorts() {
  return Array.from({ length: NUM_PORTS }, () => ({ Seq: 0, Item: 0, Value: 0, Writer: 0, AckSeq: 0, Result: 0 }));
}

/** 結果の番号（PB_ReqDispatch が出すもの） */
export const RR = { NO_TARGET: 15, NO_REPLY: 16 };
const DT_MAX = 1.0;
const SEQ_MAX = 32767;

export class PB_ReqDispatch {
  constructor() {
    this.BoxAck = 0;
    this.BoxResult = 0;
    this.Busy = false;
    this.Alive = 0;
    this.STS = 0;
    this.MODE = 0;
    this.ALM = 0;
    this.DIAG = 0;
    // ---- 内部 ----
    this.tag = 0; // 処理中の宛先
    this.seq = 0; // 処理中の BoxSeq
    this.el = 0; // 待ち時間
    this.timedOut = false;
    this.needInit = true;
  }

  /** 1 スキャン。順番は 13-1 */
  call(inp, cfg, ports) {
    let dt = f(inp.dt ?? 0);
    let dtClamp = false;
    if (!(dt > 0)) dt = 0;
    else if (dt > DT_MAX) {
      dt = f(DT_MAX);
      dtClamp = true;
    }
    this.Alive = this.Alive >= SEQ_MAX ? 0 : this.Alive + 1; // 13-9
    const boxSeq = inp.BoxSeq ?? 0;

    // ① 設定異常・Init（13-10、7 章）
    if (!this.cfgOk(cfg)) {
      this.needInit = true;
      this.Busy = false;
      this.out(dtClamp, true);
      return;
    }
    if (this.needInit || inp.Init) {
      this.needInit = false;
      this.Busy = false;
      this.timedOut = false;
      this.BoxAck = boxSeq;
    }

    // ② 返事を確かめる（13-2、13-3）
    let replied = false;
    if (this.Busy) {
      const p = ports[this.tag - 1];
      if (p.AckSeq === p.Seq) this.reply(p.Result);
      else {
        this.el = add(this.el, dt);
        if (this.el >= f(cfg.TimeOut)) {
          this.reply(RR.NO_REPLY);
          this.timedOut = true;
        }
      }
      replied = !this.Busy;
    }

    // ③ 新しい 1 件（3 章、13-5〜13-8）
    if (!this.Busy && !replied && boxSeq !== this.BoxAck) {
      this.timedOut = false;
      const tag = inp.BoxTag ?? 0;
      this.seq = boxSeq;
      if (!(tag >= 1 && tag <= cfg.NumPorts)) this.reply(RR.NO_TARGET);
      else {
        const p = ports[tag - 1];
        p.Item = inp.BoxItem ?? 0;
        p.Value = f(inp.BoxValue ?? 0);
        p.Writer = inp.BoxWriter ?? 0;
        p.Seq = p.Seq >= SEQ_MAX ? 1 : p.Seq + 1;
        this.tag = tag;
        this.el = 0;
        this.Busy = true;
      }
    }

    // ④ 出力
    this.out(dtClamp, false);
  }

  reply(result) {
    this.BoxResult = result;
    this.BoxAck = this.seq;
    this.Busy = false;
  }

  out(dtClamp, cfgErr) {
    this.MODE = 0;
    this.ALM = 0;
    this.STS = 1 | (cfgErr ? 128 : 0) | (dtClamp ? 256 : 0);
    this.DIAG = (dtClamp ? 1 : 0) | (cfgErr ? 2 : 0) | (this.Busy ? 4 : 0) | (this.timedOut && !cfgErr ? 8 : 0);
  }

  /** 設定異常（6 章） */
  cfgOk(c) {
    if (!Number.isInteger(c.NumPorts) || c.NumPorts < 1 || c.NumPorts > NUM_PORTS) return false;
    return finite(c.TimeOut) && c.TimeOut > 0;
  }
}
