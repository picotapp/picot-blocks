(*
 * PB_Split（スプリットレンジ）基本版
 * 仕様：spec/blocks/PB_Split_基本版.md v0.2（節の番号はこの仕様書）
 * テストベクタ：test-vectors/PB_Split_基本版.json（JS 参照実装と同じものを流す）
 * 書き方の決まり：C-1〜C-8
 * 使うもの：PB_Common.st（PB_IsFinite）
 *
 * 調節計の MV（%）を 2 つの開度 A・B（%）に分ける。どちらかの下流が調節計の値を使っていなければ、
 * 調節計をその場で止める（BkOk = FALSE、BkVal = 今の In）。dt・Init・要求の口を持たない。
 * BkOkA・BkOkB は必ずつなぐ（15-2）。
 *)

(* 設定（4 章）。利用者のプログラムが保持領域に置き、FB に VAR_IN_OUT で渡す *)
TYPE PB_Split_Cfg :
STRUCT
  InLoA : REAL;
  InHiA : REAL;
  OutLoA : REAL;
  OutHiA : REAL;
  InLoB : REAL;
  InHiB : REAL;
  OutLoB : REAL;
  OutHiB : REAL;
END_STRUCT
END_TYPE

FUNCTION_BLOCK PB_Split
VAR_INPUT
  In : REAL;         (* 調節計の MV（%） *)
  BkOkA : BOOL;      (* 出力 A の下流の戻り信号 *)
  BkValA : REAL;     (* 基本版では使わない（拡張版の逆算用） *)
  BkOkB : BOOL;
  BkValB : REAL;
END_VAR
VAR_IN_OUT
  Cfg : PB_Split_Cfg;
END_VAR
VAR_OUTPUT
  OutA : REAL;
  OutB : REAL;
  BkOk : BOOL;
  BkVal : REAL;
  STS : WORD;
  MODE : WORD;
  ALM : WORD;
  DIAG : WORD;
END_VAR
VAR
  cfgErr : BOOL;
  inOk : BOOL;
  x : REAL;
  w : WORD;
END_VAR

inOk := PB_IsFinite(In);
IF inOk THEN
  BkVal := In;                                  (* 15-3・15-4：数でなければ最後の数 *)
END_IF;
MODE := 0;
ALM := 0;

(* ---- 設定の検査（4 章） ---- *)
cfgErr := FALSE;
IF NOT (PB_IsFinite(Cfg.InLoA) AND PB_IsFinite(Cfg.InHiA) AND PB_IsFinite(Cfg.OutLoA) AND PB_IsFinite(Cfg.OutHiA)) THEN cfgErr := TRUE; END_IF;
IF NOT (PB_IsFinite(Cfg.InLoB) AND PB_IsFinite(Cfg.InHiB) AND PB_IsFinite(Cfg.OutLoB) AND PB_IsFinite(Cfg.OutHiB)) THEN cfgErr := TRUE; END_IF;
IF NOT cfgErr THEN
  IF (Cfg.InLoA < 0.0) OR (Cfg.InLoA > 100.0) OR (Cfg.InHiA < 0.0) OR (Cfg.InHiA > 100.0) THEN cfgErr := TRUE; END_IF;
  IF (Cfg.OutLoA < 0.0) OR (Cfg.OutLoA > 100.0) OR (Cfg.OutHiA < 0.0) OR (Cfg.OutHiA > 100.0) THEN cfgErr := TRUE; END_IF;
  IF (Cfg.InLoB < 0.0) OR (Cfg.InLoB > 100.0) OR (Cfg.InHiB < 0.0) OR (Cfg.InHiB > 100.0) THEN cfgErr := TRUE; END_IF;
  IF (Cfg.OutLoB < 0.0) OR (Cfg.OutLoB > 100.0) OR (Cfg.OutHiB < 0.0) OR (Cfg.OutHiB > 100.0) THEN cfgErr := TRUE; END_IF;
  IF (Cfg.InLoA >= Cfg.InHiA) OR (Cfg.InLoB >= Cfg.InHiB) THEN cfgErr := TRUE; END_IF;
END_IF;

IF cfgErr THEN
  (* 15-4：出力を保持、BkOk FALSE、品質 Bad（計器） *)
  BkOk := FALSE;
  STS := 16#0001 OR 16#0010 OR 16#0020 OR 16#0080;
  DIAG := 16#0002;
ELSE
  IF inOk THEN
    x := LIMIT(Cfg.InLoA, In, Cfg.InHiA);
    (* C-8：設定の検査で InLo < InHi を確かめている *)
    OutA := Cfg.OutLoA + ((x - Cfg.InLoA) / (Cfg.InHiA - Cfg.InLoA)) * (Cfg.OutHiA - Cfg.OutLoA);
    x := LIMIT(Cfg.InLoB, In, Cfg.InHiB);
    (* C-8：同上 *)
    OutB := Cfg.OutLoB + ((x - Cfg.InLoB) / (Cfg.InHiB - Cfg.InLoB)) * (Cfg.OutHiB - Cfg.OutLoB);
  END_IF;
  BkOk := BkOkA AND BkOkB;
  STS := 16#0001;
  w := 0;
  IF NOT inOk THEN w := w OR 16#0008; END_IF;
  IF NOT BkOkA THEN w := w OR 16#0010; END_IF;
  IF NOT BkOkB THEN w := w OR 16#0020; END_IF;
  DIAG := w;
END_IF;

END_FUNCTION_BLOCK
