(*
 * PB_DevCore（機器の核：ポンプ・ON/OFF 弁）基本版
 * 仕様：spec/blocks/PB_DevCore_基本版.md v0.3（節の番号はこの仕様書）
 * テストベクタ：test-vectors/PB_DevCore_基本版.json（JS 参照実装と同じものを流す）
 * 書き方の決まり：C-1〜C-8
 * 使うもの：PB_Common.st（PB_IsFinite）
 *
 * 位置の番号（作業用）：0 off 側・1 on 側・2 途中・3 位置が分からない（両方 ON）
 * 安全側を S（SafeState。0 = off）と書く
 *)

(* 設定と運転時間・起動回数（9 章）。利用者のプログラムが保持領域に置き、FB に VAR_IN_OUT で渡す。
 * 既定値：ポンプ FbCfg 1・FbTrack TRUE、弁 FbCfg 3・FbTrack FALSE（13 章 論点 7） *)
TYPE PB_DevCore_Cfg :
STRUCT
  FbCfg : INT;       (* 3 両方・1 on だけ・2 off だけ・0 なし *)
  SafeState : INT;   (* 0 off・1 on *)
  FaultAct : INT;    (* 0 警報だけ・1 安全側へ *)
  FbTrack : BOOL;    (* 指令外に安全側でない側へ動いたとき目標を合わせるか *)
  StatT : REAL;      (* s。指令外の動きと判断するまで *)
  MonTOn : REAL;     (* s *)
  MonTOff : REAL;    (* s *)
  StrokeT : REAL;    (* s *)
  RunHours : DINT;   (* 運転時間（時間） *)
  RunSecFrac : REAL; (* 1 時間未満の秒 *)
  Starts : DINT;     (* 起動回数 *)
END_STRUCT
END_TYPE

FUNCTION_BLOCK PB_DevCore
VAR_INPUT
  FbOn : BOOL;       (* アンサーバック 開・運転中 *)
  FbOff : BOOL;      (* アンサーバック 閉 *)
  Intlk : BOOL;      (* インターロック動作中 *)
  Perm : BOOL := TRUE;  (* C-4 例外：起動の許可。つながなければ許可（仕様書 2.1）。初期値の無い PLC では TRUE をつなぐ *)
  Local : BOOL;      (* 現場 *)
  PCmdOn : BOOL;     (* プログラムの指令（立ち上がり） *)
  PCmdOff : BOOL;
  dt : REAL;
  Init : BOOL;
  ReqSeq : INT;
  ReqItem : INT;
  ReqValue : REAL;
  ReqWriter : INT;
END_VAR
VAR_IN_OUT
  Cfg : PB_DevCore_Cfg;
END_VAR
VAR_OUTPUT
  Out : BOOL;        (* DO：TRUE で on 側へ *)
  Target : BOOL;     (* 目標が on *)
  State : INT;       (* 0 off・1 on・2 途中・3 位置不明 *)
  Travel : REAL;     (* % *)
  Remain : REAL;     (* s *)
  Fault : BOOL;
  STS : WORD;
  MODE : WORD;
  ALM : WORD;
  DIAG : WORD;
  AckSeq : INT;
  Result : INT;
END_VAR
VAR
  (* 状態（Init で整える。宣言の初期値に頼らない：C-4） *)
  aut : BOOL;
  p : REAL;          (* 進み具合の推定（%） *)
  moving : BOOL;     (* 指令した動きの途中 *)
  tm : REAL;         (* 監視の経過時間 *)
  ts : REAL;         (* 指令外の動きの判断の経過時間 *)
  judged : BOOL;     (* 今の反対の端について判断済み *)
  failOn : BOOL;
  failOff : BOOL;
  infoOn : BOOL;
  infoOff : BOOL;
  prevOn : BOOL;     (* 前のスキャンで位置が on *)
  prevCmdOn : BOOL;
  prevCmdOff : BOOL;
  primed : BOOL;     (* FALSE なら次の正常なスキャンを Init と同じにする *)
  (* 1 スキャンの作業用 *)
  dtc : REAL;
  dtClamp : BOOL;
  cfgErr : BOOL;
  safeOn : BOOL;     (* S が on *)
  pcmdRej : BOOL;
  doInit : BOOL;
  res : INT;
  v : REAL;
  vb : BOOL;
  ok : BOOL;
  isInt : BOOL;
  pos0 : INT;
  pos : INT;
  tgt : INT;
  upOn : BOOL;
  upOff : BOOL;
  pEnd : REAL;
  T : REAL;
  pStep : REAL;
  failed : BOOL;
  nowFailed : BOOL;
  statJudge : BOOL;
  monT : REAL;
  toOn : BOOL;
  movingOk : BOOL;
  lim : BOOL;
  w : WORD;
