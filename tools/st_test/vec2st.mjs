#!/usr/bin/env node
/**
 * テストベクタ（test-vectors/*.json）→ STruC++ の試験ファイル（TEST ブロック）に変える。
 * JS の試験（js/test/vectors.test.js）と同じ比べ方をする：
 *   q・cause・oos などの印は STS から取り出す、alm・diag はビットの名前の一覧、cfg.X は設定、port.N.X は受付箱の口。
 * 型は ST のソースの宣言（VAR_INPUT・VAR_OUTPUT・VAR_IN_OUT と TYPE … STRUCT）から読む。
 *
 * 使い方：node vec2st.mjs <ベクタ.json> <出力.st> <a.st> [b.st ...]
 *
 * STruC++ 0.8.0 の試験での注意（2026-11-25 に確認）：
 *   - TEST の中で FB を呼ぶと、VAR_IN_OUT の書き戻しが起きない（PROGRAM の中では起きる）。
 *     → 呼んだ後に `tc := fb.Cfg;` で取り戻す。
 *   - 名前は大文字にして C++ に出るので、C のマクロ（NAN・INFINITY など）とぶつかる名前は使えない。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { BITS, STS_FLAGS } from "../../js/test/bits.js";

const [vecPath, outPath, ...stPaths] = process.argv.slice(2);
if (!vecPath || !outPath || stPaths.length === 0) {
  console.error("使い方：node vec2st.mjs <ベクタ.json> <出力.st> <a.st> [b.st ...]");
  process.exit(2);
}
const vec = JSON.parse(readFileSync(vecPath, "utf8"));
const st = stPaths.map((p) => readFileSync(p, "utf8")).join("\n").replace(/\(\*[\s\S]*?\*\)/g, "");

// ---- ST の宣言を読む ----
/** "name : TYPE;" の並びを {name: TYPE} に */
function decls(body) {
  const out = {};
  for (const m of body.matchAll(/^\s*(\w+)\s*:\s*([^;:=]+?)\s*(?::=[^;]*)?;/gm)) out[m[1]] = m[2].trim().toUpperCase();
  return out;
}
const structs = {};
for (const m of st.matchAll(/TYPE\s+(\w+)\s*:\s*STRUCT([\s\S]*?)END_STRUCT/g)) structs[m[1]] = decls(m[2]);
const fbm = st.match(new RegExp(`FUNCTION_BLOCK\\s+${vec.block}\\b([\\s\\S]*?)END_FUNCTION_BLOCK`));
if (!fbm) throw new Error(`${vec.block} が ST に無い`);
const sect = (kw) => {
  const m = fbm[1].match(new RegExp(`\\b${kw}\\b([\\s\\S]*?)END_VAR`));
  return m ? decls(m[1]) : {};
};
const inputs = sect("VAR_INPUT");
const outputs = sect("VAR_OUTPUT");
const inouts = Object.entries(sect("VAR_IN_OUT")); // [設定, 口（受付箱だけ）]
const [cfgName, cfgType] = inouts[0] ?? [];
const [portsName, portsType] = inouts[1] ?? [];
const cfgFields = cfgType ? structs[Object.keys(structs).find((k) => k.toUpperCase() === cfgType)] : {};
let portFields = {};
if (portsType) {
  const el = portsType.match(/OF\s+(\w+)/)?.[1];
  portFields = structs[Object.keys(structs).find((k) => k.toUpperCase() === el)] ?? {};
}

// ---- 値の書き方 ----
const INTS = ["INT", "DINT", "SINT", "UINT", "UDINT", "USINT", "WORD", "DWORD", "BYTE"];
function lit(type, v) {
  if (type === "BOOL") {
    if (typeof v !== "boolean") throw new Error(`BOOL に ${v}`);
    return v ? "TRUE" : "FALSE";
  }
  if (INTS.includes(type)) {
    if (!Number.isInteger(v)) throw new Error(`${type} に ${v}`);
    return String(v);
  }
  if (type === "REAL") {
    if (v === "NaN") return "vNaN";
    if (v === "Inf") return "vInf";
    if (v === "-Inf") return "(-vInf)";
    if (typeof v !== "number") throw new Error(`REAL に ${v}`);
    if (Number.isInteger(v) && Math.abs(v) < 1e15) return `${v}.0`;
    const s = String(v);
    return s.includes("e") ? v.toExponential().replace(/e\+?/, "E").replace(/^(-?\d)E/, "$1.0E") : s;
  }
  throw new Error(`型 ${type} は未対応`);
}
const typeOf = (table, name, where) => {
  const t = table[name];
  if (!t) throw new Error(`${where}：${name} が ST の宣言に無い`);
  return t;
};

/** 比べる式。REAL は許容誤差、NaN は「自分と等しくない」 */
function assertVal(expr, type, want, msg, tol) {
  if (type === "BOOL") return `ASSERT_${want ? "TRUE" : "FALSE"}(${expr}, '${msg}');`;
  if (type === "REAL") {
    if (want === "NaN") return `ASSERT_FALSE(${expr} = ${expr}, '${msg}');`;
    return `ASSERT_NEAR(${expr}, ${lit("REAL", want)}, ${lit("REAL", tol)}, '${msg}');`;
  }
  return `ASSERT_EQ(${expr}, ${lit(type, want)}, '${msg}');`;
}
const mask = (table, names, what) =>
  names.reduce((m, n) => {
    if (!(n in table)) throw new Error(`${what} のビット名 ${n} が無い`);
    return m | table[n];
  }, 0);
const all = (table) => Object.values(table).reduce((a, b) => a | b, 0);

