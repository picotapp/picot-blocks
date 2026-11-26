/**
 * カスケード（PB_Pid 仕様書 4 章、J-3・J-6）：上位・下位の 2 台をつなぐ。
 * 期待値は仕様書から手で起こした（NF-4）。どちらもレンジ 0〜100・正動作・PB 100（K = 1）・TI 0。
 * つなぎ方：上位.TrkOn ← NOT 下位.BkCas、上位.TrkVal ← 下位.BkSp、下位.CasIn ← 上位.MV
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PB_Pid, pidDefaultCfg } from "../src/PB_Pid.js";

const cfg = (sp, mv) => ({ ...pidDefaultCfg(), Action: 1, TI: 0, SP: sp, MV: mv });
const W = { ReqWriter: 1 };

/** order：上位を先に呼ぶ（"up"）か、下位を先に呼ぶ（"down"） */
function run(order) {
  const up = new PB_Pid(), lo = new PB_Pid();
  const cu = cfg(50, 0), cl = cfg(40, 30);
  const iu = { PV: 50, dt: 0.25, ReqSeq: 0, CasGood: true }, il = { PV: 40, dt: 0.25, ReqSeq: 0, CasGood: true };
  const scan = (init = false) => {
    const callUp = () => up.call({ ...iu, TrkOn: !lo.BkCas, TrkVal: lo.BkSp, Init: init }, cu);
    const callLo = () => lo.call({ ...il, CasIn: up.MV, Init: init }, cl);
    if (order === "up") { callUp(); callLo(); } else { callLo(); callUp(); }
  };
  const log = [];
  scan(true); // 1：Init（どちらも MAN）
  iu.ReqSeq = 1; Object.assign(iu, W, { ReqItem: 1, ReqValue: 1 }); // 上位を AUT
  il.ReqSeq = 1; Object.assign(il, W, { ReqItem: 1, ReqValue: 1 }); // 下位を AUT
  scan(); // 2
  log.push({ upMV: up.MV, loSP: lo.SP });
  scan(); // 3：上位は下位の SP（40 %）に追従している
  log.push({ upMV: up.MV, loSP: lo.SP });
  il.ReqSeq = 2; il.ReqValue = 2; // 下位を CAS
  scan(); // 4
  log.push({ upMV: up.MV, loSP: lo.SP, loMode: lo.MODE });
  scan(); // 5
  log.push({ upMV: up.MV, loSP: lo.SP });
  iu.PV = 60; // 上位の PV が 10 % 上がる → 上位 MV +10
  scan(); // 6
  log.push({ upMV: up.MV, loSP: lo.SP });
  scan(); // 7
  log.push({ upMV: up.MV, loSP: lo.SP });
  return log;
}

test("CAS-01 上位 → 下位の順：下位を CAS にしても SP は跳ねず、上位の変化は同じスキャンで下位の SP に届く", () => {
  assert.deepEqual(run("up"), [
    { upMV: 40, loSP: 40 }, // 2：上位は下位の BkSp（Init のスキャンで 40）に追従
    { upMV: 40, loSP: 40 },
    { upMV: 40, loSP: 40, loMode: 2 }, // 4：CAS にした瞬間も 40（バンプレス）
    { upMV: 40, loSP: 40 }, // 5：上位のトラッキングが外れても 40 から続く
    { upMV: 50, loSP: 50 }, // 6
    { upMV: 50, loSP: 50 },
  ]);
});

test("CAS-02 下位 → 上位の順：戻り信号と上位の MV が 1 スキャン遅れて届くだけで、跳ねない（J-6）", () => {
  assert.deepEqual(run("down"), [
    { upMV: 40, loSP: 40 },
    { upMV: 40, loSP: 40 },
    { upMV: 40, loSP: 40, loMode: 2 },
    { upMV: 40, loSP: 40 },
    { upMV: 50, loSP: 40 }, // 6：下位は前のスキャンの上位 MV（40）を使う
    { upMV: 50, loSP: 50 }, // 7：1 スキャン遅れて届く
  ]);
});
