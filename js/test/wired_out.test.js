/**
 * 調節計と出力ブロックをつなぐ試験（PB_AnaOut 5 章、PB_Split 7 章、PB_Pid 14-11）。
 * 期待値は仕様書から手で起こした（NF-4）。調節計はレンジ 0〜100・正動作・PB 100（K = 1）・TI 0（比例だけの速度形：MV の変化 = 偏差の変化）。
 * 呼ぶ順は 調節計 → （スプリット →）出力。戻り信号は前のスキャンの値が届く。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PB_Pid, pidDefaultCfg } from "../src/PB_Pid.js";
import { PB_AnaOut, anaOutDefaultCfg } from "../src/PB_AnaOut.js";
import { PB_Split, splitDefaultCfg } from "../src/PB_Split.js";
import { PB_Select, selectDefaultCfg } from "../src/PB_Select.js";

/** REAL の丸めを許容誤差 0.001 で比べるため、記録する値を丸める */
const r = (x) => (typeof x === "number" ? Math.round(x * 1000) / 1000 : x);
const pidCfg = () => ({ ...pidDefaultCfg(), Action: 1, TI: 0, SP: 50, MV: 30 });

test("OUT-01 調節計 → 出力：MAN・安全側の間は調節計が弁に追従し、戻っても弁が跳ねない（戻り信号は 1 スキャン遅れ）", () => {
  const pid = new PB_Pid(), ao = new PB_AnaOut();
  const cp = pidCfg(), co = anaOutDefaultCfg();
  const ip = { PV: 50, dt: 0.25, ReqSeq: 0 }, io = { dt: 0.25, ReqSeq: 0, Safe: false };
  const log = [];
  const scan = (init = false) => {
    pid.call({ ...ip, TrkOn: !ao.BkOk, TrkVal: ao.BkVal, Init: init }, cp);
    ao.call({ ...io, In: pid.MV, Init: init }, co);
    log.push([pid.MV, ao.OutPct, ao.BkOk].map(r));
  };
  scan(true); // 1：調節計は MAN（MV 30）、出力は AUT（保持）。Init では戻り信号を見ない
  Object.assign(ip, { ReqSeq: 1, ReqItem: 1, ReqValue: 1, ReqWriter: 1 }); // 調節計を AUT
  scan(); // 2
  ip.PV = 60;
  scan(); // 3：偏差 +10 → MV 40
  Object.assign(io, { ReqSeq: 1, ReqItem: 1, ReqValue: 0, ReqWriter: 1 }); // 出力を MAN
  scan(); // 4：MAN の開度は今の 40 から
  scan(); // 5：調節計は 40 に追従
  Object.assign(io, { ReqSeq: 2, ReqItem: 2, ReqValue: 20 }); // MAN で 20 %
  scan(); // 6：調節計は前のスキャンの 40 を追従
  scan(); // 7：20 に追従
  ip.PV = 65;
  scan(); // 8：追従中は計算しない（前の偏差を今に合わせる）
  Object.assign(io, { ReqSeq: 3, ReqItem: 1, ReqValue: 1 }); // 出力を AUT
  scan(); // 9：In ＝ 20 なので跳ねない
  scan(); // 10：偏差 15 のまま → 20
  ip.PV = 70;
  scan(); // 11：偏差 +5 → 25
  io.Safe = true;
  scan(); // 12：安全側 0 %
  scan(); // 13：調節計は 0 に追従
  io.Safe = false;
  scan(); // 14：戻っても 0 のまま
  scan(); // 15
  assert.deepEqual(log, [
    [30, 30, true],
    [30, 30, true],
    [40, 40, true],
    [40, 40, false],
    [40, 40, false],
    [40, 20, false],
    [20, 20, false],
    [20, 20, false],
    [20, 20, true],
    [20, 20, true],
    [25, 25, true],
    [25, 0, false],
    [0, 0, false],
    [0, 0, true],
    [0, 0, true],
  ]);
});

