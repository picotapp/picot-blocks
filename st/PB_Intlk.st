(*
 * PB_Intlk（インターロック）基本版
 * 仕様：spec/blocks/PB_Intlk_基本版.md v0.3（節の番号はこの仕様書）、バイパスは 拡張_PB_Intlk_バイパス.md v0.2（「拡張 8-x」）
 * テストベクタ：test-vectors/PB_Intlk_基本版.json（JS 参照実装と同じものを流す）
 * 書き方の決まり：C-1〜C-8
 * 使うもの：PB_Common.st（PB_IsFinite）
 *
 * 原因 8 個を OR でまとめてラッチする。どの機器を止めるかは持たない（呼び出しコードでつなぐ）。
 *)

(* 設定（6 章）。利用者のプログラムが保持領域に置き、FB に VAR_IN_OUT で渡す *)
TYPE PB_Intlk_Cfg :
STRUCT
  ResetMode : INT;   (* 0 手動・1 自動 *)
  ResetBy : INT;     (* 1 運転員・エンジニア・2 エンジニアだけ *)
  FoEn : BOOL;       (* ファーストアウトを記録する *)
  Delay : ARRAY[1..8] OF REAL;  (* 原因ごとの ON 遅延（s） *)
  BypAllow : WORD;   (* バイパスできる原因（bit0〜7）。0 ならバイパスなし（拡張 8-5） *)
  BypMaxT : REAL;    (* バイパスの最長時間（s、60〜86400） *)
END_STRUCT
END_TYPE

FUNCTION_BLOCK PB_Intlk
VAR_INPUT
  In1 : BOOL;
  In2 : BOOL;
  In3 : BOOL;
  In4 : BOOL;
  In5 : BOOL;
  In6 : BOOL;
  In7 : BOOL;
  In8 : BOOL;
  Now : UDINT;       (* 今の時刻（秒）。つながなければ 0 *)
  dt : REAL;
  Init : BOOL;
  ReqSeq : INT;
  ReqItem : INT;
  ReqValue : REAL;
  ReqWriter : INT;
END_VAR
VAR_IN_OUT
  Cfg : PB_Intlk_Cfg;
END_VAR
VAR_OUTPUT
  Trip : BOOL;
  ResetReady : BOOL;
  Cause : WORD;
  Raw : WORD;
  Mem : WORD;
  First : WORD;
  FirstNo : INT;
  FirstTime : UDINT;
  Byp : WORD;        (* バイパス中の原因 *)
  BypOn : BOOL;
  BypLeft : REAL;    (* 一番短い残り時間（s） *)
  STS : WORD;
  MODE : WORD;
  ALM : WORD;
  DIAG : WORD;
  AckSeq : INT;
  Result : INT;
END_VAR
VAR
  (* 状態（Init で整える。宣言の初期値に頼らない：C-4） *)
  el : ARRAY[1..8] OF REAL;   (* 原因ごとの経過時間 *)
  bel : ARRAY[1..8] OF REAL;  (* バイパスの経過時間（拡張 8-1） *)
  primed : BOOL;     (* FALSE なら次の正常なスキャンを Init と同じにする *)
  (* 1 スキャンの作業用 *)
  dtc : REAL;
  dtClamp : BOOL;
  cfgErr : BOOL;
  doInit : BOOL;
  ok : BOOL;
  res : INT;
  rw : WORD;         (* 今の入力 *)
  ew : WORD;         (* 今の入力からバイパス中の原因を除いたもの *)
  rv : INT;
  vw : WORD;
  lt : REAL;
  cw : WORD;         (* 遅延の後の原因 *)
  bit : WORD;
  i : INT;
  pending : BOOL;
  w : WORD;
END_VAR

(* ---- 時間（C-3、7 章）。NaN も 0 扱い ---- *)
dtc := dt;
dtClamp := FALSE;
IF NOT (dtc > 0.0) THEN
  dtc := 0.0;
ELSIF dtc > 1.0 THEN
  dtc := 1.0;
  dtClamp := TRUE;
END_IF;

