#!/usr/bin/env node
/**
 * 書き方の決まり（要件定義 4.1 の C-1〜C-8）と、STruC++・他社の PLC で困る書き方を検査する（NF-1）。
 * OpenPLC で通ってもほかの機種で通らない書き方を、コンパイルの前に見つけるため。
 *
 * 使い方：node check.mjs [a.st ...]（省略すると st/*.st）
 * 終了コード：誤りがあれば 1。注意（要確認）だけなら 0。
 *
 * 注釈で認めるもの（同じ行か 1 行上の注釈に書く）：
 *   C-8：変数で割る所。割る数が 0・NaN にならない理由を書く
 *   C-4：宣言の初期値。なぜ要るかを書く（初期値の無い PLC では効かないので注意として残る）
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ST_DIR = resolve(here, "../../st");
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(ST_DIR).filter((f) => f.endsWith(".st")).map((f) => join(ST_DIR, f));

/** IEC 61131-3 の標準関数（C-1）。型変換 *_TO_* は別に認める */
const STD_FUNCS = new Set(
  ("ABS SQRT LN LOG EXP SIN COS TAN ASIN ACOS ATAN EXPT MOVE SHL SHR ROL ROR SEL MAX MIN LIMIT MUX TRUNC " +
    "ADD SUB MUL DIV MOD GT GE EQ LE LT NE").split(" "),
);
/** ST の制御の語（後ろに「(」が来ても関数ではない） */
const KEYWORDS = new Set(
  "IF THEN ELSIF ELSE END_IF CASE OF END_CASE FOR TO BY DO END_FOR WHILE END_WHILE REPEAT UNTIL END_REPEAT RETURN EXIT AND OR XOR NOT MOD".split(" "),
);
/** 時間を持つ標準 FB（C-2：dt で数える） */
const TIMER_FBS = new Set(["TON", "TOF", "TP", "RTC", "LTON", "LTOF", "LTP"]);
/** STruC++ は名前を大文字にして C++ に出す。C・C++ のマクロや標準の名前とぶつかるとコンパイルで止まる */
const C_NAMES = new Set(
  "NAN INFINITY EOF NULL EDOM ERANGE HUGE_VAL FLT_MAX FLT_MIN DBL_MAX DBL_MIN INT_MAX INT_MIN UINT_MAX CHAR_BIT M_PI M_E ASSERT ERRNO STDIN STDOUT STDERR TRUE FALSE BOOL".split(" "),
);

/** ライブラリ全体の FUNCTION・FUNCTION_BLOCK（別のファイルの共通の関数も呼べる） */
const libFuncs = new Set();
const libFbs = new Set();
for (const f of files) {
  for (const l of readFileSync(f, "utf8").split("\n")) {
    const fb = l.match(/^\s*FUNCTION_BLOCK\s+(\w+)/i);
    if (fb) libFbs.add(fb[1].toUpperCase());
    else {
      const fn = l.match(/^\s*FUNCTION\s+(\w+)/i);
      if (fn) libFuncs.add(fn[1].toUpperCase());
    }
  }
}

let errors = 0;
let notes = 0;
const err = (f, line, rule, msg) => {
  errors++;
  console.log(`誤り ${basename(f)}:${line} [${rule}] ${msg}`);
};
const note = (f, line, rule, msg) => {
  notes++;
  console.log(`注意 ${basename(f)}:${line} [${rule}] ${msg}`);
};