END_VAR

(* ---- 時間（C-3、10 章）。NaN も 0 扱い ---- *)
dtc := dt;
dtClamp := FALSE;
IF NOT (dtc > 0.0) THEN
  dtc := 0.0;
ELSIF dtc > 1.0 THEN
  dtc := 1.0;
  dtClamp := TRUE;
END_IF;

(* ---- 設定の検査（9 章）。計算できない設定だけを異常にする ---- *)
cfgErr := NOT (PB_IsFinite(Cfg.MonTOn) AND PB_IsFinite(Cfg.MonTOff) AND PB_IsFinite(Cfg.StrokeT) AND PB_IsFinite(Cfg.StatT));
IF NOT cfgErr THEN
  ok := (Cfg.FbCfg >= 0) AND (Cfg.FbCfg <= 3) AND ((Cfg.SafeState = 0) OR (Cfg.SafeState = 1))
    AND ((Cfg.FaultAct = 0) OR (Cfg.FaultAct = 1));
  cfgErr := (Cfg.MonTOn < 0.0) OR (Cfg.MonTOff < 0.0) OR (Cfg.StrokeT < 0.0) OR (Cfg.StatT < 0.0) OR NOT ok;
END_IF;
safeOn := Cfg.SafeState = 1;
pcmdRej := FALSE;

(* ---- ① 要求の口（9 章、14-3・14-4）。Init のときは番号だけ合わせる ---- *)
doInit := Init;
IF Init THEN
  AckSeq := ReqSeq;
ELSIF ReqSeq <> AckSeq THEN
  res := 0;
  ok := (ReqItem = 1) OR (ReqItem = 2) OR ((ReqItem >= 10) AND (ReqItem <= 13)) OR (ReqItem = 20) OR (ReqItem = 21);
  IF NOT ok THEN
    res := 1;
  ELSIF (ReqItem = 1) OR (ReqItem = 2) THEN
    IF (ReqWriter <> 1) AND (ReqWriter <> 2) THEN
      res := 2;                                 (* 指令・モードは運転員・エンジニア *)
    END_IF;
  ELSIF ReqWriter <> 2 THEN
    res := 2;                                   (* 設定はエンジニアだけ *)
  END_IF;
  IF (res = 0) AND NOT PB_IsFinite(ReqValue) THEN
    res := 8;
  END_IF;
  v := ReqValue;
  IF (res = 0) AND ((ReqItem = 1) OR (ReqItem = 2)) AND (v <> 0.0) AND (v <> 1.0) THEN
    res := 8;
  END_IF;
  IF (res = 0) AND ((ReqItem = 20) OR (ReqItem = 21)) THEN
    (* 整数か。2^24 以上の REAL は整数しか表せないので、DINT に変えずに済ませる（あふれを起こさない：C-8） *)
    IF ABS(v) >= 16777216.0 THEN
      isInt := TRUE;
    ELSE
      isInt := DINT_TO_REAL(REAL_TO_DINT(v)) = v;
    END_IF;
    IF NOT isInt THEN
      res := 8;
    END_IF;
  END_IF;
  IF res = 0 THEN
    CASE ReqItem OF
      1:                                        (* 指令 *)
        vb := v = 1.0;
        IF aut OR Local THEN
          res := 4;
        ELSIF (vb <> safeOn) AND Intlk THEN
          res := 9;                             (* インターロック中に安全側でない向きへ *)
        ELSIF (vb <> safeOn) AND (Target = safeOn) AND NOT Perm THEN
          res := 14;                            (* 起動条件が揃っていない *)
        ELSIF NOT cfgErr THEN
          (* 受け付けた指令（14-2） *)
          Target := vb;
          failOn := FALSE; failOff := FALSE; infoOn := FALSE; infoOff := FALSE;
          moving := TRUE;
          tm := 0.0; ts := 0.0; judged := FALSE;
        END_IF;
      2:                                        (* モード *)
        aut := v = 1.0;
      10, 11:                                   (* 監視時間：1〜600 s *)
        IF (v < 1.0) OR (v > 600.0) THEN
          res := 12;
        ELSIF ReqItem = 10 THEN
          Cfg.MonTOn := v;
        ELSE
          Cfg.MonTOff := v;
        END_IF;
      12:                                       (* ストローク時間：0〜600 s *)
        IF (v < 0.0) OR (v > 600.0) THEN
          res := 12;
        ELSE
          Cfg.StrokeT := v;
        END_IF;
      13:                                       (* 指令外の動きの判断時間：0〜10 s *)
        IF (v < 0.0) OR (v > 10.0) THEN
          res := 12;
        ELSE
          Cfg.StatT := v;
        END_IF;
      20, 21:                                   (* 運転時間・起動回数：0〜9999999 *)
        IF (v < 0.0) OR (v > 9999999.0) THEN
          res := 12;
        ELSIF ReqItem = 20 THEN
          Cfg.RunHours := REAL_TO_DINT(v);
          Cfg.RunSecFrac := 0.0;
        ELSE
          Cfg.Starts := REAL_TO_DINT(v);
        END_IF;
    END_CASE;
  END_IF;
  Result := res;
  AckSeq := ReqSeq;
