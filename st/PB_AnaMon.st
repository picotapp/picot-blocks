(*
 * PB_AnaMon（伝送器・アナログ指示と警報）基本版
 * 仕様：spec/blocks/PB_AnaMon_基本版.md v0.6（節の番号はこの仕様書）、抑制と代替値は 拡張_警報の抑制と代替値.md v0.2（「拡張 8-x」）
 * テストベクタ：test-vectors/PB_AnaMon_基本版.json（JS 参照実装と同じものを流す）
 * 書き方の決まり：C-1〜C-8（標準の書き方だけ、時間は dt、ビットはシフトとマスク、REAL だけ、NaN・0 割りを起こさない）
 * 使うもの：PB_Common.st（PB_IsFinite）
 *)

(* 設定（6 章）。利用者のプログラムが保持領域に置き、FB に VAR_IN_OUT で渡す（6.1）。
 * 宣言の初期値は利用者のプログラム側で与える（既定値は仕様書 6 章の表） *)
TYPE PB_AnaMon_Cfg :
STRUCT
  InType : INT;      (* 0 4〜20 mA・1 それ以外 *)
  RawLo : REAL;      (* InType 0：4 mA のときのカウント *)
  RawHi : REAL;      (* InType 0：20 mA のときのカウント *)
  EuLo : REAL;
  EuHi : REAL;
  FilterT : REAL;    (* s *)
  LimHH : REAL;
  LimH : REAL;
  LimL : REAL;
  LimLL : REAL;
  Hys : REAL;        (* 工学値 *)
  Inh : WORD;        (* bit0 HH・1 H・2 L・3 LL。1 = 無効 *)
  FailMode : INT;    (* 0 保持・1 通す *)
  FailLo : REAL;     (* mA *)
  OorLo : REAL;
  OorHi : REAL;
  FailHi : REAL;
  SimValue : REAL;   (* 工学値 *)
  FailDelay : REAL;  (* s *)
  SuppMask : WORD;   (* 抑制する警報（ALM と同じビット）。0 なら抑制しない（拡張 8-1） *)
  SuppOffT : REAL;   (* Supp が FALSE になってから抑制を続ける時間（s） *)
  SubOn : BOOL;      (* 代替値で運転する（保持する値） *)
  SubValue : REAL;   (* 代替値（工学値） *)
END_STRUCT
END_TYPE

FUNCTION_BLOCK PB_AnaMon
VAR_INPUT
  In : REAL;         (* AI ユニットのディジタル値（カウント）。mA ではない *)
  ChFault : BOOL;    (* AI ユニットの断線・異常ビット *)
  Supp : BOOL;       (* 警報を抑制する（設計で決めた条件。拡張 1 章） *)
  dt : REAL;         (* 前回からの時間（s） *)
  Init : BOOL;
  ReqSeq : INT;
  ReqItem : INT;
  ReqValue : REAL;
  ReqWriter : INT;
END_VAR
VAR_IN_OUT
  Cfg : PB_AnaMon_Cfg;
END_VAR
VAR_OUTPUT
  PV : REAL;
  mA : REAL;
  STS : WORD;
  MODE : WORD;
  ALM : WORD;
  DIAG : WORD;
  HH : BOOL;
  H : BOOL;
  L : BOOL;
  LL : BOOL;
  Fail : BOOL;
  Bad : BOOL;
  SUPALM : WORD;     (* 抑制中で条件が成立している警報（拡張 8-3） *)
  AckSeq : INT;
  Result : INT;