(* ---- ① Raw ---- *)
rw := 0;
IF In1 THEN rw := rw OR 16#0001; END_IF;
IF In2 THEN rw := rw OR 16#0002; END_IF;
IF In3 THEN rw := rw OR 16#0004; END_IF;
IF In4 THEN rw := rw OR 16#0008; END_IF;
IF In5 THEN rw := rw OR 16#0010; END_IF;
IF In6 THEN rw := rw OR 16#0020; END_IF;
IF In7 THEN rw := rw OR 16#0040; END_IF;
IF In8 THEN rw := rw OR 16#0080; END_IF;
Raw := rw;

(* ---- 設定の検査（6 章） ---- *)
cfgErr := ((Cfg.ResetMode <> 0) AND (Cfg.ResetMode <> 1)) OR ((Cfg.ResetBy <> 1) AND (Cfg.ResetBy <> 2));
FOR i := 1 TO 8 DO
  IF NOT PB_IsFinite(Cfg.Delay[i]) THEN
    cfgErr := TRUE;
  ELSIF Cfg.Delay[i] < 0.0 THEN
    cfgErr := TRUE;
  END_IF;
END_FOR;
(* 拡張 8-5：BypAllow = 0 なら BypMaxT を見ない *)
IF (Cfg.BypAllow AND 16#FF00) <> 0 THEN
  cfgErr := TRUE;
ELSIF Cfg.BypAllow <> 0 THEN
  IF NOT PB_IsFinite(Cfg.BypMaxT) THEN
    cfgErr := TRUE;
  ELSIF (Cfg.BypMaxT < 60.0) OR (Cfg.BypMaxT > 86400.0) THEN
    cfgErr := TRUE;
  END_IF;
END_IF;

(* ---- ② 要求の口（9 章、14-7）。Init のときは番号だけ合わせる ---- *)
doInit := Init;
IF Init THEN
  AckSeq := ReqSeq;
ELSIF ReqSeq <> AckSeq THEN
  IF Cfg.ResetBy = 1 THEN
    ok := (ReqWriter = 1) OR (ReqWriter = 2);
  ELSE
    ok := ReqWriter = 2;
  END_IF;
  IF (ReqItem = 2) OR (ReqItem = 3) THEN
    (* ---- バイパスする（2）・外す（3）。拡張 2 章・8-7 ---- *)
    IF ReqItem = 2 THEN
      ok := ReqWriter = 2;
    ELSE
      ok := (ReqWriter = 1) OR (ReqWriter = 2);
    END_IF;
    rv := 0;
    IF NOT ok THEN
      res := 2;
    ELSIF NOT PB_IsFinite(ReqValue) THEN
      res := 8;
    ELSIF (ReqValue < 1.0) OR (ReqValue > 255.0) THEN
      res := 8;
    ELSE
      rv := REAL_TO_INT(ReqValue);
      IF INT_TO_REAL(rv) <> ReqValue THEN
        res := 8;                               (* 整数でない *)
      ELSE
        res := 0;
      END_IF;
    END_IF;
    IF res = 0 THEN
      vw := INT_TO_WORD(rv);
      IF ReqItem = 3 THEN
        Byp := Byp AND NOT vw;
      ELSIF cfgErr THEN
        res := 11;
      ELSIF (vw AND NOT Cfg.BypAllow) <> 0 THEN
        res := 12;
      ELSIF Trip THEN
        res := 9;                               (* トリップ中はバイパスしない *)
      ELSE
        Byp := Byp OR vw;
        FOR i := 1 TO 8 DO
          IF (vw AND SHL(INT_TO_WORD(1), i - 1)) <> 0 THEN
            bel[i] := 0.0;                      (* 拡張 8-2 *)
          END_IF;
        END_FOR;
      END_IF;
    END_IF;
  ELSIF ReqItem <> 1 THEN
    res := 1;
  ELSIF NOT ok THEN
    res := 2;
  ELSIF ReqValue <> 1.0 THEN
    res := 8;                                   (* NaN も 1.0 と等しくないのでここ *)
  ELSIF cfgErr THEN
    res := 11;
  ELSIF NOT Trip THEN
    res := 10;                                  (* 動作していない *)
  ELSIF (rw AND NOT Byp) <> 0 THEN
    res := 11;                                  (* 原因が残っている（バイパス中の原因を除く。拡張 8-8） *)
  ELSE
    res := 0;
    Trip := FALSE; Mem := 0; First := 0; FirstNo := 0; FirstTime := 0;
  END_IF;
  Result := res;
  AckSeq := ReqSeq;
END_IF;

IF cfgErr THEN
  (* ---- ③ 設定異常（14-7）：トリップ側。戻ったら Init と同じ ---- *)
  primed := FALSE;
  Trip := FALSE; Mem := 0; First := 0; FirstNo := 0; FirstTime := 0;
  FOR i := 1 TO 8 DO
    el[i] := 0.0;
  END_FOR;
  Byp := 0;                                     (* 拡張 8-6 *)
  BypLeft := 0.0;
  Trip := TRUE;
  Cause := rw;
  ResetReady := FALSE;
  pending := FALSE;
ELSE
  IF NOT primed THEN
    doInit := TRUE;
    primed := TRUE;
  END_IF;
  IF doInit THEN
    Trip := FALSE; Mem := 0; First := 0; FirstNo := 0; FirstTime := 0;
    FOR i := 1 TO 8 DO
      el[i] := 0.0;
    END_FOR;
    Byp := 0;                                   (* 拡張 8-6 *)
  END_IF;

  (* ---- ③b バイパスの時間（拡張 8-1・8-4） ---- *)
  Byp := Byp AND Cfg.BypAllow;
  BypLeft := 0.0;
  FOR i := 1 TO 8 DO
    bit := SHL(INT_TO_WORD(1), i - 1);
    IF (Byp AND bit) <> 0 THEN
      bel[i] := bel[i] + dtc;
      IF bel[i] >= Cfg.BypMaxT THEN
        Byp := Byp AND NOT bit;
      ELSE
        lt := Cfg.BypMaxT - bel[i];
        IF (BypLeft = 0.0) OR (lt < BypLeft) THEN
          BypLeft := lt;
        END_IF;
      END_IF;
    END_IF;
  END_FOR;
  ew := rw AND NOT Byp;

  (* ---- ④ 原因ごとの遅延（3 章、14-3） ---- *)
  cw := 0;
  pending := FALSE;
  FOR i := 1 TO 8 DO
    bit := SHL(INT_TO_WORD(1), i - 1);
    IF (ew AND bit) = 0 THEN
      el[i] := 0.0;
    ELSIF doInit OR ((Cause AND bit) <> 0) THEN
      cw := cw OR bit;                          (* Init では遅延なし。すでに原因なら続ける *)
    ELSE
      el[i] := el[i] + dtc;
      IF el[i] >= Cfg.Delay[i] THEN
        cw := cw OR bit;
        el[i] := 0.0;
      ELSE
        pending := TRUE;
      END_IF;
    END_IF;
  END_FOR;
  Cause := cw;

  (* ---- ⑤ トリップの判定（4 章） ---- *)
  IF (NOT Trip) AND (cw <> 0) THEN
    Trip := TRUE;
    Mem := cw;
    IF Cfg.FoEn THEN
      First := cw;
      FirstNo := 0;
      FOR i := 8 TO 1 BY -1 DO                  (* 一番小さい番号 *)
        IF (cw AND SHL(INT_TO_WORD(1), i - 1)) <> 0 THEN
          FirstNo := i;
        END_IF;
      END_FOR;
      FirstTime := Now;
    END_IF;
  ELSIF Trip THEN
    Mem := Mem OR cw;
  END_IF;

  (* ---- ⑥ 自動リセット（14-5） ---- *)
  IF Trip AND (Cfg.ResetMode = 1) AND (ew = 0) THEN
    Trip := FALSE; Mem := 0; First := 0; FirstNo := 0; FirstTime := 0;
  END_IF;

  ResetReady := Trip AND (ew = 0);
END_IF;

(* ---- ⑦ 状態ワード ---- *)
BypOn := Byp <> 0;
MODE := 0;
IF BypOn THEN ALM := 16#0001; ELSE ALM := 0; END_IF;   (* 拡張 8-9 *)
w := 16#0001;
IF cfgErr THEN w := w OR 16#0080; END_IF;
IF dtClamp THEN w := w OR 16#0100; END_IF;
STS := w;
w := 0;
IF dtClamp THEN w := w OR 16#0001; END_IF;
IF cfgErr THEN w := w OR 16#0002; END_IF;
IF pending THEN w := w OR 16#0004; END_IF;
DIAG := w;

END_FUNCTION_BLOCK