for (const f of files) {
  const raw = readFileSync(f, "utf8").split("\n");
  // 注釈を消した行（行の番号を保つ）と、行ごとの注釈の中身
  const code = [];
  const comments = [];
  let inC = false;
  let inCfg = false;
  for (const line of raw) {
    let out = "";
    let com = "";
    for (let i = 0; i < line.length; i++) {
      if (!inC && line.startsWith("(*", i)) { inC = true; i++; continue; }
      if (inC && line.startsWith("*)", i)) { inC = false; i++; continue; }
      if (inC) com += line[i];
      else out += line[i];
    }
    // 文字列（試験の名前など）は中身を見ない
    code.push(out.replace(/'[^']*'/g, "''"));
    // CONFIGURATION（タスクの宣言など）は書き方の決まりの外なので見ない
    if (/^\s*CONFIGURATION\b/i.test(out)) inCfg = true;
    if (inCfg) code[code.length - 1] = "";
    if (/^\s*END_CONFIGURATION\b/i.test(out)) inCfg = false;
    comments.push(com);
  }
  const marked = (i, tag) => comments[i].includes(tag) || (i > 0 && comments[i - 1].includes(tag));

  // ---- POU ごとの宣言 ----
  let pou = null; // { name, kind, start, decls: [{name, type, line}] }
  let inVar = false;
  let varKind = "";
  const pous = [];
  const fbTypes = new Set(libFbs);
  const funcs = new Set(libFuncs);
  code.forEach((l) => {
    const m = l.match(/^\s*FUNCTION_BLOCK\s+(\w+)/i);
    if (m) fbTypes.add(m[1].toUpperCase());
    const n = l.match(/^\s*FUNCTION\s+(\w+)/i);
    if (n) funcs.add(n[1].toUpperCase());
  });
  code.forEach((l, i) => {
    const ln = i + 1;
    const start = l.match(/^\s*(FUNCTION_BLOCK|FUNCTION|PROGRAM|TYPE)\s+(\w+)/i);
    if (start) {
      pou = { name: start[2], kind: start[1].toUpperCase(), start: ln, decls: [] };
      pous.push(pou);
    }
    if (/^\s*(VAR|VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_GLOBAL|VAR_TEMP|VAR_EXTERNAL)\b/i.test(l)) {
      inVar = true;
      varKind = l.trim().split(/\s+/)[0].toUpperCase();
      return;
    }
    if (/^\s*END_VAR\b/i.test(l)) { inVar = false; return; }
    const isStruct = pou?.kind === "TYPE";
    if ((inVar || isStruct) && pou) {
      const d = l.match(/^\s*(\w+)\s*:\s*([^;:=]+?)\s*(:=\s*[^;]*)?;/);
      if (d && !/^(STRUCT|END_STRUCT|END_TYPE)$/i.test(d[1])) {
        pou.decls.push({ name: d[1], type: d[2].trim(), line: ln, init: !!d[3], kind: isStruct ? "STRUCT" : varKind });
        // C-4：宣言の初期値（構造体の型の中は値を持たないので除く）
        if (d[3] && !isStruct && !marked(i, "C-4")) err(f, ln, "C-4", `${d[1]} に宣言の初期値がある（初期値の無い PLC では効かない。要るなら理由を (* C-4 … *) で書く）`);
        else if (d[3] && !isStruct) note(f, ln, "C-4", `${d[1]} の宣言の初期値（注釈あり：${(comments[i] || comments[i - 1]).trim()}）。初期値の無い PLC では利用者がつなぐ`);
      }
    }
  });

  for (const p of pous) {
    // 大文字・小文字だけ違う名前（ST は区別しない）。POU の名前も含める
    const seen = new Map();
    for (const d of [{ name: p.name, line: p.start }, ...p.decls]) {
      const k = d.name.toUpperCase();
      if (seen.has(k)) err(f, d.line, "名前", `${d.name} は ${seen.get(k).name}（${seen.get(k).line} 行）と同じ名前になる（ST は大文字・小文字を区別しない）`);
      else seen.set(k, d);
    }
    for (const d of p.decls) {
      const k = d.name.toUpperCase();
      if (k === "EN" || k === "ENO") err(f, d.line, "名前", `${d.name} は IEC の EN・ENO とぶつかる（STruC++ では黙って動かない）`);
      if (C_NAMES.has(k)) err(f, d.line, "名前", `${d.name} は大文字にすると C・C++ の名前 ${k} とぶつかる`);
      const t = d.type.toUpperCase();
      if (TIMER_FBS.has(t)) err(f, d.line, "C-2", `${d.name} : ${d.type}（タイマー FB は使わず dt で数える）`);
      if (/\bLREAL\b/.test(t)) err(f, d.line, "C-7", `${d.name} : ${d.type}（LREAL は使わない）`);
      if (/\b(STRING|WSTRING|POINTER|REF_TO|REFERENCE)\b/.test(t)) err(f, d.line, "C-6", `${d.name} : ${d.type}（文字列・ポインター・参照は使わない）`);
      if (/ARRAY\s*\[\s*\*/.test(t)) err(f, d.line, "C-6", `${d.name} : ${d.type}（可変長の配列は使わない）`);
    }
  }
  // 名前の型（FOR の数え上げの変数を見るため）
  const typeOf = new Map();
  for (const p of pous) for (const d of p.decls) typeOf.set(d.name.toUpperCase(), d.type.toUpperCase());
  const instances = new Set();
  for (const p of pous) for (const d of p.decls) if (fbTypes.has(d.type.toUpperCase()) || TIMER_FBS.has(d.type.toUpperCase())) instances.add(d.name.toUpperCase());

  // ---- 本文 ----
  code.forEach((l, i) => {
    const ln = i + 1;
    // C-1：IEC 61131-3 第 3 版の OOP の書き方は、対応していない機種がある
    for (const kw of ["METHOD", "PROPERTY", "INTERFACE", "EXTENDS", "IMPLEMENTS", "THIS", "SUPER"]) {
      if (new RegExp(`\\b${kw}\\b`, "i").test(l)) err(f, ln, "C-1", `${kw}（オブジェクト指向の拡張は使わない）`);
    }
    // C-6：ポインター・参照・動的メモリ
    if (/\b(ADR|__NEW|__DELETE|REF)\s*\(|\^/i.test(l)) err(f, ln, "C-6", "ポインター・参照・動的メモリは使わない");
    if (/\bLREAL\b/i.test(l) && !/^\s*\w+\s*:/.test(l)) err(f, ln, "C-7", "LREAL は使わない");
    // C-5：w.0 のようなビット参照
    const bitRef = l.match(/\b([A-Za-z_]\w*)\.(\d+)\b/);
    if (bitRef) err(f, ln, "C-5", `${bitRef[0]}（ビット参照は使わず SHL・SHR・AND・OR で）`);
    // C-1：関数の呼び出し（標準関数・型変換・自分の FUNCTION・FB のインスタンスだけ）
    for (const m of l.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
      const n = m[1].toUpperCase();
      if (KEYWORDS.has(n) || STD_FUNCS.has(n) || funcs.has(n) || instances.has(n) || /^[A-Z]+_TO_[A-Z]+$/.test(n)) continue;
      if (/^\s*(FUNCTION|FUNCTION_BLOCK|PROGRAM)\b/i.test(l)) continue;
      err(f, ln, "C-1", `${m[1]}(…)（標準関数でも、このファイルの FUNCTION・FB でもない）`);
    }
    // C-8：SQRT・LN・LOG は引数の確認が要る
    for (const m of l.matchAll(/\b(SQRT|LN|LOG|EXPT)\s*\(/gi)) {
      if (!marked(i, "C-8")) err(f, ln, "C-8", `${m[1]}（負・0 以下を渡さない理由を (* C-8 … *) で書く）`);
    }
    // C-8：変数で割る所。割る数が数値の定数でなければ、理由の注釈を求める
    for (const m of l.matchAll(/\/\s*(\(|[A-Za-z_])/g)) {
      if (!marked(i, "C-8")) err(f, ln, "C-8", `「/ ${l.slice(m.index + 1).trim().slice(0, 30)}」：割る数が 0・NaN にならない理由を (* C-8 … *) で書く`);
    }
    for (const m of l.matchAll(/\bMOD\s+(\(|[A-Za-z_])/gi)) {
      if (!marked(i, "C-8")) err(f, ln, "C-8", "MOD の割る数が 0 にならない理由を (* C-8 … *) で書く");
    }
    // FOR の数え上げ：INT で上限が 32767 以上だと、最後の回のあとにあふれて終わらない
    const fr = l.match(/\bFOR\s+(\w+)\s*:=\s*[^;]*?\bTO\s+(-?\d+)/i);
    if (fr) {
      const t = typeOf.get(fr[1].toUpperCase());
      const lim = { SINT: 127, INT: 32767, DINT: 2147483647, USINT: 255, UINT: 65535, UDINT: 4294967295 }[t];
      if (lim !== undefined && Number(fr[2]) >= lim) err(f, ln, "FOR", `${fr[1]} : ${t} で TO ${fr[2]}（最後の回のあとにあふれて終わらない）`);
    }
  });
}

console.log(`\n${files.length} ファイル：誤り ${errors} 件、注意 ${notes} 件`);
process.exit(errors ? 1 : 0);