END_IF;

(* ---- ② 設定異常・Init（14-15、14-16） ---- *)
IF cfgErr THEN
  primed := FALSE;
  Target := safeOn;
  moving := FALSE;
  failOn := FALSE; failOff := FALSE; infoOn := FALSE; infoOff := FALSE;
ELSE
  IF NOT primed THEN
    doInit := TRUE;
    primed := TRUE;
  END_IF;
  IF doInit THEN
    Target := safeOn;
    failOn := FALSE; failOff := FALSE; infoOn := FALSE; infoOff := FALSE;
    moving := FALSE;
    tm := 0.0; ts := 0.0; judged := FALSE;
    (* Init のときの位置。アンサーバックなし（FbCfg 0）は安全側の端 *)
    CASE Cfg.FbCfg OF
      3:
        IF FbOn AND FbOff THEN pos0 := 3; ELSIF FbOn THEN pos0 := 1; ELSIF FbOff THEN pos0 := 0; ELSE pos0 := 2; END_IF;
      1:
        IF FbOn THEN pos0 := 1; ELSE pos0 := 0; END_IF;
      2:
        IF FbOff THEN pos0 := 0; ELSE pos0 := 1; END_IF;
    ELSE
      IF safeOn THEN pos0 := 1; ELSE pos0 := 0; END_IF;
    END_CASE;
    IF pos0 = 1 THEN
      p := 100.0;
    ELSIF pos0 = 0 THEN
      p := 0.0;
    ELSIF safeOn THEN
      p := 100.0;
    ELSE
      p := 0.0;
    END_IF;
    IF safeOn THEN tgt := 1; ELSE tgt := 0; END_IF;
    IF (Cfg.FbCfg <> 0) AND (pos0 <> tgt) THEN
      moving := TRUE;                           (* 位置が S でなければ止める動きとして監視 *)
      tm := 0.0; ts := 0.0; judged := FALSE;
    END_IF;
    prevCmdOn := PCmdOn;
    prevCmdOff := PCmdOff;
  END_IF;

  (* ③ プログラムの指令（立ち上がり。14-5） *)
  upOn := PCmdOn AND NOT prevCmdOn;
  upOff := PCmdOff AND NOT prevCmdOff;
  IF aut AND (NOT Local) AND (upOn OR upOff) THEN
    IF upOn AND upOff THEN
      vb := safeOn;                             (* 同時なら安全側 *)
    ELSE
      vb := upOn;
    END_IF;
    IF (vb <> safeOn) AND Intlk THEN
      pcmdRej := TRUE;
    ELSIF (vb <> safeOn) AND (Target = safeOn) AND NOT Perm THEN
      pcmdRej := TRUE;
    ELSE
      Target := vb;
      failOn := FALSE; failOff := FALSE; infoOn := FALSE; infoOff := FALSE;
      moving := TRUE;
      tm := 0.0; ts := 0.0; judged := FALSE;
    END_IF;
  END_IF;

  (* ④ インターロック（14-6）。情報のビットは消さない *)
  IF Intlk AND (Target <> safeOn) THEN
    Target := safeOn;
    failOn := FALSE; failOff := FALSE;
    moving := TRUE;
    tm := 0.0; ts := 0.0; judged := FALSE;
  END_IF;