/** 設定の 1 項目を書く行。配列（例：ARRAY[1..8] OF REAL）は要素ごと。JSON の配列の 0 番目が下限の番号 */
function setCfg(k, v) {
  const t = typeOf(cfgFields, k, "設定");
  const arr = t.match(/^ARRAY\s*\[\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*\]\s*OF\s+(\w+)$/);
  if (!arr) {
    // 整数の型に小数など、ST の型で表せない値（JS だけで試せる場面）は書かずに飛ばす
    if (INTS.includes(t) && typeof v === "number" && !Number.isInteger(v)) {
      console.warn(`警告：設定 ${k} = ${v} は ${t} で表せないので飛ばした（JS だけの場面）`);
      return [`  (* 設定 ${k} = ${v} は ${t} で表せないので書かない（JS だけの場面） *)`];
    }
    return [`  tc.${k} := ${lit(t, v)};`];
  }
  const [lo, hi, el] = [Number(arr[1]), Number(arr[2]), arr[3]];
  if (!Array.isArray(v) || v.length !== hi - lo + 1) throw new Error(`設定 ${k} は要素 ${hi - lo + 1} 個の配列`);
  return v.map((x, i) => `  tc.${k}[${lo + i}] := ${lit(el, x)};`);
}

// ---- 試験ファイル ----
const tol = vec.tolerance.abs;
const bits = BITS[vec.block];
const L = [];
L.push(`(* ${vec.block}：${vecPath.split("/").pop()} から vec2st.mjs で作った。手で直さない *)`, "");
for (const c of vec.cases) {
  const id = c.id;
  L.push(`TEST '${id}'`);
  L.push("  VAR");
  L.push(`    fb : ${vec.block};`);
  if (cfgType) L.push(`    tc : ${cfgType};`);
  if (portsType) L.push(`    tp : ${portsType};`);
  L.push("    vZero : REAL;", "    vNaN : REAL;", "    vInf : REAL;");
  L.push("  END_VAR");
  L.push("  vZero := 0.0;", "  vNaN := vZero / vZero;", "  vInf := 1.0 / vZero;");
  const cfg = { ...vec.configs[c.config], ...(c.cfg ?? {}) };
  for (const [k, v] of Object.entries(cfg)) L.push(...setCfg(k, v));
  c.steps.forEach((s, i) => {
    const tag = `${id} s${i + 1}`;
    L.push(`  (* ステップ ${i + 1} *)`);
    for (const [k, v] of Object.entries(s.cfgSet ?? {})) L.push(...setCfg(k, v));
    for (const [n, p] of Object.entries(s.portSet ?? {}))
      for (const [k, v] of Object.entries(p)) L.push(`  tp[${n}].${k} := ${lit(typeOf(portFields, k, "口"), v)};`);
    const args = [];
    for (const [k, v] of Object.entries(s.in ?? {})) {
      if (k === "Init") continue;
      args.push(`${k} := ${lit(typeOf(inputs, k, "入力"), v)}`);
    }
    if ("INIT" in Object.fromEntries(Object.keys(inputs).map((k) => [k.toUpperCase(), 1]))) args.push(`Init := ${s.in?.Init ? "TRUE" : "FALSE"}`); // Init を持たないブロック（PB_Split など）もある
    if (cfgType) args.push(`${cfgName} := tc`);
    if (portsType) args.push(`${portsName} := tp`);
    // repeat：同じ入力で何スキャンも呼ぶ（呼ぶ行を並べる。FOR を使わないのは試験の変数を増やさないため）
    for (let r = 0; r < (s.repeat ?? 1); r++) {
      L.push(`  fb(${args.join(", ")});`);
      if (cfgType) L.push(`  tc := fb.${cfgName};`);
      if (portsType) L.push(`  tp := fb.${portsName};`);
    }
    for (const [k, want] of Object.entries(s.expect ?? {})) {
      const msg = `${tag} ${k}`;
      if (k === "q") L.push(`  ASSERT_EQ(SHR(fb.STS, 3) AND 16#0003, ${want}, '${msg}');`);
      else if (k === "cause") L.push(`  ASSERT_EQ(SHR(fb.STS, 5) AND 16#0001, ${want}, '${msg}');`);
      else if (k in STS_FLAGS) L.push(`  ASSERT_${want ? "TRUE" : "FALSE"}((fb.STS AND ${STS_FLAGS[k]}) <> 0, '${msg}');`);
      else if (k === "alm" || k === "diag") {
        const table = bits[k];
        const m = mask(table, want, k);
        if (all(table) === 0) {
          if (want.length) throw new Error(`${tag}：${k} のビットが無いブロックに ${want}`);
          continue;
        }
        L.push(`  ASSERT_EQ(fb.${k.toUpperCase()} AND ${all(table)}, ${m}, '${msg}');`);
      } else if (k.startsWith("cfg.")) {
        const f = k.slice(4);
        L.push(`  ${assertVal(`tc.${f}`, typeOf(cfgFields, f, "設定"), want, msg, tol)}`);
      } else if (k.startsWith("port.")) {
        const [, n, f] = k.split(".");
        L.push(`  ${assertVal(`tp[${n}].${f}`, typeOf(portFields, f, "口"), want, msg, tol)}`);
      } else L.push(`  ${assertVal(`fb.${k}`, typeOf(outputs, k, "出力"), want, msg, tol)}`);
    }
  });
  L.push("END_TEST", "");
}
writeFileSync(outPath, L.join("\n"));
console.log(`${outPath}：${vec.cases.length} 件`);
