import { add, div, f, finite, mul, sub } from "./real.js";

/**
 * PB_AnaMon（伝送器・アナログ指示と警報）基本版の参照実装。
 * 仕様：spec/blocks/PB_AnaMon_基本版.md v0.6（節の番号はこの仕様書）
 *
 * 使い方（ST の FB 呼び出しと同じ形）：
 *   const cfg = anaMonDefaultCfg();          // 利用者のプログラムが持つ設定（6.1：VAR_IN_OUT）
 *   const fb = new PB_AnaMon();
 *   fb.call({ In, ChFault, dt, Init, ReqSeq, ReqItem, ReqValue, ReqWriter }, cfg);
 *   fb.PV, fb.STS, fb.ALM ...
 */

/** 設定の既定値（6 章） */
export function anaMonDefaultCfg() {
  return {
    InType: 0, RawLo: 0, RawHi: 32000, EuLo: 0, EuHi: 100, FilterT: 0,
    LimHH: 100, LimH: 100, LimL: 0, LimLL: 0, Hys: 0, Inh: 0x000f,
    FailMode: 0, FailLo: 3.6, OorLo: 3.8, OorHi: 20.5, FailHi: 21.0, SimValue: 0, FailDelay: 0,
    SuppMask: 0x000f, SuppOffT: 0, SubOn: false, SubValue: 0,
  };
}

/** 結果の番号（共通仕様 3 章） */
export const R = { OK: 0, NO_ITEM: 1, WRITER: 2, RANGE: 3, BAD_VALUE: 8, PARAM: 12, ORDER: 13 };
const W_ENGINEER = 2;
const DT_MAX = 1.0;

/** 警報の段：Inh のビット、設定の名前、高い側か */
const LEVELS = [
  { name: "HH", bit: 0, lim: "LimHH", high: true },
  { name: "H", bit: 1, lim: "LimH", high: true },
  { name: "L", bit: 2, lim: "LimL", high: false },
  { name: "LL", bit: 3, lim: "LimLL", high: false },
];
/** 大小の順番（LL < L < H < HH）の並び */
const ORDER = ["LimLL", "LimL", "LimH", "LimHH"];

export class PB_AnaMon {
  constructor() {
    // ---- 出力 ----
    this.PV = 0;
    this.mA = 0;
    this.STS = 0;
    this.MODE = 0;
    this.ALM = 0;
    this.DIAG = 0;
    this.HH = false;
    this.H = false;
    this.L = false;
    this.LL = false;
    this.Fail = false;
    this.Bad = false;
    this.SUPALM = 0; // 抑制中で条件が成立している警報（拡張 8-3）
    this.AckSeq = 0;
    this.Result = 0;
    // ---- 内部 ----
    this.oos = false;
    this.sim = false;
    this.y = 0; // フィルタの値
    this.fault = false; // 計器故障（ラッチ）
    this.pendT = 0; // ON 遅延の経過時間
    this.pending = false;
    this.cause = { ch: false, lo: false, hi: false }; // 13-18
    this.alm = { HH: false, H: false, L: false, LL: false };
    this.needInit = true; // 設定異常から戻ったときなど
    this.supping = false; // 抑制中（拡張 8-2）
    this.suppT = 0;
  }