END_VAR
VAR
  (* 状態（Init で整える。宣言の初期値に頼らない：C-4） *)
  oos : BOOL;
  sim : BOOL;
  y : REAL;          (* フィルタの値 *)
  fault : BOOL;      (* 計器故障（ラッチ） *)
  pending : BOOL;    (* 故障の疑い（ON 遅延中） *)
  pendT : REAL;      (* ON 遅延の経過時間 *)
  cCh : BOOL;        (* 故障のきっかけ（13-18） *)
  cLo : BOOL;
  cHi : BOOL;
  aHH : BOOL;
  aH : BOOL;
  aL : BOOL;
  aLL : BOOL;
  primed : BOOL;     (* FALSE なら次の正常なスキャンを Init と同じにする（初回・設定異常から戻ったとき） *)
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
  span : REAL;
  spanOk : BOOL;
  lo : REAL;
  hi : REAL;
  lims : ARRAY[0..3] OF REAL;  (* LL・L・H・HH の並び *)
  prev : REAL;
  n : INT;
  i : INT;
  k : INT;
  ok : BOOL;
  bit : WORD;
  cfgErr : BOOL;
  inOk : BOOL;       (* 入力 In が数（13-21） *)
  chf : BOOL;        (* ChFault または In が数でない *)
  x : REAL;
  mAv : REAL;
  pvRaw : REAL;
  src : REAL;
  u : REAL;
  doEval : BOOL;
  q : INT;           (* 品質 0 Good・1 Uncertain・2 Bad・3 停止中 *)
  qCause : INT;      (* 0 プロセス・1 計器 *)
  fLo : BOOL;
  fHi : BOOL;
  back : BOOL;
  inRange : BOOL;
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

(* ---- ① 要求の口（9 章、13-10・13-12〜13-14）。Init のときは番号だけ合わせる ---- *)
initLike := Init;
IF Init THEN
  AckSeq := ReqSeq;
