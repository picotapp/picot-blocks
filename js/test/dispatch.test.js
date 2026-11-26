/**
 * 受付箱（PB_ReqDispatch 仕様書 2 章・12 章の呼び出しコード）：本物のブロックを宛先につなぐ。
 * 期待値は各仕様書から手で起こした（NF-4）。
 * 口 1 = PB_Pid（LIC）、口 2 = PB_Intlk（IL）。宛先は受付箱の後に呼ぶ（1 件 2 スキャン）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PB_ReqDispatch, newPorts, reqDispatchDefaultCfg } from "../src/PB_ReqDispatch.js";
import { PB_Pid, pidDefaultCfg } from "../src/PB_Pid.js";
import { PB_Intlk, intlkDefaultCfg } from "../src/PB_Intlk.js";

function plant() {
  const disp = new PB_ReqDispatch(), dcfg = reqDispatchDefaultCfg(), ports = newPorts();
  const lic = new PB_Pid(), lcfg = { ...pidDefaultCfg(), SP: 50, MV: 30 };
  const il = new PB_Intlk(), icfg = intlkDefaultCfg();
  const box = { BoxSeq: 0, BoxTag: 0, BoxItem: 0, BoxValue: 0, BoxWriter: 0 };
  const io = { In1: false };
  /** 12 章の呼び出しコードと同じ並び */
  const scan = (init = false) => {
    disp.call({ ...box, dt: 0.25, Init: init }, dcfg, ports);
    const p1 = ports[0], p2 = ports[1];
    lic.call({ PV: 50, dt: 0.25, Init: init, ReqSeq: p1.Seq, ReqItem: p1.Item, ReqValue: p1.Value, ReqWriter: p1.Writer }, lcfg);
    p1.AckSeq = lic.AckSeq; p1.Result = lic.Result;
    il.call({ ...io, dt: 0.25, Init: init, ReqSeq: p2.Seq, ReqItem: p2.Item, ReqValue: p2.Value, ReqWriter: p2.Writer }, icfg);
    p2.AckSeq = il.AckSeq; p2.Result = il.Result;
  };
  /** Node-RED が受付箱に 1 件書き、返事が来るまでスキャンする。返事までのスキャン数も返す */
  const send = (tag, item, value, writer) => {
    Object.assign(box, { BoxSeq: box.BoxSeq + 1, BoxTag: tag, BoxItem: item, BoxValue: value, BoxWriter: writer });
    let n = 0;
    while (disp.BoxAck !== box.BoxSeq && n < 10) { scan(); n++; }
    return { result: disp.BoxResult, scans: n };
  };
  scan(true);
  return { disp, lic, lcfg, il, io, scan, send };
}

test("DSP-01 調節計の SP を受付箱で変える：受け付け 0、2 スキャンで返事、値が変わる", () => {
  const p = plant();
  assert.deepEqual(p.send(1, 2, 60, 1), { result: 0, scans: 2 });
  assert.equal(p.lic.SP, 60);
});

test("DSP-02 宛先の結果をそのまま返す：SP のレンジ外 3、MAN の MV は受け付け 0、運転員は PB を書けない 2", () => {
  const p = plant();
  assert.equal(p.send(1, 2, 150, 1).result, 3);
  assert.equal(p.send(1, 3, 40, 1).result, 0);
  assert.equal(p.lcfg.MV, 40);
  assert.equal(p.send(1, 10, 80, 1).result, 2);
  assert.equal(p.lcfg.PB, 100);
});

test("DSP-03 インターロックのリセット：動作していない 10、原因が残っている 11、戻ったら 0", () => {
  const p = plant();
  assert.equal(p.send(2, 1, 1, 1).result, 10);
  p.io.In1 = true;
  p.scan();
  assert.equal(p.il.Trip, true);
  assert.equal(p.send(2, 1, 1, 1).result, 11);
  p.io.In1 = false;
  assert.equal(p.send(2, 1, 1, 1).result, 0);
  assert.equal(p.il.Trip, false);
});

test("DSP-04 つないでいない口（3）は 1 s（始めたスキャン＋4 スキャン）で時間切れ 16、範囲外の口（65）はそのスキャンで 15", () => {
  const p = plant();
  assert.deepEqual(p.send(3, 1, 1, 1), { result: 16, scans: 5 });
  assert.deepEqual(p.send(65, 1, 1, 1), { result: 15, scans: 1 });
  // 続けて正しい宛先も通る
  assert.equal(p.send(1, 2, 55, 2).result, 0);
  assert.equal(p.lic.SP, 55);
});

test("DSP-05 生存カウンター Alive は 32767 の次が 0（13-9）", () => {
  const d = new PB_ReqDispatch(), c = reqDispatchDefaultCfg(), ports = newPorts();
  for (let i = 0; i < 32767; i++) d.call({ dt: 0.25 }, c, ports);
  assert.equal(d.Alive, 32767);
  d.call({ dt: 0.25 }, c, ports);
  assert.equal(d.Alive, 0);
});
