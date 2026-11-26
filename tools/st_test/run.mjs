#!/usr/bin/env node
/**
 * ST のブロックに、JS と同じテストベクタを STruC++ の単体試験で流す（NF-1）。
 *
 * 使い方：node run.mjs [ブロック名 ...]（省略するとできているブロックすべて）
 * STruC++ の場所：環境変数 STRUCPP（既定は PICOT HMI の検証環境に置いたコマンド版 0.8.0）
 * 作った試験ファイルは out/ に置く（リポジトリに入れない）。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const ST = join(root, "st");
const VEC = join(root, "test-vectors");
const OUT = join(here, "out");
const STRUCPP =
  process.env.STRUCPP ?? "strucpp";

/** ブロック → ST のファイル（使う順） */
const BLOCKS = {
  PB_AnaMon: ["PB_Common.st", "PB_AnaMon.st"],
  PB_BinMon: ["PB_Common.st", "PB_BinMon.st"],
  PB_DevCore: ["PB_Common.st", "PB_DevCore.st"],
  PB_Pid: ["PB_Common.st", "PB_Pid.st"],
  PB_Intlk: ["PB_Common.st", "PB_Intlk.st"],
  PB_ReqDispatch: ["PB_Common.st", "PB_ReqDispatch.st"],
  PB_AnaOut: ["PB_Common.st", "PB_AnaOut.st"],
  PB_Split: ["PB_Common.st", "PB_Split.st"],
  PB_Select: ["PB_Common.st", "PB_Select.st"],
};

/** 手で書いた試験（このフォルダー） */
const EXTRA = {
  PB_Pid: ["test_PB_Pid_cascade.st"],
  PB_ReqDispatch: ["test_PB_ReqDispatch_wired.st"],
  PB_AnaOut: ["test_wired_out.st"],
};

/** 手で書いた試験に要る、ほかのソース（st のファイル、またはこのフォルダーの試験専用の FB） */
const EXTRA_SRC = {
  PB_ReqDispatch: [join(ST, "PB_Pid.st"), join(ST, "PB_Intlk.st"), join(here, "harness_dispatch.st")],
  PB_AnaOut: [join(ST, "PB_Pid.st"), join(ST, "PB_Split.st"), join(ST, "PB_Select.st")],
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(BLOCKS);
mkdirSync(OUT, { recursive: true });
let failed = 0;
for (const b of names) {
  if (!BLOCKS[b]) throw new Error(`${b} の ST はまだ無い`);
  const src = BLOCKS[b].map((f) => join(ST, f));
  const test = join(OUT, `test_${b}.st`);
  execFileSync("node", [join(here, "vec2st.mjs"), join(VEC, `${b}_基本版.json`), test, ...src], { stdio: "inherit" });
  // 手で書いた試験（テストベクタの形にしにくいもの。例：カスケード）があれば一緒に流す
  const extra = EXTRA[b] ? EXTRA[b].map((f) => join(here, f)) : [];
  let out;
  try {
    out = execFileSync(STRUCPP, [...src, ...(EXTRA_SRC[b] ?? []), "--test", test, ...extra], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    out = (e.stdout ?? "") + (e.stderr ?? "");
    failed++;
  }
  // C++ の警告（c++17 の inline 変数）は出さない
  const lines = out.split("\n").filter((l) => !/c\+\+17|inline CONSTANTS|^\s*\||^\s*\d+ \||In file included|\^~/.test(l));
  console.log(lines.join("\n"));
  // 試験ファイルごとに「N tests, N passed, N failed」が出る。1 つでも失敗があれば失敗。集計が無ければ（コンパイルで止まった）失敗
  const sums = [...out.matchAll(/(\d+) failed/g)].map((m) => Number(m[1]));
  if (sums.length === 0 || sums.some((n) => n > 0)) failed++;
}
process.exit(failed ? 1 : 0);
