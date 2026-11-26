(*
 * 受付箱（PB_ReqDispatch 仕様書 2 章・12 章）に本物のブロックをつなぐ。手で書いた試験。
 * 期待値は js/test/dispatch.test.js と同じ（各仕様書から手で起こしたもの）。
 * プラントは harness_dispatch.st の TH_DispPlant（口 1 = PB_Pid、口 2 = PB_Intlk）。
 *)

TEST 'DSP-01 LIC SP via mailbox'
  VAR p : TH_DispPlant; END_VAR
  p(Cmd := 2);
  p(Cmd := 1, Tag := 1, Item := 2, Value := 60.0, Writer := 1);
  ASSERT_EQ(p.Res, 0, 'DSP-01 result');
  ASSERT_EQ(p.Scans, 2, 'DSP-01 scans');
  ASSERT_NEAR(p.LicSP, 60.0, 0.0001, 'DSP-01 SP');
END_TEST

TEST 'DSP-02 target result is passed through'
  VAR p : TH_DispPlant; END_VAR
  p(Cmd := 2);
  p(Cmd := 1, Tag := 1, Item := 2, Value := 150.0, Writer := 1);
  ASSERT_EQ(p.Res, 3, 'DSP-02 SP out of range');
  p(Cmd := 1, Tag := 1, Item := 3, Value := 40.0, Writer := 1);
  ASSERT_EQ(p.Res, 0, 'DSP-02 MV in MAN');
  ASSERT_NEAR(p.LicMV, 40.0, 0.0001, 'DSP-02 MV');
  p(Cmd := 1, Tag := 1, Item := 10, Value := 80.0, Writer := 1);
  ASSERT_EQ(p.Res, 2, 'DSP-02 operator cannot write PB');
  ASSERT_NEAR(p.LicPB, 100.0, 0.0001, 'DSP-02 PB');
END_TEST

TEST 'DSP-03 interlock reset'
  VAR p : TH_DispPlant; END_VAR
  p(Cmd := 2, IlIn1 := FALSE);
  p(Cmd := 1, Tag := 2, Item := 1, Value := 1.0, Writer := 1);
  ASSERT_EQ(p.Res, 10, 'DSP-03 not active');
  p(Cmd := 0, IlIn1 := TRUE);
  ASSERT_TRUE(p.IlTrip, 'DSP-03 trip');
  p(Cmd := 1, Tag := 2, Item := 1, Value := 1.0, Writer := 1);
  ASSERT_EQ(p.Res, 11, 'DSP-03 cause remains');
  p(Cmd := 1, IlIn1 := FALSE);
  ASSERT_EQ(p.Res, 0, 'DSP-03 reset');
  ASSERT_FALSE(p.IlTrip, 'DSP-03 trip cleared');
END_TEST

TEST 'DSP-04 unwired port times out, out of range port 15'
  VAR p : TH_DispPlant; END_VAR
  p(Cmd := 2);
  p(Cmd := 1, Tag := 3, Item := 1, Value := 1.0, Writer := 1);
  ASSERT_EQ(p.Res, 16, 'DSP-04 no reply');
  ASSERT_EQ(p.Scans, 5, 'DSP-04 scans to time out');
  p(Cmd := 1, Tag := 65, Item := 1, Value := 1.0, Writer := 1);
  ASSERT_EQ(p.Res, 15, 'DSP-04 no target');
  ASSERT_EQ(p.Scans, 1, 'DSP-04 scans for 15');
  p(Cmd := 1, Tag := 1, Item := 2, Value := 55.0, Writer := 2);
  ASSERT_EQ(p.Res, 0, 'DSP-04 next one passes');
  ASSERT_NEAR(p.LicSP, 55.0, 0.0001, 'DSP-04 SP');
END_TEST

TEST 'DSP-05 Alive wraps 32767 to 0'
  VAR
    d : PB_ReqDispatch;
    c : PB_ReqDispatch_Cfg;
    pts : ARRAY[1..64] OF PB_ReqPort;
    i : DINT;     (* INT だと 32767 の次で -32768 に戻り、FOR が終わらない *)
  END_VAR
  c.NumPorts := 64;
  c.TimeOut := 1.0;
  FOR i := 1 TO 32767 DO
    d(dt := 0.25, Cfg := c, Ports := pts);
  END_FOR;
  ASSERT_EQ(d.Alive, 32767, 'DSP-05 max');
  d(dt := 0.25, Cfg := c, Ports := pts);
  ASSERT_EQ(d.Alive, 0, 'DSP-05 wrap');
END_TEST
