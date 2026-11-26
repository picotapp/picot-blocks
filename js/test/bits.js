/**
 * テストベクタの期待値で使う、状態ワードのビットの名前（各仕様書 8 章・共通仕様 2 章）。
 * JS の試験（vectors.test.js）と ST の試験への変換（tools/st_test/vec2st.mjs）で共有する。
 */
export const BITS = {
  PB_AnaMon: { alm: { HH: 1, H: 2, L: 4, LL: 8, Fail: 16 }, diag: { dtClamp: 1, cfgErr: 2, chFault: 4, ne43Lo: 8, ne43Hi: 16, failPending: 32, supp: 64 } },
  PB_BinMon: { alm: { Act: 1, Fail: 2 }, diag: { dtClamp: 1, cfgErr: 2, chFault: 4, pending: 8, supp: 16 } },
  PB_Pid: { alm: {}, diag: { dtClamp: 1, cfgErr: 2, pvBad: 4, trk: 8, casShed: 16, mvHi: 32, mvLo: 64, erf: 128 } },
  PB_ReqDispatch: { alm: {}, diag: { dtClamp: 1, cfgErr: 2, busy: 4, timeout: 8 } },
  PB_Intlk: { alm: { byp: 1 }, diag: { dtClamp: 1, cfgErr: 2, pending: 4 } },
  PB_AnaOut: { alm: { devAlm: 1, aoFail: 2, posFail: 4 }, diag: { dtClamp: 1, cfgErr: 2, safe: 4, inNaN: 8, devPend: 16 } },
  PB_Split: { alm: {}, diag: { cfgErr: 2, inNaN: 8, bkA: 16, bkB: 32 } },
  PB_Select: { alm: { noSel: 1 }, diag: { cfgErr: 2, in1: 4, in2: 8, in3: 16, bkDown: 32 } },
  PB_DevCore: { alm: { onFail: 1, offFail: 2, limFail: 4, uncmdOn: 8, uncmdOff: 16 }, diag: { dtClamp: 1, cfgErr: 2, moving: 4, pcmdRej: 8, statJudge: 16 } },
};

/** STS の 1 ビットの印（共通仕様 2 章） */
export const STS_FLAGS = { oos: 2, sim: 4, manip: 64, cfgErr: 128, dtClamp: 256 };

/** 整数で完全一致を見る出力の名前（それ以外の数値は許容誤差で比べる） */
export const EXACT = ["STS", "MODE", "ALM", "SUPALM", "DIAG", "Byp", "AckSeq", "Result", "State"];
