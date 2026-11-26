(*
 * PB_ReqDispatch（要求の受付箱）基本版
 * 仕様：spec/blocks/PB_ReqDispatch_基本版.md v0.2（節の番号はこの仕様書）
 * テストベクタ：test-vectors/PB_ReqDispatch_基本版.json（JS 参照実装と同じものを流す）
 * 書き方の決まり：C-1〜C-8
 * 使うもの：PB_Common.st（PB_IsFinite）
 *
 * 受付箱の 1 件を、宛先の番号（BoxTag）の口（Ports）に渡し、返事を受付箱に写す。書けるかどうかの判断はしない。
 *)

(* 宛先のブロックとの口（2 章）。宛先の ReqSeq・ReqItem・ReqValue・ReqWriter につなぎ、返事 AckSeq・Result を書き戻す *)
TYPE PB_ReqPort :
STRUCT
  Seq : INT;         (* このブロックが書く *)
  Item : INT;
  Value : REAL;
  Writer : INT;
  AckSeq : INT;      (* 宛先の返事（呼び出しコードが写す） *)
  Result : INT;
END_STRUCT
END_TYPE

(* 設定（6 章） *)
TYPE PB_ReqDispatch_Cfg :
STRUCT
  NumPorts : INT;    (* 使う口の数 1〜64 *)
  TimeOut : REAL;    (* 返事を待つ時間（s） *)
END_STRUCT
END_TYPE

FUNCTION_BLOCK PB_ReqDispatch
VAR_INPUT
  BoxSeq : INT;      (* 受付箱（Node-RED が書く） *)
  BoxTag : INT;
  BoxItem : INT;
  BoxValue : REAL;
  BoxWriter : INT;
  dt : REAL;
  Init : BOOL;
END_VAR
VAR_IN_OUT
  Cfg : PB_ReqDispatch_Cfg;
  Ports : ARRAY[1..64] OF PB_ReqPort;
END_VAR
VAR_OUTPUT
  BoxAck : INT;
  BoxResult : INT;
  Busy : BOOL;
  Alive : INT;       (* 生存カウンター 0〜32767 *)
  STS : WORD;
  MODE : WORD;
  ALM : WORD;
  DIAG : WORD;
END_VAR
VAR
  (* 状態（Init で整える。宣言の初期値に頼らない：C-4） *)
  tag : INT;         (* 処理中の宛先 *)
  seq : INT;         (* 処理中の BoxSeq *)
  el : REAL;         (* 待ち時間 *)
  timedOut : BOOL;
  primed : BOOL;     (* FALSE なら次の正常なスキャンを Init と同じにする *)
  (* 1 スキャンの作業用 *)
  dtc : REAL;
  dtClamp : BOOL;
  cfgErr : BOOL;
  replied : BOOL;
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

(* 生存カウンター（13-9）。32767 の次は 0 *)
IF Alive >= 32767 THEN
  Alive := 0;
ELSE
  Alive := Alive + 1;
END_IF;

(* ---- ① 設定異常・Init（13-10、7 章） ---- *)
cfgErr := (Cfg.NumPorts < 1) OR (Cfg.NumPorts > 64) OR NOT PB_IsFinite(Cfg.TimeOut);
IF NOT cfgErr THEN
  cfgErr := NOT (Cfg.TimeOut > 0.0);
END_IF;

IF cfgErr THEN
  (* 受付箱を処理しない。処理中の 1 件は捨てる。戻ったら Init と同じ *)
  primed := FALSE;
  Busy := FALSE;
ELSE
  IF (NOT primed) OR Init THEN
    primed := TRUE;
    Busy := FALSE;
    timedOut := FALSE;
    BoxAck := BoxSeq;                           (* 入っていた要求は処理しない *)
  END_IF;

  (* ---- ② 返事を確かめる（13-2、13-3）。返事を時間切れより先に見る ---- *)
  replied := FALSE;
  IF Busy THEN
    IF Ports[tag].AckSeq = Ports[tag].Seq THEN
      BoxResult := Ports[tag].Result;
      BoxAck := seq;
      Busy := FALSE;
    ELSE
      el := el + dtc;
      IF el >= Cfg.TimeOut THEN
        BoxResult := 16;                        (* ブロックが応答しない *)
        BoxAck := seq;
        Busy := FALSE;
        timedOut := TRUE;
      END_IF;
    END_IF;
    replied := NOT Busy;
  END_IF;

  (* ---- ③ 新しい 1 件（3 章、13-5〜13-8）。返事をしたスキャンでは始めない ---- *)
  IF (NOT Busy) AND (NOT replied) AND (BoxSeq <> BoxAck) THEN
    timedOut := FALSE;
    seq := BoxSeq;
    IF (BoxTag < 1) OR (BoxTag > Cfg.NumPorts) THEN
      BoxResult := 15;                          (* 宛先のブロックが無い *)
      BoxAck := seq;
    ELSE
      tag := BoxTag;
      Ports[tag].Item := BoxItem;
      Ports[tag].Value := BoxValue;
      Ports[tag].Writer := BoxWriter;
      IF Ports[tag].Seq >= 32767 THEN           (* 32767 の次は 1（13-6） *)
        Ports[tag].Seq := 1;
      ELSE
        Ports[tag].Seq := Ports[tag].Seq + 1;
      END_IF;
      el := 0.0;
      Busy := TRUE;
    END_IF;
  END_IF;
END_IF;

(* ---- ④ 出力 ---- *)
MODE := 0;
ALM := 0;
w := 16#0001;
IF cfgErr THEN w := w OR 16#0080; END_IF;
IF dtClamp THEN w := w OR 16#0100; END_IF;
STS := w;
w := 0;
IF dtClamp THEN w := w OR 16#0001; END_IF;
IF cfgErr THEN w := w OR 16#0002; END_IF;
IF Busy THEN w := w OR 16#0004; END_IF;
IF timedOut AND NOT cfgErr THEN w := w OR 16#0008; END_IF;
DIAG := w;

END_FUNCTION_BLOCK