test("OUT-02 調節計 → スプリット → 弁 2 つ：片方を MAN にすると調節計がその場で止まり、もう片方の弁も動かない（戻り信号は 2 スキャン遅れ）", () => {
  const pid = new PB_Pid(), spl = new PB_Split(), a = new PB_AnaOut(), b = new PB_AnaOut();
  const cp = pidCfg(), cs = splitDefaultCfg(), ca = anaOutDefaultCfg(), cb = anaOutDefaultCfg();
  const ip = { PV: 50, dt: 0.25, ReqSeq: 0 }, ib = { dt: 0.25, ReqSeq: 0 };
  const log = [];
  const scan = (init = false) => {
    pid.call({ ...ip, TrkOn: !spl.BkOk, TrkVal: spl.BkVal, Init: init }, cp);
    spl.call({ In: pid.MV, BkOkA: a.BkOk, BkValA: a.BkVal, BkOkB: b.BkOk, BkValB: b.BkVal }, cs);
    a.call({ In: spl.OutA, dt: 0.25, ReqSeq: 0, Init: init }, ca);
    b.call({ ...ib, In: spl.OutB, Init: init }, cb);
    log.push([pid.MV, a.OutPct, b.OutPct, spl.BkOk].map(r));
  };
  scan(true); // 1：スプリットは前のスキャンの弁（まだ呼んでいない）を見るので BkOk FALSE。BkVal は今の MV
  Object.assign(ip, { ReqSeq: 1, ReqItem: 1, ReqValue: 1, ReqWriter: 1 });
  scan(); // 2：調節計は BkVal 30 に追従するだけ（跳ねない）
  ip.PV = 60;
  scan(); // 3：MV 40 → A 80 %
  Object.assign(ib, { ReqSeq: 1, ReqItem: 1, ReqValue: 0, ReqWriter: 1 }); // B を MAN
  scan(); // 4
  scan(); // 5：スプリットが B の BkOk FALSE を受ける
  ip.PV = 80;
  scan(); // 6：調節計は止まっている（偏差が増えても MV 40、A 80 % のまま）
  scan(); // 7
  Object.assign(ib, { ReqSeq: 2, ReqValue: 1 }); // B を AUT
  scan(); // 8
  scan(); // 9：スプリットの BkOk が戻る
  scan(); // 10：調節計は止まっていた間の偏差を今に合わせているので跳ねない
  ip.PV = 90;
  scan(); // 11：+10 → MV 50 → A 100 %
  ip.PV = 100;
  scan(); // 12：MV 60 → B 20 %
  assert.deepEqual(log, [
    [30, 60, 0, false],
    [30, 60, 0, true],
    [40, 80, 0, true],
    [40, 80, 0, true],
    [40, 80, 0, false],
    [40, 80, 0, false],
    [40, 80, 0, false],
    [40, 80, 0, false],
    [40, 80, 0, true],
    [40, 80, 0, true],
    [50, 100, 0, true],
    [60, 100, 20, true],
  ]);
});

/**
 * オーバーライド（PB_Pid 15 章・PB_Select 4 章）：流量 FIC と圧力 PIC の 2 台 → 低選択 → 弁。
 * どちらも逆動作・PB 100（K = 1）・TI 1・dt 0.25（一次遅れの係数 0.2）。FIC は SP 50・MV 40、PIC は SP 80・MV 60。
 * つなぎ方：調節計 n の ErfOn ← TRUE、ErfVal ← SEL.Out、TrkOn ← SEL.TrkAll、TrkVal ← SEL.Out（前のスキャンの値）。
 * 期待値は仕様書の式から別に計算したもの（実装の出力ではない）。
 */
