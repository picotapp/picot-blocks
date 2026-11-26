(*
 * カスケード（PB_Pid 仕様書 4 章、J-3・J-6）：上位・下位の 2 台をつなぐ。手で書いた試験（テストベクタの形にしにくいもの）。
 * 期待値は js/test/cascade.test.js と同じ（仕様書から手で起こしたもの）。
 * どちらもレンジ 0〜100・正動作・PB 100（K = 1）・TI 0。
 * つなぎ方：上位.TrkOn ← NOT 下位.BkCas、上位.TrkVal ← 下位.BkSp、下位.CasIn ← 上位.MV
 * 2：両方 AUT、4：下位を CAS、6：上位の PV が 10 % 上がる
 *)

TEST 'CAS-01 up then down'
  VAR
    up : PB_Pid;
    lo : PB_Pid;
    cu : PB_Pid_Cfg;
    cl : PB_Pid_Cfg;
    pvU : REAL;
  END_VAR
  cu.Action := 1;
  cu.Alg := 0;
  cu.EuLo := 0.0;
  cu.EuHi := 100.0;
  cu.PB := 100.0;
  cu.TI := 0.0;
  cu.TD := 0.0;
  cu.MvLo := 0.0;
  cu.MvHi := 100.0;
  cu.TrkEndMan := FALSE;
  cu.SP := 50.0;
  cu.MV := 0.0;
  cu.Mode := 0;
  cl.Action := 1;
  cl.Alg := 0;
  cl.EuLo := 0.0;
  cl.EuHi := 100.0;
  cl.PB := 100.0;
  cl.TI := 0.0;
  cl.TD := 0.0;
  cl.MvLo := 0.0;
  cl.MvHi := 100.0;
  cl.TrkEndMan := FALSE;
  cl.SP := 40.0;
  cl.MV := 30.0;
  cl.Mode := 0;
  pvU := 50.0;
  (* 1：Init（どちらも MAN） *)
  up(PV := pvU, dt := 0.25, CasGood := TRUE, TrkOn := NOT lo.BkCas, TrkVal := lo.BkSp, Init := TRUE, Cfg := cu);
  cu := up.Cfg;
  lo(PV := 40.0, dt := 0.25, CasGood := TRUE, CasIn := up.MV, Init := TRUE, Cfg := cl);
  cl := lo.Cfg;
  (* 2 *)
  up(ReqSeq := 1, ReqItem := 1, ReqValue := 1.0, ReqWriter := 1, PV := pvU, dt := 0.25, CasGood := TRUE, TrkOn := NOT lo.BkCas, TrkVal := lo.BkSp, Init := FALSE, Cfg := cu);
  cu := up.Cfg;
  lo(ReqSeq := 1, ReqItem := 1, ReqValue := 1.0, ReqWriter := 1, PV := 40.0, dt := 0.25, CasGood := TRUE, CasIn := up.MV, Init := FALSE, Cfg := cl);
  cl := lo.Cfg;
  ASSERT_NEAR(up.MV, 40.0, 0.0001, 'CAS-01 up then down s2 up.MV');
  ASSERT_NEAR(lo.SP, 40.0, 0.0001, 'CAS-01 up then down s2 lo.SP');
  (* 3 *)
  up(PV := pvU, dt := 0.25, CasGood := TRUE, TrkOn := NOT lo.BkCas, TrkVal := lo.BkSp, Init := FALSE, Cfg := cu);
  cu := up.Cfg;
  lo(PV := 40.0, dt := 0.25, CasGood := TRUE, CasIn := up.MV, Init := FALSE, Cfg := cl);
  cl := lo.Cfg;
  ASSERT_NEAR(up.MV, 40.0, 0.0001, 'CAS-01 up then down s3 up.MV');
  ASSERT_NEAR(lo.SP, 40.0, 0.0001, 'CAS-01 up then down s3 lo.SP');
  (* 4 *)
  up(PV := pvU, dt := 0.25, CasGood := TRUE, TrkOn := NOT lo.BkCas, TrkVal := lo.BkSp, Init := FALSE, Cfg := cu);
  cu := up.Cfg;
  lo(ReqSeq := 2, ReqValue := 2.0, PV := 40.0, dt := 0.25, CasGood := TRUE, CasIn := up.MV, Init := FALSE, Cfg := cl);
  cl := lo.Cfg;
  ASSERT_NEAR(up.MV, 40.0, 0.0001, 'CAS-01 up then down s4 up.MV');
  ASSERT_NEAR(lo.SP, 40.0, 0.0001, 'CAS-01 up then down s4 lo.SP');
  ASSERT_EQ(lo.MODE, 2, 'CAS-01 up then down s4 lo.MODE');
  (* 5 *)
  up(PV := pvU, dt := 0.25, CasGood := TRUE, TrkOn := NOT lo.BkCas, TrkVal := lo.BkSp, Init := FALSE, Cfg := cu);
  cu := up.Cfg;
  lo(PV := 40.0, dt := 0.25, CasGood := TRUE, CasIn := up.MV, Init := FALSE, Cfg := cl);
  cl := lo.Cfg;
  ASSERT_NEAR(up.MV, 40.0, 0.0001, 'CAS-01 up then down s5 up.MV');
  ASSERT_NEAR(lo.SP, 40.0, 0.0001, 'CAS-01 up then down s5 lo.SP');
  (* 6 *)
  pvU := 60.0;
  up(PV := pvU, dt := 0.25, CasGood := TRUE, TrkOn := NOT lo.BkCas, TrkVal := lo.BkSp, Init := FALSE, Cfg := cu);
  cu := up.Cfg;
  lo(PV := 40.0, dt := 0.25, CasGood := TRUE, CasIn := up.MV, Init := FALSE, Cfg := cl);
  cl := lo.Cfg;
  ASSERT_NEAR(up.MV, 50.0, 0.0001, 'CAS-01 up then down s6 up.MV');
  ASSERT_NEAR(lo.SP, 50.0, 0.0001, 'CAS-01 up then down s6 lo.SP');
  (* 7 *)
  up(PV := pvU, dt := 0.25, CasGood := TRUE, TrkOn := NOT lo.BkCas, TrkVal := lo.BkSp, Init := FALSE, Cfg := cu);
  cu := up.Cfg;
  lo(PV := 40.0, dt := 0.25, CasGood := TRUE, CasIn := up.MV, Init := FALSE, Cfg := cl);
  cl := lo.Cfg;
  ASSERT_NEAR(up.MV, 50.0, 0.0001, 'CAS-01 up then down s7 up.MV');
  ASSERT_NEAR(lo.SP, 50.0, 0.0001, 'CAS-01 up then down s7 lo.SP');
