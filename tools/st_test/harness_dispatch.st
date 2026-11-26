(*
 * 試験専用：受付箱に本物のブロックをつないだ小さなプラント（PB_ReqDispatch 仕様書 2 章・12 章の呼び出しコード）。
 * 口 1 = PB_Pid（LIC。SP 50・MV 30、ほかは既定値）、口 2 = PB_Intlk（IL。既定値）。宛先は受付箱の後に呼ぶ。
 * JS の js/test/dispatch.test.js の plant() と同じ形。ブロック本体ではない（st に入れない）。
 *
 * Cmd：0 = 1 スキャン、1 = 受付箱に 1 件書いて返事が来るまで（最大 10 スキャン）、2 = Init の 1 スキャン
 *)
FUNCTION_BLOCK TH_DispPlant
VAR_INPUT
  Cmd : INT;
  Tag : INT;
  Item : INT;
  Value : REAL;
  Writer : INT;
  IlIn1 : BOOL;
END_VAR
VAR_OUTPUT
  Res : INT;         (* 受付箱の返事 *)
  Scans : INT;       (* 返事までのスキャン数 *)
  LicSP : REAL;
  LicMV : REAL;
  LicPB : REAL;
  IlTrip : BOOL;
END_VAR
VAR
  disp : PB_ReqDispatch;
  dc : PB_ReqDispatch_Cfg;
  pp : ARRAY[1..64] OF PB_ReqPort;
  lic : PB_Pid;
  lc : PB_Pid_Cfg;
  il : PB_Intlk;
  ic : PB_Intlk_Cfg;
  box : INT;
  doInit : BOOL;
  started : BOOL;
  n : INT;
END_VAR

IF NOT started THEN
  dc.NumPorts := 64;
  dc.TimeOut := 1.0;
  lc.Action := 0; lc.Alg := 0; lc.EuLo := 0.0; lc.EuHi := 100.0; lc.PB := 100.0; lc.TI := 20.0; lc.TD := 0.0;
  lc.MvLo := 0.0; lc.MvHi := 100.0; lc.TrkEndMan := FALSE; lc.SP := 50.0; lc.MV := 30.0; lc.Mode := 0;
  ic.ResetMode := 0; ic.ResetBy := 1; ic.FoEn := TRUE;
  FOR n := 1 TO 8 DO
    ic.Delay[n] := 0.0;
  END_FOR;
  started := TRUE;
END_IF;

doInit := Cmd = 2;
IF Cmd = 1 THEN
  box := box + 1;
END_IF;
n := 0;
REPEAT
  (* 呼び出しコード（仕様書 12 章と同じ並び） *)
  disp(BoxSeq := box, BoxTag := Tag, BoxItem := Item, BoxValue := Value, BoxWriter := Writer, dt := 0.25, Init := doInit,
    Cfg := dc, Ports := pp);
  lic(PV := 50.0, dt := 0.25, Init := doInit, ReqSeq := pp[1].Seq, ReqItem := pp[1].Item, ReqValue := pp[1].Value,
    ReqWriter := pp[1].Writer, Cfg := lc);
  pp[1].AckSeq := lic.AckSeq;
  pp[1].Result := lic.Result;
  il(In1 := IlIn1, dt := 0.25, Init := doInit, ReqSeq := pp[2].Seq, ReqItem := pp[2].Item, ReqValue := pp[2].Value,
    ReqWriter := pp[2].Writer, Cfg := ic);
  pp[2].AckSeq := il.AckSeq;
  pp[2].Result := il.Result;
  doInit := FALSE;
  n := n + 1;
UNTIL (Cmd <> 1) OR (disp.BoxAck = box) OR (n >= 10)
END_REPEAT;

Res := disp.BoxResult;
Scans := n;
LicSP := lic.SP;
LicMV := lc.MV;
LicPB := lc.PB;
IlTrip := il.Trip;
END_FUNCTION_BLOCK
