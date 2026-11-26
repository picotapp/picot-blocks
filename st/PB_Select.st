(*
 * PB_Select（セレクタ）基本版
 * 仕様：spec/blocks/PB_Select_基本版.md v0.3（節の番号はこの仕様書）
 * テストベクタ：test-vectors/PB_Select_基本版.json（JS 参照実装と同じものを流す）
 * 書き方の決まり：C-1〜C-8
 * 使うもの：PB_Common.st（PB_IsFinite）
 *
 * 最大 3 つの入力から高・低・中を選ぶ。信号選択（伝送器の冗長）とオーバーライド（調節計の MV）の両方に使う。
 * オーバーライドでは、調節計 n の ErfOn ← TRUE、ErfVal ← Out、TrkOn ← TrkAll、TrkVal ← Out とつなぐ（4 章、PB_Pid 15 章）。
 *)

(* 設定（5 章）。利用者のプログラムが保持領域に置き、FB に VAR_IN_OUT で渡す *)
TYPE PB_Select_Cfg :
STRUCT
  Sel : INT;         (* 0 高・1 低・2 中 *)
  Use : WORD;        (* bit0〜2 ＝ 入力 1〜3 を使う *)
  Fix : INT;         (* 0 自動・1〜3 その入力に固定。保持する値 *)
END_STRUCT
END_TYPE

FUNCTION_BLOCK PB_Select
VAR_INPUT
  In1 : REAL;
  In2 : REAL;
  In3 : REAL;
  Bad1 : BOOL;
  Bad2 : BOOL;
  Bad3 : BOOL;
  BkOkIn : BOOL := TRUE;  (* C-4 例外：下流の戻り信号。つながなければ TRUE（15-5）。初期値の無い PLC では TRUE をつなぐ *)
  BkValIn : REAL;
  Init : BOOL;
  ReqSeq : INT;
  ReqItem : INT;
  ReqValue : REAL;
  ReqWriter : INT;
END_VAR
VAR_IN_OUT
  Cfg : PB_Select_Cfg;
END_VAR
VAR_OUTPUT
  Out : REAL;
  Bad : BOOL;
  SelNo : INT;
  Trk1 : BOOL;
  Trk2 : BOOL;
  Trk3 : BOOL;
  TrkAll : BOOL;     (* 全部の調節計をトラッキングにする（15-9） *)
  STS : WORD;
  MODE : WORD;
  ALM : WORD;
  DIAG : WORD;
  AckSeq : INT;
  Result : INT;
END_VAR
VAR
  (* 1 スキャンの作業用。状態は持たない（Out は前の値を保持するだけ） *)
  cfgErr : BOOL;
  res : INT;
  rv : INT;
  v : ARRAY[1..3] OF REAL;
  okIn : ARRAY[1..3] OF BOOL;
  tk : ARRAY[1..3] OF BOOL;
  nUse : INT;
  nOk : INT;
  i : INT;
  a : INT;
  b : INT;
  pick : INT;
  med : REAL;
  o : REAL;
  sn : INT;
  noSel : BOOL;
  bkDown : BOOL;
  fixed : BOOL;
  q : INT;
  w : WORD;
END_VAR

(* ---- ① 要求の口（8 章、15-8）。Init のときは番号だけ合わせる ---- *)
IF Init THEN
  AckSeq := ReqSeq;
ELSIF ReqSeq <> AckSeq THEN
  IF ReqItem <> 1 THEN
    res := 1;
  ELSIF ReqWriter <> 2 THEN
    res := 2;
  ELSIF NOT PB_IsFinite(ReqValue) THEN
    res := 8;
  ELSIF (ReqValue < 0.0) OR (ReqValue > 3.0) THEN
    res := 3;                                   (* 範囲の外（整数かどうかによらず。INT にできない大きさを先に外す） *)
  ELSE
    rv := REAL_TO_INT(ReqValue);
    IF INT_TO_REAL(rv) <> ReqValue THEN
      res := 8;                                 (* 整数でない *)
    ELSIF (rv <> 0) AND ((Cfg.Use AND SHL(INT_TO_WORD(1), rv - 1)) = 0) THEN
      res := 3;                                 (* Use に無い入力 *)
    ELSE
      Cfg.Fix := rv;
      res := 0;
    END_IF;
  END_IF;
  Result := res;
  AckSeq := ReqSeq;
END_IF;

