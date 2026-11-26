import { add, div, f, finite, mul, sub } from "./real.js";
import { R } from "./PB_AnaMon.js";

/**
 * PB_DevCore（機器の核：ポンプ・ON/OFF 弁）基本版の参照実装。
 * 仕様：spec/blocks/PB_DevCore_基本版.md v0.3（節の番号はこの仕様書）
 *
 * 位置 pos は "on" / "off" / "mid"（途中）/ "unknown"（両方 ON）。目標 T は true（on）/ false（off）。
 */

/** 設定の既定値（9 章）。ポンプは FbCfg 1・FbTrack TRUE、弁は FbCfg 3・FbTrack FALSE（13 章 論点 7） */
export function devCoreDefaultCfg() {
  return {
    FbCfg: 3, SafeState: 0, FaultAct: 0, FbTrack: false, StatT: 1,
    MonTOn: 10, MonTOff: 10, StrokeT: 0, RunHours: 0, RunSecFrac: 0, Starts: 0,
  };
}

/** 結果の番号（共通仕様 3 章 ＋ 14 起動条件が揃っていない） */
export const RD = { ...R, MODE: 4, INTLK: 9, PERM: 14 };
const W_OPERATOR = 1;
const W_ENGINEER = 2;
const DT_MAX = 1.0;
const COUNT_MAX = 9999999;
const ALM = { onFail: 1, offFail: 2, limFail: 4, uncmdOn: 8, uncmdOff: 16 };

