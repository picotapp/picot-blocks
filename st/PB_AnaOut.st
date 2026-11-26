(*
 * PB_AnaOut（調節弁の出力）基本版
 * 仕様：spec/blocks/PB_AnaOut_基本版.md v0.2（節の番号はこの仕様書）
 * テストベクタ：test-vectors/PB_AnaOut_基本版.json（JS 参照実装と同じものを流す）
 * 書き方の決まり：C-1〜C-8
 * 使うもの：PB_Common.st（PB_IsFinite）
 *
 * 調節計の MV（弁の開度 %）を AO のカウントにする。弁の向きはこのブロックで反転する。
 * 調節計の値を使っていないとき（安全側・MAN・AO の異常・設定異常）は BkOk = FALSE。
 * つなぎ方：調節計の TrkOn ← NOT BkOk、TrkVal ← BkVal（5 章）。
 *)

(* 設定と保持する値（7 章）。利用者のプログラムが保持領域に置き、FB に VAR_IN_OUT で渡す *)
TYPE PB_AnaOut_Cfg :
STRUCT
  Act : INT;         (* 0 信号が増えると開く・1 閉じる *)
  RawLo : REAL;      (* 4 mA のカウント *)
  RawHi : REAL;      (* 20 mA のカウント *)
  SafePct : REAL;    (* 安全側の開度（%） *)
  PosUse : BOOL;     (* 開度信号を使う *)
  PosRawLo : REAL;   (* 開度 0 % のカウント *)
  PosRawHi : REAL;   (* 開度 100 % のカウント *)
  DevLim : REAL;     (* 偏差の警報（%） *)
  DevHys : REAL;     (* 偏差のヒステリシス（%） *)
  DevT : REAL;       (* 偏差が続く時間（s） *)
  ManPct : REAL;     (* MAN の開度（%）。保持する値 *)
  Mode : INT;        (* 0 MAN・1 AUT。保持する値 *)
END_STRUCT
END_TYPE

FUNCTION_BLOCK PB_AnaOut
VAR_INPUT
  In : REAL;         (* 調節計の MV（%） *)
  Safe : BOOL;       (* 安全側にする（インターロック） *)
  ChFault : BOOL;    (* AO ユニットの異常 *)
  PosIn : REAL;      (* 開度信号のカウント *)
  PosFault : BOOL;   (* 開度信号の異常 *)
  dt : REAL;
  Init : BOOL;
  ReqSeq : INT;
  ReqItem : INT;
  ReqValue : REAL;
  ReqWriter : INT;
END_VAR
VAR_IN_OUT
  Cfg : PB_AnaOut_Cfg;
END_VAR
VAR_OUTPUT
  Out : REAL;        (* AO のカウント *)
  OutPct : REAL;     (* 弁の開度（%） *)
  mA : REAL;
  Pos : REAL;        (* 開度信号（%） *)
  Dev : REAL;        (* 偏差（%） *)
  BkOk : BOOL;
  BkVal : REAL;
  STS : WORD;
  MODE : WORD;
  ALM : WORD;
  DIAG : WORD;
  AckSeq : INT;
  Result : INT;
END_VAR
VAR
  (* 状態（Init で整える。宣言の初期値に頼らない：C-4） *)
  devEl : REAL;      (* 偏差の経過時間 *)
  devOn : BOOL;      (* 偏差の警報 *)
  primed : BOOL;     (* FALSE なら次の正常なスキャンを Init と同じにする *)
  (* 1 スキャンの作業用 *)
  dtc : REAL;
  dtClamp : BOOL;
  cfgErr : BOOL;
  doInit : BOOL;
  okW : BOOL;
  res : INT;
  inBad : BOOL;      (* AUT で In が数でない *)
  pct : REAL;
  sig : REAL;
  p : REAL;
  ad : REAL;
  pFail : BOOL;
  devPend : BOOL;
  w : WORD;
END_VAR

(* ---- 時間（C-3、8 章）。NaN も 0 扱い ---- *)
dtc := dt;
dtClamp := FALSE;
IF NOT (dtc > 0.0) THEN
  dtc := 0.0;
ELSIF dtc > 1.0 THEN
  dtc := 1.0;
  dtClamp := TRUE;
END_IF;

(* ---- ① 要求の口（10 章、14-9）。Init のときは番号だけ合わせる ---- *)
doInit := Init;
IF Init THEN
  AckSeq := ReqSeq;
