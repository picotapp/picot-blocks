(*
 * PB_Pid（調節計）基本版
 * 仕様：spec/blocks/PB_Pid_基本版.md v0.5（節の番号はこの仕様書）
 * テストベクタ：test-vectors/PB_Pid_基本版.json（JS 参照実装と同じものを流す）
 * 書き方の決まり：C-1〜C-8
 * 使うもの：PB_Common.st（PB_IsFinite）
 *
 * 速度形。SP・MV・モードは設定と同じ構造体に保持する（6 章）。
 *)

(* 設定と保持する値（6 章）。利用者のプログラムが保持領域に置き、FB に VAR_IN_OUT で渡す *)
TYPE PB_Pid_Cfg :
STRUCT
  Action : INT;      (* 0 逆動作・1 正動作 *)
  Alg : INT;         (* 0 基本形 PID・1 I-PD・2 PI-D *)
  EuLo : REAL;
  EuHi : REAL;
  PB : REAL;         (* 比例帯 % *)
  TI : REAL;         (* 積分時間 s（0 は積分なし） *)
  TD : REAL;         (* 微分時間 s *)
  MvLo : REAL;       (* % *)
  MvHi : REAL;       (* % *)
  TrkEndMan : BOOL;  (* トラッキングが終わったら MAN にする *)
  SP : REAL;         (* 保持する SP（工学値） *)
  MV : REAL;         (* 保持する MV（%） *)
  Mode : INT;        (* 保持するモード 0 MAN・1 AUT・2 CAS *)
END_STRUCT
END_TYPE

FUNCTION_BLOCK PB_Pid
VAR_INPUT
  PV : REAL;
  PvBad : BOOL;
  CasIn : REAL;      (* 上位の MV（%） *)
  CasGood : BOOL;
  TrkOn : BOOL;
  TrkVal : REAL;     (* % *)
  ErfOn : BOOL;      (* 外部リセット（オーバーライド用。15 章） *)
  ErfVal : REAL;     (* 外部リセットの値（セレクタの Out、%） *)
  dt : REAL;
  Init : BOOL;
  ReqSeq : INT;
  ReqItem : INT;
  ReqValue : REAL;
  ReqWriter : INT;
END_VAR
VAR_IN_OUT
  Cfg : PB_Pid_Cfg;
END_VAR
VAR_OUTPUT
  MV : REAL;
  SP : REAL;
  BkCas : BOOL;
  BkSp : REAL;
  STS : WORD;
  MODE : WORD;
  ALM : WORD;
  DIAG : WORD;
  AckSeq : INT;
  Result : INT;
END_VAR
VAR
  (* 状態（Init で整える。宣言の初期値に頼らない：C-4） *)
  px : REAL;         (* 前の x *)
  pe : REAL;         (* 前の e *)
  dTerm : REAL;      (* 微分の項 D *)
  prevTrk : BOOL;
  trkE : BOOL;       (* 効いているトラッキング（14-11） *)
  erfF : REAL;       (* 外部リセットの項 F（15 章） *)
  useErf : BOOL;
  erv : REAL;
  casShed : BOOL;    (* CAS から AUT に落ちた（次にモードを変えるまで） *)
  primed : BOOL;     (* FALSE なら次の正常なスキャンを Init と同じにする *)
  (* 1 スキャンの作業用 *)
  dtc : REAL;
  dtClamp : BOOL;
  pvFault : BOOL;
  cfgErr : BOOL;
  doInit : BOOL;
  ok : BOOL;
  res : INT;
  v : REAL;
  lo : REAL;
  hi : REAL;
  span : REAL;
  sgn : REAL;
  xv : REAL;
  ev : REAL;
  mvw : REAL;
  calc : BOOL;
  K : REAL;
  alg : INT;
  u : REAL;
  pu : REAL;
  dn : REAL;
  etd : REAL;
  prop : REAL;
  integ : REAL;
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
pvFault := PvBad OR NOT PB_IsFinite(PV);          (* 14-2 *)