export class PB_DevCore {
  constructor() {
    this.Out = false;
    this.Target = false;
    this.State = 0;
    this.Travel = 0;
    this.Remain = 0;
    this.Fault = false;
    this.STS = 0;
    this.MODE = 0;
    this.ALM = 0;
    this.DIAG = 0;
    this.AckSeq = 0;
    this.Result = 0;
    // ---- 内部 ----
    this.aut = false;
    this.p = 0; // 進み具合の推定（%）
    this.moving = false; // 指令した動きの途中
    this.tm = 0; // 監視の経過時間
    this.ts = 0; // 指令外の動きの判断の経過時間
    this.judged = false; // 今の反対の端について判断済み
    this.fail = { on: false, off: false };
    this.info = { on: false, off: false };
    this.prevOn = false; // 前のスキャンで位置が on
    this.prevCmd = { on: false, off: false };
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
    const local = !!inp.Local;
    const intlk = !!inp.Intlk;
    const perm = inp.Perm ?? true; // 既定値 TRUE（2.1）
    const cmdOn = !!inp.PCmdOn;
    const cmdOff = !!inp.PCmdOff;
    const cfgErr = !this.cfgOk(cfg);
    const S = cfg.SafeState === 1; // 安全側（true = on）
    let pcmdRej = false;

    // ① 要求の口（Init のときは番号だけ合わせる）
    let init = !!inp.Init;
    const seq = inp.ReqSeq ?? 0;
    if (init) this.AckSeq = seq;
    else if (seq !== this.AckSeq) {
      this.Result = this.request(inp.ReqItem ?? 0, inp.ReqValue, inp.ReqWriter ?? 0, cfg, { local, intlk, perm, S, cfgErr });
      this.AckSeq = seq;
    }

    // ② 設定異常・Init（14-15、14-16）
    if (cfgErr) {
      this.needInit = true;
      this.Target = S;
      this.moving = false;
      this.clearBits();
    } else {
      if (this.needInit) {
        init = true;
        this.needInit = false;
      }
      if (init) {
        this.Target = S;
        this.clearBits();
        this.moving = false;
        this.tm = 0;
        this.ts = 0;
        this.judged = false;
        const pos0 = this.position(inp, cfg, true);
        this.p = pos0 === "on" ? 100 : pos0 === "off" ? 0 : S ? 100 : 0;
        if (cfg.FbCfg !== 0 && pos0 !== (S ? "on" : "off")) this.startMove();
        this.prevCmd = { on: cmdOn, off: cmdOff };
      }

      // ③ プログラムの指令（立ち上がり。14-5）
      const upOn = cmdOn && !this.prevCmd.on;
      const upOff = cmdOff && !this.prevCmd.off;
      if (this.aut && !local && (upOn || upOff)) {
        const v = upOn && upOff ? S : upOn; // 同時なら安全側
        if (this.refusal(v, intlk, perm, S) === R.OK) this.command(v);
        else pcmdRej = true;
      }

      // ④ インターロック（14-6）
      if (intlk && this.Target !== S) {
        this.Target = S;
        this.fail = { on: false, off: false };
        this.startMove();
      }
    }
    this.prevCmd = { on: cmdOn, off: cmdOff };

    // ⑤ 進み具合の推定（14-11）
    const end = this.Target ? 100 : 0;
    const T = f(cfg.StrokeT);
    if (!(T > 0)) this.p = end;
    else if (dt > 0) {
      const step = div(mul(100, dt), T);
      this.p = this.p < end ? Math.min(end, add(this.p, step)) : Math.max(end, sub(this.p, step));
    }

    // ⑥ 今の位置
    const pos = this.position(inp, cfg, false);
    const tgt = this.Target ? "on" : "off";
    const failed = this.fail.on || this.fail.off;

    // ⑦ 監視（6 章、14-7〜14-10）
    let statJudge = false;
    if (!cfgErr) {
      if (this.moving) {
        if (pos === tgt) this.moving = false;
        else if (!local && pos !== "unknown") {
          this.tm = add(this.tm, dt);
          if (this.tm >= f(this.Target ? cfg.MonTOn : cfg.MonTOff)) this.failNow(cfg, S);
        }
      } else if (failed) {
        // 14-8a：失敗した後は静止中の監視をしない
      } else if (pos === tgt || pos === "unknown") {
        this.tm = 0;
        this.ts = 0;
        this.judged = false;
      } else {
        // 静止中に位置が目標と違う（14-8）
        if (!local) {
          this.tm = add(this.tm, dt);
          if (this.tm >= f(this.Target ? cfg.MonTOn : cfg.MonTOff)) this.failNow(cfg, S);
        }
        if (pos === "mid") {
          this.ts = 0;
          this.judged = false;
        } else if (!this.judged) {
          this.ts = add(this.ts, dt);
          if (this.ts >= f(cfg.StatT)) {
            const toOn = pos === "on";
            this.info[toOn ? "on" : "off"] = true; // 14-9
            this.judged = true;
            this.ts = 0;
            const toSafe = toOn === S;
            if (toSafe || (cfg.FbTrack && !intlk)) {
              this.Target = toOn;
              this.tm = 0;
              this.judged = false;
            }
          } else statJudge = true;
        }
      }
      // 失敗が消えるとき (a)：失敗した向きの端に着いた（14-7）
      if (this.fail.on && pos === "on") this.fail.on = false;
      if (this.fail.off && pos === "off") this.fail.off = false;
    }
    const nowFailed = this.fail.on || this.fail.off;

    // ⑧ p の端合わせ（FbCfg ≠ 0）
    if (cfg.FbCfg !== 0 && (pos === "on" || pos === "off")) {
      if (pos === (this.Target ? "on" : "off") || !this.moving || nowFailed) this.p = pos === "on" ? 100 : 0;
    }

    // ⑨ 運転時間・起動回数（8 章、14-14）
    if (!cfgErr) {
      if (pos === "on") {
        cfg.RunSecFrac = add(cfg.RunSecFrac, dt);
        if (cfg.RunSecFrac >= 3600) {
          cfg.RunSecFrac = sub(cfg.RunSecFrac, 3600);
          cfg.RunHours = Math.min(COUNT_MAX, cfg.RunHours + 1);
        }
        if (!this.prevOn && !init) cfg.Starts = Math.min(COUNT_MAX, cfg.Starts + 1);
      }
      this.prevOn = pos === "on";
    }

    // ⑩ 出力・状態ワード
    const movingOk = this.moving && !nowFailed;
    this.Out = this.Target;
    this.Travel = this.p;
    this.Remain = movingOk && T > 0 ? div(mul(Math.abs(sub(this.Target ? 100 : 0, this.p)), T), 100) : 0;
    this.State = pos === "unknown" ? 3 : movingOk ? 2 : pos === "on" ? 1 : pos === "off" ? 0 : 2;
    const lim = pos === "unknown";
    this.ALM =
      (this.fail.on ? ALM.onFail : 0) |
      (this.fail.off ? ALM.offFail : 0) |
      (lim ? ALM.limFail : 0) |
      (this.info.on ? ALM.uncmdOn : 0) |
      (this.info.off ? ALM.uncmdOff : 0);
    this.Fault = nowFailed || lim;
    this.STS = 1 | (cfgErr ? 128 : 0) | (dtClamp ? 256 : 0);
    this.MODE = (this.aut ? 1 : 0) | (local ? 256 : 0);
    this.DIAG = (dtClamp ? 1 : 0) | (cfgErr ? 2 : 0) | (movingOk ? 4 : 0) | (pcmdRej ? 8 : 0) | (statJudge ? 16 : 0);
  }