END_IF;
prevCmdOn := PCmdOn;
prevCmdOff := PCmdOff;

(* ---- ⑤ 進み具合の推定（14-11） ---- *)
IF Target THEN pEnd := 100.0; ELSE pEnd := 0.0; END_IF;
T := Cfg.StrokeT;
IF NOT (T > 0.0) THEN
  p := pEnd;
ELSIF (dtc > 0.0) AND PB_IsFinite(T) THEN      (* T が無限大（設定異常）なら進まない *)
  (* C-8：T > 0 かつ有限のときだけ通る *)
  pStep := (100.0 * dtc) / T;
  IF p < pEnd THEN
    p := MIN(pEnd, p + pStep);
  ELSE
    p := MAX(pEnd, p - pStep);
  END_IF;
END_IF;

(* ---- ⑥ 今の位置（5 章） ---- *)
CASE Cfg.FbCfg OF
  3:
    IF FbOn AND FbOff THEN pos := 3; ELSIF FbOn THEN pos := 1; ELSIF FbOff THEN pos := 0; ELSE pos := 2; END_IF;
  1:
    IF FbOn THEN pos := 1; ELSE pos := 0; END_IF;
  2:
    IF FbOff THEN pos := 0; ELSE pos := 1; END_IF;
ELSE
  IF p >= 100.0 THEN pos := 1; ELSIF p <= 0.0 THEN pos := 0; ELSE pos := 2; END_IF;
END_CASE;
IF Target THEN tgt := 1; ELSE tgt := 0; END_IF;
failed := failOn OR failOff;

(* ---- ⑦ 監視（6 章、14-7〜14-10） ---- *)
statJudge := FALSE;
IF NOT cfgErr THEN
  IF moving THEN
    IF pos = tgt THEN
      moving := FALSE;
    ELSIF (NOT Local) AND (pos <> 3) THEN
      tm := tm + dtc;
      IF Target THEN monT := Cfg.MonTOn; ELSE monT := Cfg.MonTOff; END_IF;
      IF tm >= monT THEN
        (* 失敗（6 章）。FaultAct 1 なら安全側へ（失敗のビットは消さない：14-7） *)
        IF Target THEN failOn := TRUE; ELSE failOff := TRUE; END_IF;
        moving := FALSE;
        tm := 0.0;
        IF (Cfg.FaultAct = 1) AND (Target <> safeOn) THEN
          Target := safeOn;
        END_IF;
      END_IF;
    END_IF;
  ELSIF failed THEN
    ;                                           (* 14-8a：失敗した後は静止中の監視をしない *)
  ELSIF (pos = tgt) OR (pos = 3) THEN
    tm := 0.0; ts := 0.0; judged := FALSE;
  ELSE
    (* 静止中に位置が目標と違う（14-8） *)
    IF NOT Local THEN
      tm := tm + dtc;
      IF Target THEN monT := Cfg.MonTOn; ELSE monT := Cfg.MonTOff; END_IF;
      IF tm >= monT THEN
        IF Target THEN failOn := TRUE; ELSE failOff := TRUE; END_IF;
        moving := FALSE;
        tm := 0.0;
        IF (Cfg.FaultAct = 1) AND (Target <> safeOn) THEN
          Target := safeOn;
        END_IF;
      END_IF;
    END_IF;
    IF pos = 2 THEN
      ts := 0.0;
      judged := FALSE;
    ELSIF NOT judged THEN
      ts := ts + dtc;
      IF ts >= Cfg.StatT THEN
        toOn := pos = 1;
        IF toOn THEN infoOn := TRUE; ELSE infoOff := TRUE; END_IF;   (* 14-9 *)
        judged := TRUE;
        ts := 0.0;
        IF (toOn = safeOn) OR (Cfg.FbTrack AND NOT Intlk) THEN
          Target := toOn;                       (* 目標を合わせる（6 章 パターン 1・3） *)
          tm := 0.0;
          judged := FALSE;
        END_IF;
      ELSE
        statJudge := TRUE;
      END_IF;
    END_IF;
  END_IF;
  (* 失敗が消えるとき (a)：失敗した向きの端に着いた（14-7） *)
  IF failOn AND (pos = 1) THEN failOn := FALSE; END_IF;
  IF failOff AND (pos = 0) THEN failOff := FALSE; END_IF;