(* ---- 設定の検査（6 章） ---- *)
cfgErr := NOT (PB_IsFinite(Cfg.EuLo) AND PB_IsFinite(Cfg.EuHi) AND PB_IsFinite(Cfg.PB) AND PB_IsFinite(Cfg.TI)
  AND PB_IsFinite(Cfg.TD) AND PB_IsFinite(Cfg.MvLo) AND PB_IsFinite(Cfg.MvHi) AND PB_IsFinite(Cfg.SP) AND PB_IsFinite(Cfg.MV));
IF NOT cfgErr THEN
  ok := (Cfg.EuLo < Cfg.EuHi) AND (Cfg.PB > 0.0) AND (Cfg.TI >= 0.0) AND (Cfg.TD >= 0.0) AND (Cfg.MvLo < Cfg.MvHi)
    AND ((Cfg.Action = 0) OR (Cfg.Action = 1)) AND (Cfg.Alg >= 0) AND (Cfg.Alg <= 2) AND (Cfg.Mode >= 0) AND (Cfg.Mode <= 2);
  cfgErr := NOT ok;
END_IF;

(* ---- ① 要求の口（9 章、14-4）。Init のときは番号だけ合わせる ---- *)
doInit := Init;
IF Init THEN
  AckSeq := ReqSeq;
ELSIF ReqSeq <> AckSeq THEN
  res := 0;
  ok := ((ReqItem >= 1) AND (ReqItem <= 3)) OR ((ReqItem >= 10) AND (ReqItem <= 14));
  IF NOT ok THEN
    res := 1;
  ELSIF ReqItem <= 3 THEN
    IF (ReqWriter <> 1) AND (ReqWriter <> 2) THEN
      res := 2;                                 (* モード・SP・MV は運転員・エンジニア *)
    END_IF;
  ELSIF ReqWriter <> 2 THEN
    res := 2;                                   (* パラメーターはエンジニアだけ *)
  END_IF;
  IF (res = 0) AND NOT PB_IsFinite(ReqValue) THEN
    res := 8;
  END_IF;
  v := ReqValue;
  IF res = 0 THEN
    CASE ReqItem OF
      1:                                        (* モード *)
        IF (v <> 0.0) AND (v <> 1.0) AND (v <> 2.0) THEN
          res := 8;
        ELSIF (v <> 0.0) AND pvFault THEN
          res := 7;                             (* PV 異常で AUT・CAS *)
        ELSIF (v = 2.0) AND NOT CasGood THEN
          res := 6;                             (* 上位が使えない *)
        ELSE
          Cfg.Mode := REAL_TO_INT(v);
          casShed := FALSE;                     (* 14-5 *)
        END_IF;
      2:                                        (* SP *)
        IF Cfg.Mode = 2 THEN
          res := 4;
        ELSIF (v < Cfg.EuLo) OR (v > Cfg.EuHi) THEN
          res := 3;
        ELSE
          Cfg.SP := v;
        END_IF;
      3:                                        (* MV *)
        IF (Cfg.Mode <> 0) OR TrkOn THEN
          res := 4;
        ELSIF (v < Cfg.MvLo) OR (v > Cfg.MvHi) THEN
          res := 5;
        ELSE
          Cfg.MV := v;
        END_IF;
      10:                                       (* PB：1〜1000 % *)
        IF (v < 1.0) OR (v > 1000.0) THEN res := 12; ELSE Cfg.PB := v; END_IF;
      11:                                       (* TI：0〜10000 s *)
        IF (v < 0.0) OR (v > 10000.0) THEN res := 12; ELSE Cfg.TI := v; END_IF;
      12:                                       (* TD：0〜1000 s *)
        IF (v < 0.0) OR (v > 1000.0) THEN res := 12; ELSE Cfg.TD := v; END_IF;
      13, 14:                                   (* MvLo・MvHi：0〜100 %、MvLo < MvHi *)
        IF (v < 0.0) OR (v > 100.0) THEN
          res := 12;
        ELSE
          lo := Cfg.MvLo;
          hi := Cfg.MvHi;
          IF ReqItem = 13 THEN lo := v; ELSE hi := v; END_IF;
          IF NOT (lo < hi) THEN
            res := 13;
          ELSIF ReqItem = 13 THEN
            Cfg.MvLo := v;
          ELSE
            Cfg.MvHi := v;
          END_IF;
        END_IF;
    END_CASE;
  END_IF;
  Result := res;
  AckSeq := ReqSeq;