END_TEST

TEST 'CAS-02 down then up'
  VAR
    up : PB_Pid;
    lo : PB_Pid;
    cu : PB_Pid_Cfg;
    cl : PB_Pid_Cfg;
    pvU : REAL;
  END_VAR
  cu.Action := 1;
  cu.Alg := 0;
  cu.EuLo := 0.0;
  cu.EuHi := 100.0;
  cu.PB := 100.0;
  cu.TI := 0.0;
  cu.TD := 0.0;
  cu.MvLo := 0.0;
  cu.MvHi := 100.0;
  cu.TrkEndMan := FALSE;
  cu.SP := 50.0;
  cu.MV := 0.0;
  cu.Mode := 0;
  cl.Action := 1;
  cl.Alg := 0;
  cl.EuLo := 0.0;
  cl.EuHi := 100.0;
  cl.PB := 100.0;
  cl.TI := 0.0;
  cl.TD := 0.0;
  cl.MvLo := 0.0;
  cl.MvHi := 100.0;
  cl.TrkEndMan := FALSE;
  cl.SP := 40.0;
  cl.MV := 30.0;
  cl.Mode := 0;
  pvU := 50.0;
  (* 1：Init（どちらも MAN） *)
  lo(PV := 40.0, dt := 0.25, CasGood := TRUE, CasIn := up.MV, Init := TRUE, Cfg := cl);
  cl := lo.Cfg;
  up(PV := pvU, dt := 0.25, CasGood := TRUE, TrkOn := NOT lo.BkCas, TrkVal := lo.BkSp, Init := TRUE, Cfg := cu);
  cu := up.Cfg;
  (* 2 *)
  lo(ReqSeq := 1, ReqItem := 1, ReqValue := 1.0, ReqWriter := 1, PV := 40.0, dt := 0.25, CasGood := TRUE, CasIn := up.MV, Init := FALSE, Cfg := cl);
  cl := lo.Cfg;
  up(ReqSeq := 1, ReqItem := 1, ReqValue := 1.0, ReqWriter := 1, PV := pvU, dt := 0.25, CasGood := TRUE, TrkOn := NOT lo.BkCas, TrkVal := lo.BkSp, Init := FALSE, Cfg := cu);
  cu := up.Cfg;
  ASSERT_NEAR(up.MV, 40.0, 0.0001, 'CAS-02 down then up s2 up.MV');
  ASSERT_NEAR(lo.SP, 40.0, 0.0001, 'CAS-02 down then up s2 lo.SP');
  (* 3 *)
  lo(PV := 40.0, dt := 0.25, CasGood := TRUE, CasIn := up.MV, Init := FALSE, Cfg := cl);
  cl := lo.Cfg;
  up(PV := pvU, dt := 0.25, CasGood := TRUE, TrkOn := NOT lo.BkCas, TrkVal := lo.BkSp, Init := FALSE, Cfg := cu);
  cu := up.Cfg;
  ASSERT_NEAR(up.MV, 40.0, 0.0001, 'CAS-02 down then up s3 up.MV');
  ASSERT_NEAR(lo.SP, 40.0, 0.0001, 'CAS-02 down then up s3 lo.SP');
  (* 4 *)
  lo(ReqSeq := 2, ReqValue := 2.0, PV := 40.0, dt := 0.25, CasGood := TRUE, CasIn := up.MV, Init := FALSE, Cfg := cl);
  cl := lo.Cfg;
  up(PV := pvU, dt := 0.25, CasGood := TRUE, TrkOn := NOT lo.BkCas, TrkVal := lo.BkSp, Init := FALSE, Cfg := cu);
  cu := up.Cfg;
  ASSERT_NEAR(up.MV, 40.0, 0.0001, 'CAS-02 down then up s4 up.MV');
  ASSERT_NEAR(lo.SP, 40.0, 0.0001, 'CAS-02 down then up s4 lo.SP');
  ASSERT_EQ(lo.MODE, 2, 'CAS-02 down then up s4 lo.MODE');
  (* 5 *)
  lo(PV := 40.0, dt := 0.25, CasGood := TRUE, CasIn := up.MV, Init := FALSE, Cfg := cl);
  cl := lo.Cfg;
  up(PV := pvU, dt := 0.25, CasGood := TRUE, TrkOn := NOT lo.BkCas, TrkVal := lo.BkSp, Init := FALSE, Cfg := cu);
  cu := up.Cfg;
  ASSERT_NEAR(up.MV, 40.0, 0.0001, 'CAS-02 down then up s5 up.MV');
  ASSERT_NEAR(lo.SP, 40.0, 0.0001, 'CAS-02 down then up s5 lo.SP');
  (* 6 *)
  pvU := 60.0;
  lo(PV := 40.0, dt := 0.25, CasGood := TRUE, CasIn := up.MV, Init := FALSE, Cfg := cl);
  cl := lo.Cfg;
  up(PV := pvU, dt := 0.25, CasGood := TRUE, TrkOn := NOT lo.BkCas, TrkVal := lo.BkSp, Init := FALSE, Cfg := cu);
  cu := up.Cfg;
  ASSERT_NEAR(up.MV, 50.0, 0.0001, 'CAS-02 down then up s6 up.MV');
  ASSERT_NEAR(lo.SP, 40.0, 0.0001, 'CAS-02 down then up s6 lo.SP');
  (* 7 *)
  lo(PV := 40.0, dt := 0.25, CasGood := TRUE, CasIn := up.MV, Init := FALSE, Cfg := cl);
  cl := lo.Cfg;
  up(PV := pvU, dt := 0.25, CasGood := TRUE, TrkOn := NOT lo.BkCas, TrkVal := lo.BkSp, Init := FALSE, Cfg := cu);
  cu := up.Cfg;
  ASSERT_NEAR(up.MV, 50.0, 0.0001, 'CAS-02 down then up s7 up.MV');
  ASSERT_NEAR(lo.SP, 50.0, 0.0001, 'CAS-02 down then up s7 lo.SP');
END_TEST