ELSIF ReqSeq <> AckSeq THEN
  wasOos := oos;
  wasSim := sim;
  wasSub := Cfg.SubOn;
  res := 0;
  ok := ((ReqItem >= 1) AND (ReqItem <= 5)) OR ((ReqItem >= 10) AND (ReqItem <= 23));
  IF NOT ok THEN
    res := 1;                                   (* 項目が無い *)
  ELSIF ReqWriter <> 2 THEN
    res := 2;                                   (* 基本版の項目はすべてエンジニアだけ *)
  ELSIF NOT PB_IsFinite(ReqValue) THEN
    res := 8;
  ELSE
    v := ReqValue;
    (* スパン。設定が有限でないときは上限の検査をしない（JS と同じ結果。NaN の演算を避ける：C-8） *)
    spanOk := PB_IsFinite(Cfg.EuLo) AND PB_IsFinite(Cfg.EuHi);
    span := 0.0;
    IF spanOk THEN
      span := Cfg.EuHi - Cfg.EuLo;
    END_IF;
    CASE ReqItem OF
      1, 2:                                     (* モード・模擬 *)
        IF (v <> 0.0) AND (v <> 1.0) THEN
          res := 8;
        ELSIF ReqItem = 1 THEN
          oos := v = 1.0;
        ELSE
          sim := v = 1.0;
        END_IF;
      3:                                        (* 模擬値 *)
        Cfg.SimValue := v;
      4:                                        (* 代替値の入・切（拡張 8-8） *)
        IF v = 0.0 THEN
          Cfg.SubOn := FALSE;
        ELSIF v = 1.0 THEN
          Cfg.SubOn := TRUE;
        ELSE
          res := 8;
        END_IF;
      5:                                        (* 代替値 *)
        IF (v < Cfg.EuLo) OR (v > Cfg.EuHi) THEN
          res := 3;
        ELSE
          Cfg.SubValue := v;
        END_IF;
      22:                                       (* 抑制する警報 *)
        IF (v < 0.0) OR (v > 31.0) THEN
          res := 12;
        ELSE
          rv := REAL_TO_INT(v);
          IF INT_TO_REAL(rv) <> v THEN
            res := 8;
          ELSE
            Cfg.SuppMask := INT_TO_WORD(rv);
          END_IF;
        END_IF;
      23:                                       (* 抑制を続ける時間 *)
        IF (v < 0.0) OR (v > 3600.0) THEN
          res := 12;
        ELSE
          Cfg.SuppOffT := v;
        END_IF;
      10..13:                                   (* 警報設定値 HH・H・L・LL *)
        IF (v < Cfg.EuLo) OR (v > Cfg.EuHi) THEN
          res := 3;
        ELSE
          (* 有効な段どうしで LL < L < H < HH *)
          lims[0] := Cfg.LimLL;
          lims[1] := Cfg.LimL;
          lims[2] := Cfg.LimH;
          lims[3] := Cfg.LimHH;
          k := 13 - ReqItem;                    (* 10 HH → 3 … 13 LL → 0 *)
          lims[k] := v;
          n := 0;
          ok := TRUE;
          prev := 0.0;
          FOR i := 0 TO 3 DO
            bit := SHL(INT_TO_WORD(1), 3 - i);  (* LL bit3 … HH bit0 *)
            IF (Cfg.Inh AND bit) = 0 THEN       (* 有効な段どうしだけ。変える段が無効なら入れない（13-20） *)
              IF (n > 0) AND NOT (prev < lims[i]) THEN
                ok := FALSE;
              END_IF;
              prev := lims[i];
              n := n + 1;
            END_IF;
          END_FOR;
          IF NOT ok THEN
            res := 13;
          ELSIF ReqItem = 10 THEN
            Cfg.LimHH := v;
          ELSIF ReqItem = 11 THEN
            Cfg.LimH := v;
          ELSIF ReqItem = 12 THEN
            Cfg.LimL := v;
          ELSE
            Cfg.LimLL := v;
          END_IF;
        END_IF;
      14:                                       (* ヒステリシス：0〜スパンの 10 % *)
        IF (v < 0.0) OR (spanOk AND (v > 0.1 * span)) THEN
          res := 12;
        ELSE
          Cfg.Hys := v;
        END_IF;
      15:                                       (* フィルタ時定数：0〜3600 s *)
        IF (v < 0.0) OR (v > 3600.0) THEN
          res := 12;
        ELSE
          Cfg.FilterT := v;
        END_IF;
      16..19:                                   (* 警報の有効・無効 *)
        IF (v <> 0.0) AND (v <> 1.0) THEN
          res := 8;
        ELSE
          bit := SHL(INT_TO_WORD(1), ReqItem - 16);
          IF v = 0.0 THEN
            Cfg.Inh := Cfg.Inh OR bit;
          ELSE
            Cfg.Inh := Cfg.Inh AND NOT bit;
          END_IF;
        END_IF;
      20, 21:                                   (* レンジの変更（13-13） *)
        lo := Cfg.EuLo;
        hi := Cfg.EuHi;
        IF ReqItem = 20 THEN
          lo := v;
        ELSE
          hi := v;
        END_IF;
        IF NOT (lo < hi) THEN
          res := 13;
        ELSE
          lims[0] := Cfg.LimLL;
          lims[1] := Cfg.LimL;
          lims[2] := Cfg.LimH;
          lims[3] := Cfg.LimHH;
          FOR i := 0 TO 3 DO
            bit := SHL(INT_TO_WORD(1), 3 - i);
            IF ((Cfg.Inh AND bit) = 0) AND ((lims[i] < lo) OR (lims[i] > hi)) THEN
              res := 13;
            END_IF;
          END_FOR;
          IF res = 0 THEN
            IF PB_IsFinite(lo) AND PB_IsFinite(hi) THEN
              IF Cfg.Hys > 0.1 * (hi - lo) THEN
                res := 12;
              END_IF;
            END_IF;
          END_IF;
          IF res = 0 THEN
            IF ReqItem = 20 THEN
              Cfg.EuLo := v;
            ELSE
              Cfg.EuHi := v;
            END_IF;
          END_IF;
        END_IF;
    END_CASE;
  END_IF;
  Result := res;
  AckSeq := ReqSeq;
  (* 停止→運転、模擬 入→切、代替値 入→切 は Init と同じ（13-9、拡張 8-6） *)
  IF (wasOos AND NOT oos) OR (wasSim AND NOT sim) OR (wasSub AND NOT Cfg.SubOn) THEN
    initLike := TRUE;
  END_IF;