END_IF;

IF cfgErr THEN
  (* 14-9：MV 保持、計算しない。SP・BkSp は前の値。戻ったら Init と同じ *)
  primed := FALSE;
  prevTrk := TrkOn;
  IF PB_IsFinite(Cfg.MV) THEN
    MV := Cfg.MV;
  END_IF;
  w := 16#0081;
  IF dtClamp THEN w := w OR 16#0100; END_IF;
  STS := w;
  IF (Cfg.Mode >= 0) AND (Cfg.Mode <= 2) THEN
    MODE := INT_TO_WORD(Cfg.Mode);
  ELSE
    MODE := 0;
  END_IF;
  BkCas := FALSE;
  w := 16#0002;
  IF dtClamp THEN w := w OR 16#0001; END_IF;
  DIAG := w;
  ALM := 0;
ELSE
  (* ---- ② Init（7 章） ---- *)
  IF NOT primed THEN
    doInit := TRUE;
    primed := TRUE;
  END_IF;
  span := Cfg.EuHi - Cfg.EuLo;
  IF Cfg.Action = 1 THEN sgn := 1.0; ELSE sgn := -1.0; END_IF;
  IF doInit THEN
    Cfg.Mode := 0;
    prevTrk := FALSE;
    casShed := FALSE;
  END_IF;
  (* 14-11：Init のスキャンではトラッキングを見ない（下流をまだ呼んでいないので戻り信号が正しくない） *)
  trkE := TrkOn AND NOT doInit;

  (* ---- ③ PV 異常で MAN、CAS で上位が使えなければ AUT ---- *)
  IF pvFault THEN
    Cfg.Mode := 0;
  END_IF;
  IF (Cfg.Mode = 2) AND NOT CasGood THEN
    Cfg.Mode := 1;
    casShed := TRUE;
  END_IF;

  (* ---- ④ CAS の SP（14-6）。CasIn は % ---- *)
  IF (Cfg.Mode = 2) AND PB_IsFinite(CasIn) THEN
    Cfg.SP := MIN(Cfg.EuHi, MAX(Cfg.EuLo, Cfg.EuLo + (CasIn * span) / 100.0));
  END_IF;

  IF pvFault THEN
    xv := px;
    ev := pe;
  ELSE
    (* C-8：span = EuHi − EuLo は設定異常でない（有限で EuLo < EuHi）ので正。PV も有限（PV 異常でない） *)
    xv := sgn * ((100.0 * (PV - Cfg.EuLo)) / span);
    ev := sgn * ((100.0 * (PV - Cfg.SP)) / span);  (* C-8：同上 *)
  END_IF;
  IF doInit THEN
    px := xv;
    pe := ev;
    dTerm := 0.0;
  END_IF;

  (* ---- ⑤ トラッキング（14-7） ---- *)
  mvw := Cfg.MV;
  IF trkE THEN
    IF PB_IsFinite(TrkVal) THEN
      mvw := TrkVal;
    END_IF;
  ELSIF prevTrk AND Cfg.TrkEndMan THEN
    Cfg.Mode := 0;
  END_IF;
  prevTrk := trkE;

  (* ---- ⑥ PID の計算（2 章） ---- *)
  calc := (NOT trkE) AND (NOT pvFault) AND ((Cfg.Mode = 1) OR (Cfg.Mode = 2));
  (* C-8：PB > 0（設定異常でない） *)
  K := 100.0 / Cfg.PB;
  useErf := calc AND ErfOn;
  IF useErf THEN
    (* ---- 外部リセット（15 章）：MV = F + K ×（e + D）、F は ErfVal の一次遅れ ---- *)
    alg := Cfg.Alg;
    IF (Cfg.Alg = 1) AND (Cfg.Mode = 2) THEN
      alg := 2;
    END_IF;
    IF alg = 0 THEN
      u := ev;
      pu := pe;
    ELSE
      u := xv;
      pu := px;
    END_IF;
    dn := dTerm;
    IF dtc > 0.0 THEN
      dn := 0.0;
      IF Cfg.TD > 0.0 THEN
        etd := 0.1 * Cfg.TD;
        (* C-8：ここは dtc > 0、etd ≧ 0 なので割る数は正 *)
        dn := ((etd * dTerm) + (Cfg.TD * (u - pu))) / (etd + dtc);
      END_IF;
      erv := ErfVal;
      IF PB_IsFinite(erv) THEN
        IF Cfg.TI > 0.0 THEN
          (* C-8：TI > 0、dtc > 0 なので割る数は正 *)
          erfF := erfF + ((erv - erfF) * dtc) / (Cfg.TI + dtc);
        ELSE
          erfF := erv;
        END_IF;
      END_IF;
    END_IF;
    mvw := erfF + K * (ev + dn);                (* 比例は Alg によらず偏差（15-7） *)
    IF dtc > 0.0 THEN
      dTerm := dn;
      px := xv;
      pe := ev;
    END_IF;
  ELSIF calc AND (dtc > 0.0) THEN
    alg := Cfg.Alg;
    IF (Cfg.Alg = 1) AND (Cfg.Mode = 2) THEN
      alg := 2;                                 (* I-PD は CAS 中だけ PI-D *)
    END_IF;
    IF alg = 0 THEN
      u := ev;
      pu := pe;
    ELSE
      u := xv;
      pu := px;
    END_IF;
    dn := 0.0;
    IF Cfg.TD > 0.0 THEN
      etd := 0.1 * Cfg.TD;                      (* η = 0.1 *)
      (* C-8：ここは dtc > 0（calc AND dtc > 0）、etd ≧ 0 なので割る数は正 *)
      dn := ((etd * dTerm) + (Cfg.TD * (u - pu))) / (etd + dtc);
    END_IF;
    IF alg = 1 THEN
      prop := xv - px;
    ELSE
      prop := ev - pe;
    END_IF;
    IF Cfg.TI > 0.0 THEN
      (* C-8：TI > 0 のときだけ *)
      integ := (dtc / Cfg.TI) * ev;
    ELSE
      integ := 0.0;
    END_IF;
    mvw := mvw + K * ((prop + integ) + (dn - dTerm));
    dTerm := dn;
    px := xv;
    pe := ev;
  ELSIF NOT calc THEN
    (* 計算しないスキャン：前の値を今に合わせる（バンプレス） *)
    px := xv;
    pe := ev;
    dTerm := 0.0;
  END_IF;
  (* dt ≦ 0 で計算するモードのときは前の値を更新しない（14-3） *)

  (* ---- ⑦ MV を上下限で切る（トラッキング中を除く） ---- *)
  IF NOT trkE THEN
    mvw := MIN(Cfg.MvHi, MAX(Cfg.MvLo, mvw));
  END_IF;
  Cfg.MV := mvw;
  (* 15-4：外部リセットで計算しないスキャンは、F を今の MV に合わせておく *)
  IF NOT useErf THEN
    erfF := mvw - K * (ev + dTerm);
  END_IF;

  (* ---- ⑧ 出力 ---- *)
  MV := mvw;
  SP := Cfg.SP;
  BkCas := (Cfg.Mode = 2) AND (NOT trkE) AND (NOT pvFault);
  (* C-8：span は正（設定異常でない） *)
  BkSp := (100.0 * (Cfg.SP - Cfg.EuLo)) / span;
  MODE := INT_TO_WORD(Cfg.Mode);
  ALM := 0;
  w := 16#0001;
  IF dtClamp THEN w := w OR 16#0100; END_IF;
  STS := w;
  w := 0;
  IF dtClamp THEN w := w OR 16#0001; END_IF;
  IF pvFault THEN w := w OR 16#0004; END_IF;
  IF trkE THEN w := w OR 16#0008; END_IF;
  IF casShed THEN w := w OR 16#0010; END_IF;
  IF (NOT trkE) AND (mvw >= Cfg.MvHi) THEN w := w OR 16#0020; END_IF;
  IF (NOT trkE) AND (mvw <= Cfg.MvLo) THEN w := w OR 16#0040; END_IF;
  IF useErf THEN w := w OR 16#0080; END_IF;
  DIAG := w;
END_IF;

END_FUNCTION_BLOCK