(* ---- 設定の検査（5 章） ---- *)
cfgErr := (Cfg.Sel < 0) OR (Cfg.Sel > 2) OR ((Cfg.Use AND 16#0007) = 0) OR ((Cfg.Use AND 16#FFF8) <> 0)
  OR (Cfg.Fix < 0) OR (Cfg.Fix > 3);
IF (NOT cfgErr) AND (Cfg.Fix <> 0) THEN
  IF (Cfg.Use AND SHL(INT_TO_WORD(1), Cfg.Fix - 1)) = 0 THEN
    cfgErr := TRUE;
  END_IF;
END_IF;

(* ---- 使える入力（2 章） ---- *)
v[1] := In1;
v[2] := In2;
v[3] := In3;
okIn[1] := ((Cfg.Use AND 16#0001) <> 0) AND (NOT Bad1) AND PB_IsFinite(In1);
okIn[2] := ((Cfg.Use AND 16#0002) <> 0) AND (NOT Bad2) AND PB_IsFinite(In2);
okIn[3] := ((Cfg.Use AND 16#0004) <> 0) AND (NOT Bad3) AND PB_IsFinite(In3);
nUse := 0;
nOk := 0;
FOR i := 1 TO 3 DO
  IF (Cfg.Use AND SHL(INT_TO_WORD(1), i - 1)) <> 0 THEN nUse := nUse + 1; END_IF;
  IF okIn[i] THEN nOk := nOk + 1; END_IF;
  tk[i] := TRUE;
END_FOR;

(* ---- ② 選ぶ（2 章・3 章、15-2） ---- *)
o := Out;
sn := 0;
noSel := FALSE;
IF cfgErr THEN
  noSel := TRUE;
ELSIF Cfg.Fix <> 0 THEN
  IF okIn[Cfg.Fix] THEN
    o := v[Cfg.Fix];
    sn := Cfg.Fix;
    tk[Cfg.Fix] := FALSE;
  ELSE
    noSel := TRUE;                              (* 固定した入力が使えない：自動に戻さない（論点 4） *)
  END_IF;
ELSIF nOk = 0 THEN
  noSel := TRUE;
ELSIF (Cfg.Sel = 2) AND (nOk = 2) THEN
  a := 0;
  b := 0;
  FOR i := 1 TO 3 DO
    IF okIn[i] THEN
      IF a = 0 THEN a := i; ELSE b := i; END_IF;
    END_IF;
  END_FOR;
  o := (v[a] + v[b]) / 2.0;                     (* 2 つの平均（論点 3） *)
  tk[a] := FALSE;
  tk[b] := FALSE;
ELSE
  pick := 0;
  IF (Cfg.Sel = 2) AND (nOk = 3) THEN
    med := MAX(MIN(v[1], v[2]), MIN(MAX(v[1], v[2]), v[3]));   (* 中央値 *)
    FOR i := 3 TO 1 BY -1 DO
      IF v[i] = med THEN pick := i; END_IF;     (* 同じ値なら一番小さい番号 *)
    END_FOR;
  ELSE
    FOR i := 1 TO 3 DO
      IF okIn[i] THEN
        IF pick = 0 THEN
          pick := i;
        ELSIF (Cfg.Sel = 0) AND (v[i] > v[pick]) THEN
          pick := i;
        ELSIF (Cfg.Sel <> 0) AND (v[i] < v[pick]) THEN
          pick := i;
        END_IF;
      END_IF;
    END_FOR;
  END_IF;
  o := v[pick];
  sn := pick;
  tk[pick] := FALSE;
END_IF;

(* ---- ③ 下流の戻り信号（15-5） ---- *)
bkDown := (NOT cfgErr) AND (NOT Init) AND (NOT BkOkIn);   (* 15-10：Init では見ない *)
IF bkDown THEN
  FOR i := 1 TO 3 DO
    tk[i] := TRUE;
  END_FOR;
  IF PB_IsFinite(BkValIn) THEN
    o := BkValIn;
  ELSE
    o := Out;                                   (* 数でなければ前の Out を保持 *)
  END_IF;
END_IF;

(* ---- ④ 出力・状態ワード（7 章、15-4・15-6・15-7） ---- *)
IF noSel THEN
  sn := 0;
  FOR i := 1 TO 3 DO
    tk[i] := TRUE;
  END_FOR;
END_IF;
Out := o;
Bad := noSel;
SelNo := sn;
Trk1 := tk[1];
Trk2 := tk[2];
Trk3 := tk[3];
TrkAll := bkDown OR noSel;
fixed := (NOT cfgErr) AND (Cfg.Fix <> 0);
IF fixed THEN MODE := 1; ELSE MODE := 0; END_IF;
IF noSel THEN ALM := 16#0001; ELSE ALM := 0; END_IF;
IF noSel THEN
  q := 2;
ELSIF nOk < nUse THEN
  q := 1;
ELSE
  q := 0;
END_IF;
w := 16#0001 OR SHL(INT_TO_WORD(q), 3);
IF q > 0 THEN w := w OR 16#0020; END_IF;
IF fixed THEN w := w OR 16#0040; END_IF;
IF cfgErr THEN w := w OR 16#0080; END_IF;
STS := w;
w := 0;
IF cfgErr THEN
  w := 16#0002;
ELSE
  FOR i := 1 TO 3 DO
    IF ((Cfg.Use AND SHL(INT_TO_WORD(1), i - 1)) <> 0) AND (NOT okIn[i]) THEN
      w := w OR SHL(INT_TO_WORD(4), i - 1);
    END_IF;
  END_FOR;
END_IF;
IF bkDown THEN w := w OR 16#0020; END_IF;
DIAG := w;

END_FUNCTION_BLOCK