  /**
   * 1 スキャン。順番は 13-1：①要求の口 → ②モード・Init → ③入力・故障 → ④工学値・フィルタ → ⑤PV → ⑥警報 → ⑦品質・状態ワード
   * @param {object} inp In, ChFault, dt, Init, ReqSeq, ReqItem, ReqValue, ReqWriter
   * @param {object} cfg 設定（要求の口で書き換える）
   */
  call(inp, cfg) {
    // 時間（C-3、7 章）
    let dt = f(inp.dt ?? 0);
    let dtClamp = false;
    if (!(dt > 0)) dt = 0;
    else if (dt > DT_MAX) {
      dt = f(DT_MAX);
      dtClamp = true;
    }

    // ① 要求の口（D-7）。Init のときは番号だけ合わせて処理しない（13-10）
    let initLike = !!inp.Init;
    const seq = inp.ReqSeq ?? 0;
    if (inp.Init) {
      this.AckSeq = seq;
    } else if (seq !== this.AckSeq) {
      const was = { oos: this.oos, sim: this.sim, sub: !!cfg.SubOn };
      this.Result = this.request(inp.ReqItem ?? 0, inp.ReqValue, inp.ReqWriter ?? 0, cfg);
      this.AckSeq = seq;
      // 停止→運転、模擬 入→切、代替値 入→切 は Init と同じ（13-9、拡張 8-6）
      if ((was.oos && !this.oos) || (was.sim && !this.sim) || (was.sub && !cfg.SubOn)) initLike = true;
    }

    const cfgErr = !this.cfgOk(cfg);
    // 入力が数でなければ計算しない（13-21、C-8）
    const inOk = finite(inp.In ?? 0);
    // mA と割合（処理 2・4）。設定異常のときは割り算をしない（C-8）
    let x = 0;
    let mA = 0;
    if (!cfgErr && inOk) {
      x = div(sub(inp.In ?? 0, cfg.RawLo), sub(cfg.RawHi, cfg.RawLo));
      if (cfg.InType === 0) mA = add(4, mul(16, x));
    }
    this.mA = mA;
    const pvRaw = cfgErr ? 0 : add(cfg.EuLo, mul(x, sub(cfg.EuHi, cfg.EuLo)));

    let q = 0; // 品質 0 Good / 1 Uncertain / 2 Bad / 3 停止中
    let qCause = 0; // 0 プロセス / 1 計器
    let onSub = false; // 代替値で動いている（拡張 8-4・8-5）

    if (cfgErr) {
      // 設定異常：PV 保持、警報なし、Bad（計器）。戻ったら Init と同じに
      this.clearFault();
      this.clearAlarms();
      this.needInit = true;
      q = 2;
      qCause = 1;
    } else {
      if (this.needInit) {
        initLike = true;
        this.needInit = false;
      }
      // ② Init と同じ扱い：フィルタ・保持値を今の値に、故障と警報を消す（7 章）。入力が数でなければ保持（13-21）
      const src = this.sim ? f(cfg.SimValue) : pvRaw;
      if (initLike) {
        if (this.sim || inOk) {
          this.y = src;
          this.PV = src;
        }
        this.clearFault();
        this.clearAlarms();
      }

      if (this.oos) {
        // 停止中：PV 保持、警報も故障判定もしない（M-4、13-16）
        this.clearFault();
        this.clearAlarms();
        q = 3;
      } else if (this.sim) {
        // 模擬：模擬値にフィルタ、警報を判定、故障判定はしない（13-8）
        this.clearFault();
        this.filter(src, dt, cfg);
        this.PV = this.y;
        this.evalAlarms(cfg);
      } else {
        // ③ 計器故障の判定（3 章）
        const lo = cfg.InType === 0 && inOk && mA <= f(cfg.FailLo);
        const hi = cfg.InType === 0 && inOk && mA >= f(cfg.FailHi);
        const ch = !!inp.ChFault || !inOk; // 13-21：数でない入力は ChFault と同じ
        if (this.fault) {
          const back = cfg.InType === 0 ? mA >= f(cfg.OorLo) && mA <= f(cfg.OorHi) : true;
          if (back && !ch) {
            this.clearFault();
            this.clearAlarms(); // 13-7
          }
        } else if (lo || hi || ch) {
          this.cause.lo ||= lo;
          this.cause.hi ||= hi;
          this.cause.ch ||= ch;
          this.pendT = add(this.pendT, dt);
          if (this.pendT >= f(cfg.FailDelay)) {
            this.fault = true;
            this.pending = false;
          } else this.pending = true;
        } else {
          this.clearFault();
        }

        if (this.fault) {
          // 計器故障：警報なし、PV は保持（FailMode 0）か計算値（FailMode 1、13-4）。フィルタは止める（13-2）
          this.clearAlarms();
          if (cfg.FailMode === 1 && inOk) this.PV = pvRaw;
          q = 2;
          qCause = 1;
        } else if (this.pending) {
          // 故障の疑い：PV・警報を保持、フィルタは止める
          q = 1;
          qCause = 1;
        } else {
          // ④⑤⑥
          this.filter(pvRaw, dt, cfg);
          this.PV = this.y;
          this.evalAlarms(cfg);
          const inRange = cfg.InType === 0 ? mA >= 4 && mA <= 20 : pvRaw >= f(cfg.EuLo) && pvRaw <= f(cfg.EuHi);
          if (!inRange) q = 1; // レンジ外だが有効（Uncertain、プロセス）
        }
        // 代替値（拡張 8-5）：計器故障は上で判定したまま、PV と警報だけ置き換える
        if (cfg.SubOn) {
          onSub = true;
          this.clearAlarms();
          this.PV = f(cfg.SubValue);
          this.y = this.PV;
          q = 1;
          qCause = 1;
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

    // ⑦ 出力・状態ワード（共通仕様 2 章、8 章）
    this.Fail = this.fault && !this.oos && !this.sim && !cfgErr;
    this.HH = this.alm.HH;
    this.H = this.alm.H;
    this.L = this.alm.L;
    this.LL = this.alm.LL;
    const raw = (this.HH ? 1 : 0) | (this.H ? 2 : 0) | (this.L ? 4 : 0) | (this.LL ? 8 : 0) | (this.Fail ? 16 : 0);
    const mask = this.supping ? (cfg.SuppMask ?? 0) & 0x1f : 0; // 拡張 8-3
    this.ALM = raw & ~mask;
    this.SUPALM = raw & mask;
    this.Bad = q >= 2;
    this.STS =
      (this.oos ? 2 : 1) |
      (this.sim ? 4 : 0) |
      (q << 3) |
      ((q === 1 || q === 2) && qCause === 1 ? 32 : 0) |
      ((this.sim || onSub) && !this.oos ? 64 : 0) |
      (cfgErr ? 128 : 0) |
      (dtClamp ? 256 : 0);
    const faulty = this.fault || this.pending;
    this.DIAG =
      (dtClamp ? 1 : 0) |
      (cfgErr ? 2 : 0) |
      (faulty && this.cause.ch ? 4 : 0) |
      (faulty && this.cause.lo ? 8 : 0) |
      (faulty && this.cause.hi ? 16 : 0) |
      (this.pending ? 32 : 0) |
      (this.supping ? 64 : 0);
    this.MODE = 0;
  }

  /** フィルタ（処理 5）：y ← y + (u − y) × dt / (FilterT + dt)。FilterT = 0 は素通し */
  filter(u, dt, cfg) {
    const T = f(cfg.FilterT);
    if (T === 0) this.y = f(u);
    else if (dt > 0) this.y = add(this.y, div(mul(sub(u, this.y), dt), add(T, dt)));
  }

  /** 警報（4 章）。高い側：PV ≧ 設定値で発生、PV < 設定値 − Hys で戻る。低い側は逆 */
  evalAlarms(cfg) {
    const hys = f(cfg.Hys);
    for (const lv of LEVELS) {
      if (cfg.Inh & (1 << lv.bit)) {
        this.alm[lv.name] = false;
        continue;
      }
      const lim = f(cfg[lv.lim]);
      const pv = this.PV;
      if (lv.high) {
        if (pv >= lim) this.alm[lv.name] = true;
        else if (pv < sub(lim, hys)) this.alm[lv.name] = false;
      } else {
        if (pv <= lim) this.alm[lv.name] = true;
        else if (pv > add(lim, hys)) this.alm[lv.name] = false;
      }
    }
  }

  clearAlarms() {
    this.alm = { HH: false, H: false, L: false, LL: false };
  }

  clearFault() {
    this.fault = false;
    this.pending = false;
    this.pendT = 0;
    this.cause = { ch: false, lo: false, hi: false };
  }

  /** 設定異常にするのは計算できない設定だけ（13-17） */
  cfgOk(c) {
    const nums = ["RawLo", "RawHi", "EuLo", "EuHi", "FilterT", "LimHH", "LimH", "LimL", "LimLL", "Hys", "FailLo", "OorLo", "OorHi", "FailHi", "SimValue", "FailDelay"];
    if (!nums.every((k) => finite(c[k]))) return false;
    if (c.InType !== 0 && c.InType !== 1) return false;
    if (c.FailMode !== 0 && c.FailMode !== 1) return false;
    if (f(c.RawLo) === f(c.RawHi)) return false;
    if (!(f(c.EuLo) < f(c.EuHi))) return false;
    if (c.FilterT < 0 || c.FailDelay < 0 || c.Hys < 0) return false;
    const [a, b, d, e] = [f(c.FailLo), f(c.OorLo), f(c.OorHi), f(c.FailHi)];
    if (!(a <= b && b <= 4 && 20 <= d && d <= e)) return false;
    // 拡張 8-7（足した設定は書かれていなければ 0：基本版と同じ）
    const sm = c.SuppMask ?? 0;
    if (!Number.isInteger(sm) || sm < 0 || sm > 0x1f) return false;
    if (!finite(c.SuppOffT ?? 0) || (c.SuppOffT ?? 0) < 0) return false;
    return finite(c.SubValue ?? 0);
  }

  /** 要求の口（9 章、13-12〜13-14）。結果の番号を返す */
  request(item, value, writer, cfg) {
    const known = [1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
    if (!known.includes(item)) return R.NO_ITEM;
    if (writer !== W_ENGINEER) return R.WRITER; // 基本版の項目はすべてエンジニアだけ
    const v = typeof value === "number" ? f(value) : NaN;
    if (!finite(v)) return R.BAD_VALUE;
    const span = sub(cfg.EuHi, cfg.EuLo);
    const enabled = (lim) => !(cfg.Inh & (1 << LEVELS.find((l) => l.lim === lim).bit));

    switch (item) {
      case 1:
      case 2: {
        if (v !== 0 && v !== 1) return R.BAD_VALUE;
        if (item === 1) this.oos = v === 1;
        else this.sim = v === 1;
        return R.OK;
      }
      case 3:
        cfg.SimValue = v;
        return R.OK;
      case 4: // 代替値の入・切（拡張 8-8）
        if (v !== 0 && v !== 1) return R.BAD_VALUE;
        cfg.SubOn = v === 1;
        return R.OK;
      case 5:
        if (v < f(cfg.EuLo) || v > f(cfg.EuHi)) return R.RANGE;
        cfg.SubValue = v;
        return R.OK;
      case 22:
        if (v < 0 || v > 0x1f) return R.PARAM;
        if (!Number.isInteger(v)) return R.BAD_VALUE;
        cfg.SuppMask = v;
        return R.OK;
      case 23:
        if (v < 0 || v > 3600) return R.PARAM;
        cfg.SuppOffT = v;
        return R.OK;
      case 10:
      case 11:
      case 12:
      case 13: {
        const key = ["LimHH", "LimH", "LimL", "LimLL"][item - 10];
        if (v < f(cfg.EuLo) || v > f(cfg.EuHi)) return R.RANGE;
        // 有効な段どうしで LL < L < H < HH。変える段が無効なら並びに入れない（13-20）
        const vals = ORDER.filter((k) => enabled(k)).map((k) => (k === key ? v : f(cfg[k])));
        for (let i = 1; i < vals.length; i++) if (!(vals[i - 1] < vals[i])) return R.ORDER;
        cfg[key] = v;
        return R.OK;
      }
      case 14:
        if (v < 0 || v > mul(0.1, span)) return R.PARAM;
        cfg.Hys = v;
        return R.OK;
      case 15:
        if (v < 0 || v > 3600) return R.PARAM;
        cfg.FilterT = v;
        return R.OK;
      case 16:
      case 17:
      case 18:
      case 19: {
        if (v !== 0 && v !== 1) return R.BAD_VALUE;
        const bit = 1 << (item - 16);
        cfg.Inh = v === 0 ? cfg.Inh | bit : cfg.Inh & ~bit;
        return R.OK;
      }
      case 20:
      case 21: {
        // レンジの変更（13-13）
        const lo = item === 20 ? v : f(cfg.EuLo);
        const hi = item === 21 ? v : f(cfg.EuHi);
        if (!(lo < hi)) return R.ORDER;
        for (const k of ORDER) if (enabled(k) && (f(cfg[k]) < lo || f(cfg[k]) > hi)) return R.ORDER;
        if (f(cfg.Hys) > mul(0.1, sub(hi, lo))) return R.PARAM;
        if (item === 20) cfg.EuLo = v;
        else cfg.EuHi = v;
        return R.OK;
      }
    }
    return R.NO_ITEM;
  }
}