test("OVR-01 オーバーライド：圧力が上がると圧力の調節計が弁を絞り、戻ると流量に戻る。弁が MAN の間は両方とも弁に追従し、AUT に戻しても跳ねない", () => {
  const fic = new PB_Pid(), pic = new PB_Pid(), sel = new PB_Select(), ao = new PB_AnaOut();
  const cf = { ...pidDefaultCfg(), Action: 0, TI: 1, SP: 50, MV: 40 };
  const cp = { ...pidDefaultCfg(), Action: 0, TI: 1, SP: 80, MV: 60 };
  const cs = { ...selectDefaultCfg(), Sel: 1, Use: 3 };
  const co = anaOutDefaultCfg();
  const iF = { PV: 50, dt: 0.25, ReqSeq: 0 }, iP = { PV: 70, dt: 0.25, ReqSeq: 0 }, iO = { dt: 0.25, ReqSeq: 0 };
  const log = [];
  for (let t = 1; t <= 13; t++) {
    const init = t === 1;
    if (t === 2) for (const i of [iF, iP]) Object.assign(i, { ReqSeq: 1, ReqItem: 1, ReqValue: 1, ReqWriter: 1 }); // 両方 AUT
    if (t === 4) iP.PV = 85; // 圧力が SP 80 を超える
    if (t === 7) iP.PV = 70; // 戻る
    if (t === 8) Object.assign(iO, { ReqSeq: 1, ReqItem: 1, ReqValue: 0, ReqWriter: 1 }); // 弁を MAN
    if (t === 11) Object.assign(iO, { ReqSeq: 2, ReqValue: 1 }); // 弁を AUT
    const back = { ErfOn: true, ErfVal: sel.Out, TrkOn: sel.TrkAll, TrkVal: sel.Out, Init: init };
    fic.call({ ...iF, ...back }, cf);
    pic.call({ ...iP, ...back }, cp);
    sel.call({ In1: fic.MV, In2: pic.MV, BkOkIn: ao.BkOk, BkValIn: ao.BkVal, Init: init }, cs);
    ao.call({ ...iO, In: sel.Out, Init: init }, co);
    log.push([fic.MV, pic.MV, sel.SelNo, sel.Out, sel.TrkAll, ao.OutPct]);
  }
  const want = [
    [40, 60, 1, 40, false, 40],
    [40, 58, 1, 40, false, 40],
    [40, 56.4, 1, 40, false, 40],
    [40, 40.12, 1, 40, false, 40], // 4：圧力の偏差 −5 → PIC は 40.12（まだ FIC が低い）
    [40, 39.096, 2, 39.096, false, 39.096], // 5：PIC に切り替わる
    [39.8192, 38.096, 2, 38.096, false, 38.096], // 6：圧力が高いあいだ PIC の積分で絞り続ける。FIC は弁の値＋比例分で待つ
    [39.4746, 52.096, 1, 39.4746, false, 39.4746], // 7：圧力が戻ると FIC に戻る
    [39.4746, 51.5717, 1, 39.4746, false, 39.4746], // 8：弁を MAN
    [39.4746, 51.1523, 1, 39.4746, true, 39.4746], // 9：セレクタが弁の BkOk FALSE を受け、TrkAll
    [39.4746, 39.4746, 1, 39.4746, true, 39.4746], // 10：両方とも弁に追従
    [39.4746, 39.4746, 1, 39.4746, true, 39.4746], // 11：弁を AUT（In ＝ 弁の値なので跳ねない）
    [39.4746, 39.4746, 1, 39.4746, false, 39.4746],
    [39.4746, 41.4746, 1, 39.4746, false, 39.4746], // 13：外部リセットで続く（PIC は弁の値＋比例分）
  ];
  log.forEach((row, i) =>
    row.forEach((v, k) => {
      const w = want[i][k];
      if (typeof w === "number") assert.ok(Math.abs(v - w) < 0.001, `s${i + 1} [${k}] ${v}（期待 ${w}）`);
      else assert.equal(v, w, `s${i + 1} [${k}]`);
    }),
  );
});
