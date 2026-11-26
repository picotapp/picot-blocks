(*
 * PB_BinMon（ディジタル入力監視）基本版
 * 仕様：spec/blocks/PB_BinMon_基本版.md v0.4（節の番号はこの仕様書）、抑制と代替値は 拡張_警報の抑制と代替値.md v0.2（「拡張 8-x」）
 * テストベクタ：test-vectors/PB_BinMon_基本版.json（JS 参照実装と同じものを流す）
 * 書き方の決まり：C-1〜C-8
 * 使うもの：PB_Common.st（PB_IsFinite）
 *)

(* 設定（6 章）。利用者のプログラムが保持領域に置き、FB に VAR_IN_OUT で渡す *)
TYPE PB_BinMon_Cfg :
STRUCT
  Invert : BOOL;     (* FALSE = NO（常時開）・TRUE = NC（常時閉） *)
  OnDelay : REAL;    (* s *)
  OffDelay : REAL;   (* s *)
  Inh : WORD;        (* bit0 動作の警報。1 = 無効 *)
  FailMode : INT;    (* 入力異常のときの Active：0 保持・1 動作・2 非動作 *)
  SimValue : BOOL;   (* 反転後の意味の値（TRUE = 動作） *)
  SuppMask : WORD;   (* 抑制する警報（bit0 動作・1 入力異常）。0 なら抑制しない（拡張 8-1） *)
  SuppOffT : REAL;   (* Supp が FALSE になってから抑制を続ける時間（s） *)
  SubOn : BOOL;      (* 代替値で運転する（保持する値） *)
  SubValue : BOOL;   (* 代替値（反転後の意味の値） *)
END_STRUCT
END_TYPE

FUNCTION_BLOCK PB_BinMon
VAR_INPUT
  In : BOOL;         (* DI の接点（配線のままの値） *)
  ChFault : BOOL;    (* DI ユニットの断線・短絡の検出ビット *)
  Supp : BOOL;       (* 警報を抑制する（設計で決めた条件。拡張 1 章） *)
  dt : REAL;         (* 前回からの時間（s） *)
  Init : BOOL;
  ReqSeq : INT;
  ReqItem : INT;
  ReqValue : REAL;
  ReqWriter : INT;
END_VAR
VAR_IN_OUT
  Cfg : PB_BinMon_Cfg;
END_VAR
VAR_OUTPUT
  Active : BOOL;
  InAct : BOOL;
  ActAlm : BOOL;     (* 動作の警報。ALM とぶつからない名前（ST は大文字・小文字を区別しない） *)
  Fail : BOOL;
  Bad : BOOL;
  SUPALM : WORD;     (* 抑制中で条件が成立している警報（拡張 8-3） *)
  STS : WORD;
  MODE : WORD;
  ALM : WORD;
  DIAG : WORD;
  AckSeq : INT;
  Result : INT;
END_VAR
VAR
  (* 状態（Init で整える。宣言の初期値に頼らない：C-4） *)
  oos : BOOL;
  sim : BOOL;
  elapsed : REAL;    (* 遅延の経過時間 *)
  fault : BOOL;      (* 前のスキャンで入力異常だったか（13-2） *)
  primed : BOOL;     (* FALSE なら次の正常なスキャンを Init と同じにする *)
  supping : BOOL;    (* 抑制中（拡張 8-2） *)
  suppT : REAL;
  wasSub : BOOL;
  onSub : BOOL;
  rv : INT;
  mk : WORD;
  (* 1 スキャンの作業用 *)
  dtc : REAL;
  dtClamp : BOOL;
  initLike : BOOL;
  wasOos : BOOL;
  wasSim : BOOL;
  res : INT;
  v : REAL;
  ok : BOOL;
  act : BOOL;        (* 反転の後の値 *)
  cfgErr : BOOL;
  q : INT;           (* 品質 0 Good・1 Uncertain（代替値）・2 Bad・3 停止中 *)
  isFail : BOOL;
  pending : BOOL;
  ch : BOOL;
  delay : REAL;
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

(* ---- ① 要求の口（9 章）。Init のときは番号だけ合わせる ---- *)
initLike := Init;
IF Init THEN
  AckSeq := ReqSeq;