ELSIF ReqSeq <> AckSeq THEN
  IF (ReqItem = 1) OR (ReqItem = 2) THEN
    okW := (ReqWriter = 1) OR (ReqWriter = 2);
  ELSE
    okW := ReqWriter = 2;
  END_IF;
  IF (ReqItem <> 1) AND (ReqItem <> 2) AND (ReqItem <> 10) AND (ReqItem <> 11) AND (ReqItem <> 12) THEN
    res := 1;
  ELSIF NOT okW THEN
    res := 2;
  ELSIF NOT PB_IsFinite(ReqValue) THEN
    res := 8;
  ELSIF ReqItem = 1 THEN
    IF ReqValue = 0.0 THEN
      Cfg.Mode := 0; res := 0;
    ELSIF ReqValue = 1.0 THEN
      Cfg.Mode := 1; res := 0;
    ELSE
      res := 8;
    END_IF;
  ELSIF ReqItem = 2 THEN
    IF (Cfg.Mode <> 0) OR Safe THEN
      res := 4;
    ELSIF (ReqValue < 0.0) OR (ReqValue > 100.0) THEN
      res := 3;
    ELSE
      Cfg.ManPct := ReqValue; res := 0;
    END_IF;
  ELSIF ReqItem = 10 THEN
    IF (ReqValue < 1.0) OR (ReqValue > 50.0) THEN
      res := 12;
    ELSIF ReqValue < Cfg.DevHys THEN
      res := 13;
    ELSE
      Cfg.DevLim := ReqValue; res := 0;
    END_IF;
  ELSIF ReqItem = 11 THEN
    IF (ReqValue < 0.0) OR (ReqValue > 50.0) THEN
      res := 12;
    ELSIF ReqValue > Cfg.DevLim THEN
      res := 13;
    ELSE
      Cfg.DevHys := ReqValue; res := 0;
    END_IF;
  ELSE
    IF (ReqValue < 0.0) OR (ReqValue > 600.0) THEN
      res := 12;
    ELSE
      Cfg.DevT := ReqValue; res := 0;
    END_IF;
  END_IF;
  Result := res;
  AckSeq := ReqSeq;
END_IF;

(* ---- ② 設定の検査（7 章、14-3） ---- *)
cfgErr := NOT (PB_IsFinite(Cfg.RawLo) AND PB_IsFinite(Cfg.RawHi) AND PB_IsFinite(Cfg.SafePct)
  AND PB_IsFinite(Cfg.PosRawLo) AND PB_IsFinite(Cfg.PosRawHi) AND PB_IsFinite(Cfg.DevLim)
  AND PB_IsFinite(Cfg.DevHys) AND PB_IsFinite(Cfg.DevT) AND PB_IsFinite(Cfg.ManPct));
IF NOT cfgErr THEN
  IF Cfg.RawLo = Cfg.RawHi THEN cfgErr := TRUE; END_IF;
  IF (Cfg.Act <> 0) AND (Cfg.Act <> 1) THEN cfgErr := TRUE; END_IF;
  IF (Cfg.Mode <> 0) AND (Cfg.Mode <> 1) THEN cfgErr := TRUE; END_IF;
  IF (Cfg.SafePct < 0.0) OR (Cfg.SafePct > 100.0) OR (Cfg.ManPct < 0.0) OR (Cfg.ManPct > 100.0) THEN cfgErr := TRUE; END_IF;
  IF Cfg.PosUse AND (Cfg.PosRawLo = Cfg.PosRawHi) THEN cfgErr := TRUE; END_IF;
  IF (Cfg.DevLim < 1.0) OR (Cfg.DevLim > 50.0) OR (Cfg.DevHys < 0.0) OR (Cfg.DevHys > Cfg.DevLim) THEN cfgErr := TRUE; END_IF;
  IF (Cfg.DevT < 0.0) OR (Cfg.DevT > 600.0) THEN cfgErr := TRUE; END_IF;
END_IF;

IF cfgErr THEN
  (* ---- 設定異常（14-8）：出力を保持、BkOk FALSE。戻ったら Init と同じ ---- *)
  primed := FALSE;
  devEl := 0.0;
  devOn := FALSE;
  BkOk := FALSE;
  BkVal := OutPct;
  IF (Cfg.Mode = 0) OR (Cfg.Mode = 1) THEN
    MODE := INT_TO_WORD(Cfg.Mode);
  ELSE
    MODE := 0;
  END_IF;
  ALM := 0;
  w := 16#0001 OR 16#0010 OR 16#0020 OR 16#0080;   (* 運転中・品質 Bad・原因 計器・設定異常 *)
  IF dtClamp THEN w := w OR 16#0100; END_IF;
  STS := w;
  w := 16#0002;
  IF dtClamp THEN w := w OR 16#0001; END_IF;
  DIAG := w;
