/**
 * テストベクタ（test-vectors/*.json）を参照実装に流す。形式は test-vectors/README.md。
 * 期待値は仕様書から手で起こしたもので、この実装から作ったものではない（NF-4）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PB_AnaMon } from "../src/PB_AnaMon.js";
import { PB_BinMon } from "../src/PB_BinMon.js";
import { PB_DevCore } from "../src/PB_DevCore.js";
import { PB_Pid } from "../src/PB_Pid.js";
import { PB_Intlk } from "../src/PB_Intlk.js";
import { PB_AnaOut } from "../src/PB_AnaOut.js";
import { PB_Split } from "../src/PB_Split.js";
import { PB_Select } from "../src/PB_Select.js";
import { PB_ReqDispatch, newPorts } from "../src/PB_ReqDispatch.js";

const dir = fileURLToPath(new URL("../../test-vectors/", import.meta.url));
import { BITS, EXACT, STS_FLAGS } from "./bits.js";

const num = (v) => (Array.isArray(v) ? v.map(num) : v === "NaN" ? NaN : v === "Inf" ? Infinity : v === "-Inf" ? -Infinity : v);

/** 1 ステップの出力を期待値と比べる。違いを文字列の配列で返す */
function check(fb, cfg, exp, tol, { alm: ALM_BITS, diag: DIAG_BITS }, ports) {
  const errs = [];
  const near = (name, got, want) => {
    if (typeof want === "boolean" || Number.isInteger(want) && EXACT.includes(name)) {
      if (got !== want) errs.push(`${name}: ${got}（期待 ${want}）`);
    } else if (Number.isNaN(num(want)) ? !Number.isNaN(got) : !(Math.abs(got - num(want)) <= tol)) errs.push(`${name}: ${got}（期待 ${want}）`);
  };
  for (const [k, want] of Object.entries(exp)) {
    if (k === "q") near("q", (fb.STS >> 3) & 3, want);
    else if (k === "cause") near("cause", (fb.STS >> 5) & 1, want);
    else if (k in STS_FLAGS) near(k, (fb.STS & STS_FLAGS[k]) !== 0, want);
    else if (k === "alm") {
      const got = Object.keys(ALM_BITS).filter((n) => fb.ALM & ALM_BITS[n]);
      if (got.sort().join() !== [...want].sort().join()) errs.push(`alm: [${got}]（期待 [${want}]）`);
    } else if (k === "diag") {
      const got = Object.keys(DIAG_BITS).filter((n) => fb.DIAG & DIAG_BITS[n]);
      if (got.sort().join() !== [...want].sort().join()) errs.push(`diag: [${got}]（期待 [${want}]）`);
    } else if (k.startsWith("cfg.")) near(k, cfg[k.slice(4)], want);
    else if (k.startsWith("port.")) {
      const [, n, name] = k.split(".");
      near(k, ports[Number(n) - 1][name], want);
    }
    else near(k, fb[k], want);
  }
  return errs;
}

function runFile(name, Block) {
  const v = JSON.parse(readFileSync(dir + name, "utf8"));
  for (const c of v.cases) {
    test(`${c.id} ${c.title}`, () => {
      const cfg = Object.fromEntries(Object.entries({ ...v.configs[c.config], ...(c.cfg ?? {}) }).map(([k, x]) => [k, num(x)]));
      const fb = new Block();
      const inp = {};
      const ports = newPorts(); // PB_ReqDispatch の口（他のブロックは使わない）
      c.steps.forEach((s, i) => {
        for (const [k, x] of Object.entries(s.cfgSet ?? {})) cfg[k] = num(x);
        for (const [n, p] of Object.entries(s.portSet ?? {})) Object.assign(ports[Number(n) - 1], p);
        Object.assign(inp, Object.fromEntries(Object.entries(s.in ?? {}).map(([k, x]) => [k, num(x)])));
        // repeat：同じ入力で何スキャンも呼び、最後のスキャンの後だけ確かめる
        for (let r = 0; r < (s.repeat ?? 1); r++) fb.call({ ...inp, Init: !!s.in?.Init }, cfg, ports);
        const errs = check(fb, cfg, s.expect ?? {}, v.tolerance.abs, BITS[v.block], ports);
        assert.deepEqual(errs, [], `${c.id} ステップ ${i + 1}：${errs.join("、")}`);
      });
    });
  }
}

runFile("PB_AnaMon_基本版.json", PB_AnaMon);
runFile("PB_BinMon_基本版.json", PB_BinMon);
runFile("PB_DevCore_基本版.json", PB_DevCore);
runFile("PB_Pid_基本版.json", PB_Pid);
runFile("PB_Intlk_基本版.json", PB_Intlk);
runFile("PB_ReqDispatch_基本版.json", PB_ReqDispatch);
runFile("PB_AnaOut_基本版.json", PB_AnaOut);
runFile("PB_Split_基本版.json", PB_Split);
runFile("PB_Select_基本版.json", PB_Select);