ELSIF ReqSeq <> AckSeq THEN
  wasOos := oos;
  wasSim := sim;
  wasSub := Cfg.SubOn;
  res := 0;
  ok := ((ReqItem >= 1) AND (ReqItem <= 5)) OR (ReqItem = 10) OR (ReqItem = 11) OR (ReqItem = 16) OR (ReqItem = 22) OR (ReqItem = 23);
  IF NOT ok THEN
    res := 1;
  ELSIF ReqWriter <> 2 THEN
    res := 2;                                   (* すべてエンジニアだけ *)
  ELSIF NOT PB_IsFinite(ReqValue) THEN
    res := 8;
  ELSE
    v := ReqValue;
    IF ReqItem = 22 THEN                        (* 抑制する警報（拡張 8-8） *)
      IF (v < 0.0) OR (v > 3.0) THEN
        res := 12;
      ELSE
        rv := REAL_TO_INT(v);
        IF INT_TO_REAL(rv) <> v THEN
          res := 8;
        ELSE
          Cfg.SuppMask := INT_TO_WORD(rv);
        END_IF;
      END_IF;
    ELSIF ReqItem = 23 THEN                     (* 抑制を続ける時間 *)
      IF (v < 0.0) OR (v > 3600.0) THEN
        res := 12;
      ELSE
        Cfg.SuppOffT := v;
      END_IF;
    ELSIF (ReqItem = 10) OR (ReqItem = 11) THEN    (* ON・OFF 遅延：0〜60 s *)
      IF (v < 0.0) OR (v > 60.0) THEN
        res := 12;
      ELSIF ReqItem = 10 THEN
        Cfg.OnDelay := v;
      ELSE
        Cfg.OffDelay := v;
      END_IF;
    ELSIF (v <> 0.0) AND (v <> 1.0) THEN
      res := 8;
    ELSIF ReqItem = 1 THEN
      oos := v = 1.0;
    ELSIF ReqItem = 2 THEN
      sim := v = 1.0;
    ELSIF ReqItem = 3 THEN
      Cfg.SimValue := v = 1.0;
    ELSIF ReqItem = 4 THEN
      Cfg.SubOn := v = 1.0;                     (* 代替値の入・切（拡張 8-8） *)
    ELSIF ReqItem = 5 THEN
      Cfg.SubValue := v = 1.0;
    ELSIF v = 0.0 THEN                          (* 16：動作の警報の有効・無効 *)
      Cfg.Inh := Cfg.Inh OR 16#0001;
    ELSE
      Cfg.Inh := Cfg.Inh AND NOT 16#0001;
    END_IF;
  END_IF;
  Result := res;
  AckSeq := ReqSeq;
  (* 停止→運転、模擬 入→切、代替値 入→切 は Init と同じ（7 章、拡張 8-6） *)
  IF (wasOos AND NOT oos) OR (wasSim AND NOT sim) OR (wasSub AND NOT Cfg.SubOn) THEN
    initLike := TRUE;
  END_IF;
END_IF;

(* ---- ③ 入力の選択・反転（停止中・設定異常でも InAct は計算する：13-5） ---- *)
IF sim THEN
  act := Cfg.SimValue;
ELSE
  act := In XOR Cfg.Invert;
END_IF;
InAct := act;