  /** 今の位置（5 章）。FbCfg 0 は推定 p から（Init のときは安全側の端） */
  position(inp, cfg, atInit) {
    const on = !!inp.FbOn;
    const off = !!inp.FbOff;
    switch (cfg.FbCfg) {
      case 3:
        return on && off ? "unknown" : on ? "on" : off ? "off" : "mid";
      case 1:
        return on ? "on" : "off";
      case 2:
        return off ? "off" : "on";
      default:
        if (atInit) return cfg.SafeState === 1 ? "on" : "off";
        return this.p >= 100 ? "on" : this.p <= 0 ? "off" : "mid";
    }
  }

  startMove() {
    this.moving = true;
    this.tm = 0;
    this.ts = 0;
    this.judged = false;
  }

  clearBits() {
    this.fail = { on: false, off: false };
    this.info = { on: false, off: false };
  }

  /** 失敗（6 章）。FaultAct 1 なら安全側へ（失敗のビットは消さない：14-7） */
  failNow(cfg, S) {
    this.fail[this.Target ? "on" : "off"] = true;
    this.moving = false;
    this.tm = 0;
    if (cfg.FaultAct === 1 && this.Target !== S) this.Target = S;
  }

  /** 受け付けた指令（14-2） */
  command(v) {
    this.Target = v;
    this.clearBits();
    this.moving = true; // 位置が同じなら ⑦ ですぐ終わる
    this.tm = 0;
    this.ts = 0;
    this.judged = false;
  }

  /** 指令を断る理由（4 章）：インターロック 9 → パーミッシブ 14 */
  refusal(v, intlk, perm, S) {
    if (v === S) return R.OK;
    if (intlk) return RD.INTLK;
    if (this.Target === S && !perm) return RD.PERM;
    return R.OK;
  }

  /** 設定異常（9 章） */
  cfgOk(c) {
    for (const k of ["MonTOn", "MonTOff", "StrokeT", "StatT"]) if (!finite(c[k]) || c[k] < 0) return false;
    if (![0, 1, 2, 3].includes(c.FbCfg)) return false;
    if (c.SafeState !== 0 && c.SafeState !== 1) return false;
    return c.FaultAct === 0 || c.FaultAct === 1;
  }

  /** 要求の口（9 章、14-3、14-4） */
  request(item, value, writer, cfg, ctx) {
    if (![1, 2, 10, 11, 12, 13, 20, 21].includes(item)) return R.NO_ITEM;
    const opItem = item === 1 || item === 2;
    if (opItem ? writer !== W_OPERATOR && writer !== W_ENGINEER : writer !== W_ENGINEER) return R.WRITER;
    const v = typeof value === "number" ? f(value) : NaN;
    if (!finite(v)) return R.BAD_VALUE;
    if (opItem && v !== 0 && v !== 1) return R.BAD_VALUE;
    if ((item === 20 || item === 21) && !Number.isInteger(v)) return R.BAD_VALUE;
    switch (item) {
      case 1: {
        if (this.aut || ctx.local) return RD.MODE;
        const r = this.refusal(v === 1, ctx.intlk, ctx.perm, ctx.S);
        if (r !== R.OK) return r;
        if (!ctx.cfgErr) this.command(v === 1);
        return R.OK;
      }
      case 2:
        this.aut = v === 1;
        return R.OK;
      case 10:
      case 11:
        if (v < 1 || v > 600) return R.PARAM;
        cfg[item === 10 ? "MonTOn" : "MonTOff"] = v;
        return R.OK;
      case 12:
        if (v < 0 || v > 600) return R.PARAM;
        cfg.StrokeT = v;
        return R.OK;
      case 13:
        if (v < 0 || v > 10) return R.PARAM;
        cfg.StatT = v;
        return R.OK;
      case 20:
      case 21:
        if (v < 0 || v > COUNT_MAX) return R.PARAM;
        if (item === 20) {
          cfg.RunHours = v;
          cfg.RunSecFrac = 0;
        } else cfg.Starts = v;
        return R.OK;
    }
    return R.NO_ITEM;
  }
}