END_IF;

(* ---- 設定の検査（6 章、13-17）。計算できない設定だけを異常にする ---- *)
cfgErr := NOT (PB_IsFinite(Cfg.RawLo) AND PB_IsFinite(Cfg.RawHi) AND PB_IsFinite(Cfg.EuLo) AND PB_IsFinite(Cfg.EuHi)
  AND PB_IsFinite(Cfg.FilterT) AND PB_IsFinite(Cfg.LimHH) AND PB_IsFinite(Cfg.LimH) AND PB_IsFinite(Cfg.LimL)
  AND PB_IsFinite(Cfg.LimLL) AND PB_IsFinite(Cfg.Hys) AND PB_IsFinite(Cfg.FailLo) AND PB_IsFinite(Cfg.OorLo)
  AND PB_IsFinite(Cfg.OorHi) AND PB_IsFinite(Cfg.FailHi) AND PB_IsFinite(Cfg.SimValue) AND PB_IsFinite(Cfg.FailDelay)
  AND PB_IsFinite(Cfg.SuppOffT) AND PB_IsFinite(Cfg.SubValue));
IF NOT cfgErr THEN
  (* 判定点の順番。STruC++ 0.8.0 は NOT (a AND b) を C++ にできないので、いったん BOOL に入れる *)
  ok := (Cfg.FailLo <= Cfg.OorLo) AND (Cfg.OorLo <= 4.0) AND (20.0 <= Cfg.OorHi) AND (Cfg.OorHi <= Cfg.FailHi);
  cfgErr := ((Cfg.InType <> 0) AND (Cfg.InType <> 1))
    OR ((Cfg.FailMode <> 0) AND (Cfg.FailMode <> 1))
    OR (Cfg.RawLo = Cfg.RawHi)
    OR NOT (Cfg.EuLo < Cfg.EuHi)
    OR (Cfg.FilterT < 0.0) OR (Cfg.FailDelay < 0.0) OR (Cfg.Hys < 0.0)
    OR NOT ok
    OR (Cfg.SuppOffT < 0.0) OR ((Cfg.SuppMask AND 16#FFE0) <> 0);   (* 拡張 8-7 *)
END_IF;

(* ---- mA と工学値（処理 2・4）。設定異常・入力が数でないときは計算しない（C-8、13-21） ---- *)
inOk := PB_IsFinite(In);
chf := ChFault OR NOT inOk;
x := 0.0;
mAv := 0.0;
pvRaw := 0.0;
IF (NOT cfgErr) AND inOk THEN
  (* C-8：設定異常でない（RawLo・RawHi が有限で RawLo ≠ RawHi）ときだけ通る。In も有限を確かめた。差があふれる 1E38 級の値は想定しない *)
  x := (In - Cfg.RawLo) / (Cfg.RawHi - Cfg.RawLo);
  IF Cfg.InType = 0 THEN
    mAv := 4.0 + 16.0 * x;
  END_IF;
  pvRaw := Cfg.EuLo + x * (Cfg.EuHi - Cfg.EuLo);
END_IF;
mA := mAv;

q := 0;
qCause := 0;
doEval := FALSE;
onSub := FALSE;

IF cfgErr THEN
  (* 設定異常：PV 保持、警報なし、Bad（計器）。戻ったら Init と同じ（13-19） *)
  fault := FALSE; pending := FALSE; pendT := 0.0; cCh := FALSE; cLo := FALSE; cHi := FALSE;
  aHH := FALSE; aH := FALSE; aL := FALSE; aLL := FALSE;
  primed := FALSE;
  q := 2;
  qCause := 1;
ELSE
  IF NOT primed THEN
    initLike := TRUE;
    primed := TRUE;
  END_IF;
  IF sim THEN
    src := Cfg.SimValue;
  ELSE
    src := pvRaw;
  END_IF;
  (* ② Init と同じ扱い：フィルタ・保持値を今の値に、故障と警報を消す（7 章） *)
  IF initLike THEN
    IF sim OR inOk THEN                         (* 入力が数でなければ保持（13-21） *)
      y := src;
      PV := src;
    END_IF;
    fault := FALSE; pending := FALSE; pendT := 0.0; cCh := FALSE; cLo := FALSE; cHi := FALSE;
    aHH := FALSE; aH := FALSE; aL := FALSE; aLL := FALSE;
  END_IF;

  IF oos THEN
    (* 停止中：PV 保持、警報も故障判定もしない（M-4、13-16） *)
    fault := FALSE; pending := FALSE; pendT := 0.0; cCh := FALSE; cLo := FALSE; cHi := FALSE;
    aHH := FALSE; aH := FALSE; aL := FALSE; aLL := FALSE;
    q := 3;
  ELSIF sim THEN
    (* 模擬：模擬値にフィルタ、警報を判定、故障判定はしない（13-8） *)
    fault := FALSE; pending := FALSE; pendT := 0.0; cCh := FALSE; cLo := FALSE; cHi := FALSE;
    u := src;
    doEval := TRUE;
  ELSE
    (* ③ 計器故障の判定（3 章） *)
    fLo := (Cfg.InType = 0) AND inOk AND (mAv <= Cfg.FailLo);
    fHi := (Cfg.InType = 0) AND inOk AND (mAv >= Cfg.FailHi);
    IF fault THEN
      back := (Cfg.InType <> 0) OR ((mAv >= Cfg.OorLo) AND (mAv <= Cfg.OorHi));
      IF back AND NOT chf THEN
        fault := FALSE; pending := FALSE; pendT := 0.0; cCh := FALSE; cLo := FALSE; cHi := FALSE;
        aHH := FALSE; aH := FALSE; aL := FALSE; aLL := FALSE;   (* 13-7 *)
      END_IF;
    ELSIF fLo OR fHi OR chf THEN
      cLo := cLo OR fLo;
      cHi := cHi OR fHi;
      cCh := cCh OR chf;
      pendT := pendT + dtc;                     (* 13-6 *)
      IF pendT >= Cfg.FailDelay THEN
        fault := TRUE;
        pending := FALSE;
      ELSE
        pending := TRUE;
      END_IF;
    ELSE
      fault := FALSE; pending := FALSE; pendT := 0.0; cCh := FALSE; cLo := FALSE; cHi := FALSE;
    END_IF;

    IF fault THEN
      (* 計器故障：警報なし。PV は保持（FailMode 0）か計算値（FailMode 1、13-4）。フィルタは止める（13-2） *)
      aHH := FALSE; aH := FALSE; aL := FALSE; aLL := FALSE;
      IF (Cfg.FailMode = 1) AND inOk THEN
        PV := pvRaw;
      END_IF;
      q := 2;
      qCause := 1;
    ELSIF pending THEN
      (* 故障の疑い：PV・警報を保持、フィルタは止める *)
      q := 1;
      qCause := 1;
    ELSE
      u := pvRaw;
      doEval := TRUE;
      IF Cfg.InType = 0 THEN
        inRange := (mAv >= 4.0) AND (mAv <= 20.0);
      ELSE
        inRange := (pvRaw >= Cfg.EuLo) AND (pvRaw <= Cfg.EuHi);   (* 13-11 *)
      END_IF;
      IF NOT inRange THEN
        q := 1;                                 (* レンジ外だが有効（Uncertain、プロセス） *)
      END_IF;
    END_IF;
  END_IF;

  IF doEval THEN
    (* ④⑤ フィルタ（処理 5）：y ← y + (u − y) × dt / (FilterT + dt)。FilterT = 0 は素通し *)
    IF Cfg.FilterT = 0.0 THEN
      y := u;
    ELSIF dtc > 0.0 THEN
      (* C-8：ここは dtc > 0、FilterT ≧ 0（設定異常でない）なので割る数は正 *)
      y := y + ((u - y) * dtc) / (Cfg.FilterT + dtc);
    END_IF;
    PV := y;
    (* ⑥ 警報（4 章）。高い側：PV ≧ 設定値で発生、PV < 設定値 − Hys で戻る。低い側は逆 *)
    IF (Cfg.Inh AND 16#0001) <> 0 THEN
      aHH := FALSE;
    ELSIF PV >= Cfg.LimHH THEN
      aHH := TRUE;
    ELSIF PV < Cfg.LimHH - Cfg.Hys THEN
      aHH := FALSE;
    END_IF;
    IF (Cfg.Inh AND 16#0002) <> 0 THEN
      aH := FALSE;
    ELSIF PV >= Cfg.LimH THEN
      aH := TRUE;
    ELSIF PV < Cfg.LimH - Cfg.Hys THEN
      aH := FALSE;
    END_IF;
    IF (Cfg.Inh AND 16#0004) <> 0 THEN
      aL := FALSE;
    ELSIF PV <= Cfg.LimL THEN
      aL := TRUE;
    ELSIF PV > Cfg.LimL + Cfg.Hys THEN
      aL := FALSE;
    END_IF;
    IF (Cfg.Inh AND 16#0008) <> 0 THEN
      aLL := FALSE;
    ELSIF PV <= Cfg.LimLL THEN
      aLL := TRUE;
    ELSIF PV > Cfg.LimLL + Cfg.Hys THEN
      aLL := FALSE;
    END_IF;
  END_IF;

  (* 代替値（拡張 8-4・8-5）：計器故障は上で判定したまま、PV と警報だけ置き換える。停止中・模擬が優先 *)
  IF (NOT oos) AND (NOT sim) AND Cfg.SubOn THEN
    onSub := TRUE;
    aHH := FALSE; aH := FALSE; aL := FALSE; aLL := FALSE;
    PV := Cfg.SubValue;
    y := PV;
    q := 1;
    qCause := 1;
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

(* ---- ⑦ 出力・状態ワード（共通仕様 2 章、8 章） ---- *)
Fail := fault AND NOT oos AND NOT sim AND NOT cfgErr;
HH := aHH;
H := aH;
L := aL;
LL := aLL;
w := 0;
IF HH THEN w := w OR 16#0001; END_IF;
IF H THEN w := w OR 16#0002; END_IF;
IF L THEN w := w OR 16#0004; END_IF;
IF LL THEN w := w OR 16#0008; END_IF;
IF Fail THEN w := w OR 16#0010; END_IF;
IF supping THEN
  mk := Cfg.SuppMask AND 16#001F;               (* 拡張 8-3 *)
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
IF ((q = 1) OR (q = 2)) AND (qCause = 1) THEN w := w OR 16#0020; END_IF;
IF (sim OR onSub) AND NOT oos THEN w := w OR 16#0040; END_IF;
IF cfgErr THEN w := w OR 16#0080; END_IF;
IF dtClamp THEN w := w OR 16#0100; END_IF;
STS := w;

w := 0;
IF dtClamp THEN w := w OR 16#0001; END_IF;
IF cfgErr THEN w := w OR 16#0002; END_IF;
IF (fault OR pending) AND cCh THEN w := w OR 16#0004; END_IF;
IF (fault OR pending) AND cLo THEN w := w OR 16#0008; END_IF;
IF (fault OR pending) AND cHi THEN w := w OR 16#0010; END_IF;
IF pending THEN w := w OR 16#0020; END_IF;
IF supping THEN w := w OR 16#0040; END_IF;
DIAG := w;
MODE := 0;

END_FUNCTION_BLOCK