END_IF;
nowFailed := failOn OR failOff;

(* ---- ⑧ p の端合わせ（FbCfg ≠ 0） ---- *)
IF Target THEN tgt := 1; ELSE tgt := 0; END_IF;
IF (Cfg.FbCfg <> 0) AND ((pos = 1) OR (pos = 0)) THEN
  IF (pos = tgt) OR (NOT moving) OR nowFailed THEN
    IF pos = 1 THEN p := 100.0; ELSE p := 0.0; END_IF;
  END_IF;
END_IF;

(* ---- ⑨ 運転時間・起動回数（8 章、14-14） ---- *)
IF NOT cfgErr THEN
  IF pos = 1 THEN
    Cfg.RunSecFrac := Cfg.RunSecFrac + dtc;
    IF Cfg.RunSecFrac >= 3600.0 THEN
      Cfg.RunSecFrac := Cfg.RunSecFrac - 3600.0;
      IF Cfg.RunHours >= 9999999 THEN         (* 上限で止める（あふれを起こさない） *)
        Cfg.RunHours := 9999999;
      ELSE
        Cfg.RunHours := Cfg.RunHours + 1;
      END_IF;
    END_IF;
    IF (NOT prevOn) AND (NOT doInit) THEN
      IF Cfg.Starts >= 9999999 THEN
        Cfg.Starts := 9999999;
      ELSE
        Cfg.Starts := Cfg.Starts + 1;
      END_IF;
    END_IF;
  END_IF;
  prevOn := pos = 1;
END_IF;

(* ---- ⑩ 出力・状態ワード（12 章） ---- *)
movingOk := moving AND NOT nowFailed;
Out := Target;
Travel := p;
IF Target THEN pEnd := 100.0; ELSE pEnd := 0.0; END_IF;
IF movingOk AND (T > 0.0) THEN
  Remain := (ABS(pEnd - p) * T) / 100.0;
ELSE
  Remain := 0.0;
END_IF;
IF pos = 3 THEN
  State := 3;
ELSIF movingOk THEN
  State := 2;
ELSIF pos = 1 THEN
  State := 1;
ELSIF pos = 0 THEN
  State := 0;
ELSE
  State := 2;
END_IF;
lim := pos = 3;
w := 0;
IF failOn THEN w := w OR 16#0001; END_IF;
IF failOff THEN w := w OR 16#0002; END_IF;
IF lim THEN w := w OR 16#0004; END_IF;
IF infoOn THEN w := w OR 16#0008; END_IF;
IF infoOff THEN w := w OR 16#0010; END_IF;
ALM := w;
Fault := nowFailed OR lim;
w := 16#0001;
IF cfgErr THEN w := w OR 16#0080; END_IF;
IF dtClamp THEN w := w OR 16#0100; END_IF;
STS := w;
w := 0;
IF aut THEN w := w OR 16#0001; END_IF;
IF Local THEN w := w OR 16#0100; END_IF;
MODE := w;
w := 0;
IF dtClamp THEN w := w OR 16#0001; END_IF;
IF cfgErr THEN w := w OR 16#0002; END_IF;
IF movingOk THEN w := w OR 16#0004; END_IF;
IF pcmdRej THEN w := w OR 16#0008; END_IF;
IF statJudge THEN w := w OR 16#0010; END_IF;
DIAG := w;

END_FUNCTION_BLOCK