(* ---- 設定の検査（6 章）。計算できない設定だけを異常にする ---- *)
cfgErr := NOT (PB_IsFinite(Cfg.OnDelay) AND PB_IsFinite(Cfg.OffDelay) AND PB_IsFinite(Cfg.SuppOffT));
IF NOT cfgErr THEN
  ok := (Cfg.FailMode >= 0) AND (Cfg.FailMode <= 2);
  cfgErr := (Cfg.OnDelay < 0.0) OR (Cfg.OffDelay < 0.0) OR NOT ok
    OR (Cfg.SuppOffT < 0.0) OR ((Cfg.SuppMask AND 16#FFFC) <> 0);   (* 拡張 8-7 *)
END_IF;

q := 0;
onSub := FALSE;
isFail := FALSE;
pending := FALSE;
ch := FALSE;

IF cfgErr THEN
  (* 設定異常：Active 保持、警報なし、Bad（計器）。戻ったら Init と同じ *)
  primed := FALSE;
  elapsed := 0.0;
  fault := FALSE;
  q := 2;
ELSE
  IF NOT primed THEN
    initLike := TRUE;
    primed := TRUE;
  END_IF;
  IF oos THEN
    (* 停止中：Active 保持、警報も入力異常も見ない（5 章） *)
    elapsed := 0.0;
    fault := FALSE;
    IF initLike THEN
      Active := act;
    END_IF;
    q := 3;
  ELSE
    (* ④ 入力異常（模擬中は見ない：13-4） *)
    ch := (NOT sim) AND ChFault;
    IF fault AND NOT ch THEN
      initLike := TRUE;                         (* 戻ったスキャン（13-2） *)
    END_IF;
    fault := ch;
    IF initLike THEN
      Active := act;
      elapsed := 0.0;
    END_IF;
    IF ch THEN
      (* ⑥ 異常時の値（処理 5）。遅延は数えない（3 章） *)
      elapsed := 0.0;
      IF Cfg.FailMode = 1 THEN
        Active := TRUE;
      ELSIF Cfg.FailMode = 2 THEN
        Active := FALSE;
      END_IF;
      isFail := TRUE;
      q := 2;
    ELSIF act <> Active THEN
      (* ⑤ ON/OFF 遅延（3 章、13-6） *)
      elapsed := elapsed + dtc;
      IF act THEN
        delay := Cfg.OnDelay;
      ELSE
        delay := Cfg.OffDelay;
      END_IF;
      IF elapsed >= delay THEN
        Active := act;
        elapsed := 0.0;
      ELSE
        pending := TRUE;
      END_IF;
    ELSE
      elapsed := 0.0;
    END_IF;
    (* 代替値（拡張 8-4・8-5）：入力異常は上で判定したまま、Active を置き換える。模擬が優先 *)
    IF (NOT sim) AND Cfg.SubOn THEN
      onSub := TRUE;
      Active := Cfg.SubValue;
      elapsed := 0.0;
      pending := FALSE;
      q := 1;
    END_IF;
  END_IF;
END_IF;

(* ---- 抑制（拡張 8-2） ---- *)
IF initLike OR cfgErr THEN
  supping := Supp;
  suppT := 0.0;
ELSIF Supp THEN
  supping := TRUE;
  suppT := 0.0;
ELSIF supping THEN
  suppT := suppT + dtc;
  IF suppT >= Cfg.SuppOffT THEN
    supping := FALSE;
  END_IF;
END_IF;

(* ---- ⑦ 警報・⑧ 状態ワード ---- *)
Fail := isFail;
ActAlm := (q = 0) AND Active AND ((Cfg.Inh AND 16#0001) = 0);
w := 0;
IF ActAlm THEN w := w OR 16#0001; END_IF;
IF Fail THEN w := w OR 16#0002; END_IF;
IF supping THEN
  mk := Cfg.SuppMask AND 16#0003;               (* 拡張 8-3 *)
ELSE
  mk := 0;
END_IF;
ALM := w AND NOT mk;
SUPALM := w AND mk;
Bad := q >= 2;

IF oos THEN
  w := 16#0002;
ELSE
  w := 16#0001;
END_IF;
IF sim THEN w := w OR 16#0004; END_IF;
w := w OR SHL(INT_TO_WORD(q), 3);
IF (q = 2) OR onSub THEN w := w OR 16#0020; END_IF;
IF (sim OR onSub) AND NOT oos THEN w := w OR 16#0040; END_IF;
IF cfgErr THEN w := w OR 16#0080; END_IF;
IF dtClamp THEN w := w OR 16#0100; END_IF;
STS := w;

w := 0;
IF dtClamp THEN w := w OR 16#0001; END_IF;
IF cfgErr THEN w := w OR 16#0002; END_IF;
IF ch THEN w := w OR 16#0004; END_IF;
IF pending THEN w := w OR 16#0008; END_IF;
IF supping THEN w := w OR 16#0010; END_IF;
DIAG := w;
MODE := 0;

END_FUNCTION_BLOCK