ELSE
  IF NOT primed THEN
    doInit := TRUE;
    primed := TRUE;
  END_IF;
  IF doInit THEN
    devEl := 0.0;
    devOn := FALSE;
  END_IF;

  (* ---- ③ 出力の元（3 章）：安全側 ＞ MAN ＞ AUT ---- *)
  inBad := (Cfg.Mode = 1) AND (NOT Safe) AND (NOT PB_IsFinite(In));
  pct := OutPct;
  IF Safe THEN
    pct := Cfg.SafePct;
  ELSIF Cfg.Mode = 0 THEN
    pct := Cfg.ManPct;
  ELSIF NOT inBad THEN
    pct := In;
  END_IF;
  pct := LIMIT(0.0, pct, 100.0);
  IF Safe OR (Cfg.Mode <> 0) THEN
    Cfg.ManPct := pct;                          (* 14-2 *)
  END_IF;
  OutPct := pct;

  (* ---- ④ 弁の向き・カウント（4 章、14-5） ---- *)
  IF Cfg.Act = 1 THEN
    sig := 100.0 - pct;
  ELSE
    sig := pct;
  END_IF;
  Out := Cfg.RawLo + (sig / 100.0) * (Cfg.RawHi - Cfg.RawLo);
  mA := 4.0 + sig * 0.16;

  (* ---- ⑤ 開度の監視（6 章、14-6・14-7） ---- *)
  pFail := FALSE;
  devPend := FALSE;
  IF Cfg.PosUse THEN
    pFail := PosFault OR NOT PB_IsFinite(PosIn);
    IF NOT pFail THEN
      (* C-8：設定の検査で PosUse のとき PosRawLo ≠ PosRawHi を確かめている *)
      p := 100.0 * (PosIn - Cfg.PosRawLo) / (Cfg.PosRawHi - Cfg.PosRawLo);
      IF NOT PB_IsFinite(p) THEN
        pFail := TRUE;
      ELSIF p < -2.5 THEN
        pFail := TRUE;                          (* 3.6 mA 相当より下 *)
      END_IF;
    END_IF;
    IF pFail THEN
      Dev := 0.0;
      devEl := 0.0;
      devOn := FALSE;
    ELSE
      Pos := p;
      Dev := p - pct;
      ad := ABS(Dev);
      IF ad > Cfg.DevLim THEN
        IF NOT devOn THEN
          devEl := devEl + dtc;
          IF devEl >= Cfg.DevT THEN
            devOn := TRUE;
            devEl := 0.0;
          ELSE
            devPend := TRUE;
          END_IF;
        END_IF;
      ELSE
        devEl := 0.0;
        IF ad <= Cfg.DevLim - Cfg.DevHys THEN
          devOn := FALSE;
        END_IF;
      END_IF;
    END_IF;
  ELSE
    Pos := 0.0;
    Dev := 0.0;
    devEl := 0.0;
    devOn := FALSE;
  END_IF;

  (* ---- ⑥ 戻り信号（5 章） ---- *)
  BkOk := (NOT Safe) AND (Cfg.Mode = 1) AND (NOT ChFault);
  BkVal := pct;

  (* ---- ⑦ 状態ワード（9 章、14-10） ---- *)
  MODE := INT_TO_WORD(Cfg.Mode);
  w := 0;
  IF devOn THEN w := w OR 16#0001; END_IF;
  IF ChFault THEN w := w OR 16#0002; END_IF;
  IF pFail THEN w := w OR 16#0004; END_IF;
  ALM := w;
  w := 16#0001;
  IF ChFault THEN w := w OR 16#0010 OR 16#0020; END_IF;   (* 品質 Bad・原因 計器 *)
  IF Safe OR (Cfg.Mode = 0) THEN w := w OR 16#0040; END_IF;
  IF dtClamp THEN w := w OR 16#0100; END_IF;
  STS := w;
  w := 0;
  IF dtClamp THEN w := w OR 16#0001; END_IF;
  IF Safe THEN w := w OR 16#0004; END_IF;
  IF inBad THEN w := w OR 16#0008; END_IF;
  IF devPend THEN w := w OR 16#0010; END_IF;
  DIAG := w;
END_IF;

END_FUNCTION_BLOCK
