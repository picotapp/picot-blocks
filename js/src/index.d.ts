/** PICOT Blocks の JS 参照実装の型（TypeScript から使うため） */

/** PB_AnaMon の設定（仕様書 6 章。利用者のプログラムが持ち、FB に渡す） */
export interface AnaMonCfg {
  InType: number;
  RawLo: number;
  RawHi: number;
  EuLo: number;
  EuHi: number;
  FilterT: number;
  LimHH: number;
  LimH: number;
  LimL: number;
  LimLL: number;
  Hys: number;
  /** 警報の無効ビット：bit0 HH・bit1 H・bit2 L・bit3 LL */
  Inh: number;
  FailMode: number;
  FailLo: number;
  OorLo: number;
  OorHi: number;
  FailHi: number;
  SimValue: number;
  FailDelay: number;
  /** 抑制する警報（ALM と同じビット）。書かなければ 0（拡張 8-1） */
  SuppMask?: number;
  /** Supp が FALSE になってから抑制を続ける時間（s） */
  SuppOffT?: number;
  /** 代替値で運転する（保持する値） */
  SubOn?: boolean;
  SubValue?: number;
}

export interface AnaMonInputs {
  /** AI ユニットのディジタル値（分解能のカウント値） */
  In: number;
  ChFault?: boolean;
  /** 警報を抑制する（設計で決めた条件） */
  Supp?: boolean;
  dt: number;
  Init?: boolean;
  ReqSeq?: number;
  ReqItem?: number;
  ReqValue?: number;
  /** 1 運転員・2 エンジニア */
  ReqWriter?: number;
}

export function anaMonDefaultCfg(): AnaMonCfg;

/** 結果の番号（共通仕様 3 章） */
export declare const R: { OK: 0; NO_ITEM: 1; WRITER: 2; RANGE: 3; BAD_VALUE: 8; PARAM: 12; ORDER: 13 };

export class PB_AnaMon {
  PV: number;
  mA: number;
  STS: number;
  MODE: number;
  ALM: number;
  DIAG: number;
  HH: boolean;
  H: boolean;
  L: boolean;
  LL: boolean;
  Fail: boolean;
  /** 品質が Bad または停止中 */
  Bad: boolean;
  /** 抑制中で条件が成立している警報 */
  SUPALM: number;
  AckSeq: number;
  Result: number;
  call(inp: AnaMonInputs, cfg: AnaMonCfg): void;
}

/** PB_BinMon の設定（仕様書 6 章） */
export interface BinMonCfg {
  /** FALSE = NO（常時開）・TRUE = NC（常時閉） */
  Invert: boolean;
  OnDelay: number;
  OffDelay: number;
  /** bit0 = 動作の警報を無効 */
  Inh: number;
  /** 入力異常のとき：0 保持・1 動作・2 非動作 */
  FailMode: number;
  SimValue: boolean;
  /** bit0 動作・bit1 入力異常 */
  SuppMask?: number;
  SuppOffT?: number;
  SubOn?: boolean;
  SubValue?: boolean;
}

export interface BinMonInputs {
  /** DI の接点（配線のままの値） */
  In: boolean;
  ChFault?: boolean;
  Supp?: boolean;
  dt: number;
  Init?: boolean;
  ReqSeq?: number;
  ReqItem?: number;
  ReqValue?: number;
  ReqWriter?: number;
}

export function binMonDefaultCfg(): BinMonCfg;

export class PB_BinMon {
  /** 動作（反転・遅延の後） */
  Active: boolean;
  /** 反転の後・遅延の前 */
  InAct: boolean;
  ActAlm: boolean;
  Fail: boolean;
  Bad: boolean;
  SUPALM: number;
  STS: number;
  MODE: number;
  ALM: number;
  DIAG: number;
  AckSeq: number;
  Result: number;
  call(inp: BinMonInputs, cfg: BinMonCfg): void;
}

/** PB_DevCore の設定と運転時間・起動回数（仕様書 9 章） */
export interface DevCoreCfg {
  /** アンサーバック：0 なし・1 開（運転中）だけ・2 閉だけ・3 両方 */
  FbCfg: number;
  /** 安全側：0 off・1 on */
  SafeState: number;
  /** 失敗のとき：0 警報だけ・1 安全側へ */
  FaultAct: number;
  /** 指令外に安全側でない側へ動いたとき目標と DO を合わせる（ポンプ TRUE・弁 FALSE） */
  FbTrack: boolean;
  StatT: number;
  MonTOn: number;
  MonTOff: number;
  StrokeT: number;
  RunHours: number;
  RunSecFrac: number;
  Starts: number;
}

export interface DevCoreInputs {
  FbOn?: boolean;
  FbOff?: boolean;
  Intlk?: boolean;
  /** 既定 TRUE */
  Perm?: boolean;
  Local?: boolean;
  PCmdOn?: boolean;
  PCmdOff?: boolean;
  dt: number;
  Init?: boolean;
  ReqSeq?: number;
  ReqItem?: number;
  ReqValue?: number;
  ReqWriter?: number;
}

export function devCoreDefaultCfg(): DevCoreCfg;

/** 結果の番号（PB_DevCore で使うもの。4 モード・9 インターロック・14 起動条件） */
export declare const RD: { OK: 0; NO_ITEM: 1; WRITER: 2; RANGE: 3; MODE: 4; BAD_VALUE: 8; INTLK: 9; PARAM: 12; ORDER: 13; PERM: 14 };

export class PB_DevCore {
  Out: boolean;
  /** 目標が on */
  Target: boolean;
  /** 0 off・1 on・2 途中・3 位置不明 */
  State: number;
  Travel: number;
  Remain: number;
  Fault: boolean;
  STS: number;
  MODE: number;
  ALM: number;
  DIAG: number;
  AckSeq: number;
  Result: number;
  call(inp: DevCoreInputs, cfg: DevCoreCfg): void;
}

/** PB_Pid の設定と保持する値（仕様書 6 章） */
export interface PidCfg {
  /** 0 逆動作・1 正動作 */
  Action: number;
  /** 0 基本形 PID・1 I-PD・2 PI-D */
  Alg: number;
  EuLo: number;
  EuHi: number;
  PB: number;
  TI: number;
  TD: number;
  MvLo: number;
  MvHi: number;
  TrkEndMan: boolean;
  SP: number;
  MV: number;
  /** 0 MAN・1 AUT・2 CAS */
  Mode: number;
}

export interface PidInputs {
  /** 外部リセット（オーバーライド用。15 章） */
  ErfOn?: boolean;
  ErfVal?: number;
  PV: number;
  PvBad?: boolean;
  CasIn?: number;
  CasGood?: boolean;
  TrkOn?: boolean;
  TrkVal?: number;
  dt: number;
  Init?: boolean;
  ReqSeq?: number;
  ReqItem?: number;
  ReqValue?: number;
  ReqWriter?: number;
}

export function pidDefaultCfg(): PidCfg;

/** 結果の番号（PB_Pid で使うもの） */
export declare const RP: { OK: 0; NO_ITEM: 1; WRITER: 2; RANGE: 3; MODE: 4; MVLIM: 5; NO_CAS: 6; PV_BAD: 7; BAD_VALUE: 8; PARAM: 12; ORDER: 13 };

export class PB_Pid {
  MV: number;
  SP: number;
  BkCas: boolean;
  BkSp: number;
  STS: number;
  MODE: number;
  ALM: number;
  DIAG: number;
  AckSeq: number;
  Result: number;
  call(inp: PidInputs, cfg: PidCfg): void;
}

/** PB_Intlk の設定（仕様書 6 章） */
export interface IntlkCfg {
  /** 0 手動・1 自動 */
  ResetMode: 0 | 1;
  /** 1 運転員・2 エンジニア */
  ResetBy: 1 | 2;
  FoEn: boolean;
  /** 原因 1〜8 の ON 遅延（s） */
  Delay: number[];
  /** バイパスできる原因（bit0〜7）。0 ならバイパスなし */
  BypAllow?: number;
  /** バイパスの最長時間（s、60〜86400） */
  BypMaxT?: number;
}

export interface IntlkInputs {
  In1?: boolean; In2?: boolean; In3?: boolean; In4?: boolean;
  In5?: boolean; In6?: boolean; In7?: boolean; In8?: boolean;
  /** 今の時刻（秒、UDINT） */
  Now?: number;
  dt: number;
  Init?: boolean;
  ReqSeq?: number;
  ReqItem?: number;
  ReqValue?: number;
  ReqWriter?: number;
}

export function intlkDefaultCfg(): IntlkCfg;

/** 結果の番号（PB_Intlk で使うもの） */
export declare const RI: { OK: 0; NO_ITEM: 1; WRITER: 2; RANGE: 3; BAD_VALUE: 8; INTLK: 9; NOT_ACTIVE: 10; NOT_CLEAR: 11; PARAM: 12; ORDER: 13 };

export class PB_Intlk {
  Trip: boolean;
  ResetReady: boolean;
  /** bit0〜7 ＝ 原因 1〜8 */
  Cause: number;
  Raw: number;
  Mem: number;
  First: number;
  FirstNo: number;
  FirstTime: number;
  /** バイパス中の原因 */
  Byp: number;
  BypOn: boolean;
  /** 一番短いバイパスの残り時間（s） */
  BypLeft: number;
  STS: number;
  MODE: number;
  ALM: number;
  DIAG: number;
  AckSeq: number;
  Result: number;
  call(inp: IntlkInputs, cfg: IntlkCfg): void;
}

/** PB_ReqDispatch の設定（仕様書 6 章） */
export interface ReqDispatchCfg {
  NumPorts: number;
  TimeOut: number;
}

/** 宛先のブロックの要求の口（PB_ReqPort） */
export interface ReqPort {
  Seq: number;
  Item: number;
  Value: number;
  Writer: number;
  AckSeq: number;
  Result: number;
}

export interface ReqDispatchInputs {
  BoxSeq?: number;
  BoxTag?: number;
  BoxItem?: number;
  BoxValue?: number;
  BoxWriter?: number;
  dt: number;
  Init?: boolean;
}

export const NUM_PORTS: 64;
export function reqDispatchDefaultCfg(): ReqDispatchCfg;
/** 口の配列。Ports[1] は ports[0] */
export function newPorts(): ReqPort[];
/** 結果の番号（PB_ReqDispatch が出すもの） */
export declare const RR: { NO_TARGET: 15; NO_REPLY: 16 };

export class PB_ReqDispatch {
  BoxAck: number;
  BoxResult: number;
  Busy: boolean;
  Alive: number;
  STS: number;
  MODE: number;
  ALM: number;
  DIAG: number;
  call(inp: ReqDispatchInputs, cfg: ReqDispatchCfg, ports: ReqPort[]): void;
}

/** REAL（32 ビット）への丸め */
/** PB_AnaOut の設定と保持する値（仕様書 7 章） */
export interface AnaOutCfg {
  /** 0 信号が増えると開く・1 閉じる */
  Act: 0 | 1;
  RawLo: number;
  RawHi: number;
  SafePct: number;
  PosUse: boolean;
  PosRawLo: number;
  PosRawHi: number;
  DevLim: number;
  DevHys: number;
  DevT: number;
  ManPct: number;
  /** 0 MAN・1 AUT */
  Mode: 0 | 1;
}

export interface AnaOutInputs {
  /** 調節計の MV（%） */
  In: number;
  Safe?: boolean;
  ChFault?: boolean;
  PosIn?: number;
  PosFault?: boolean;
  dt: number;
  Init?: boolean;
  ReqSeq?: number;
  ReqItem?: number;
  ReqValue?: number;
  ReqWriter?: number;
}

export function anaOutDefaultCfg(): AnaOutCfg;

export declare const RO: { OK: 0; NO_ITEM: 1; WRITER: 2; RANGE: 3; MODE: 4; BAD_VALUE: 8; PARAM: 12; ORDER: 13 };

export class PB_AnaOut {
  /** AO のカウント */
  Out: number;
  /** 弁の開度（%） */
  OutPct: number;
  mA: number;
  Pos: number;
  Dev: number;
  /** 調節計の値をそのまま使っている（調節計の TrkOn ← NOT BkOk） */
  BkOk: boolean;
  /** 今の開度（調節計の TrkVal ← BkVal） */
  BkVal: number;
  STS: number;
  MODE: number;
  ALM: number;
  DIAG: number;
  AckSeq: number;
  Result: number;
  call(inp: AnaOutInputs, cfg: AnaOutCfg): void;
}

/** PB_Split の設定（仕様書 4 章） */
export interface SplitCfg {
  InLoA: number; InHiA: number; OutLoA: number; OutHiA: number;
  InLoB: number; InHiB: number; OutLoB: number; OutHiB: number;
}

export interface SplitInputs {
  In: number;
  BkOkA: boolean;
  BkValA?: number;
  BkOkB: boolean;
  BkValB?: number;
}

export function splitDefaultCfg(): SplitCfg;

export class PB_Split {
  OutA: number;
  OutB: number;
  BkOk: boolean;
  BkVal: number;
  STS: number;
  MODE: number;
  ALM: number;
  DIAG: number;
  call(inp: SplitInputs, cfg: SplitCfg): void;
}

/** PB_Select の設定（仕様書 5 章） */
export interface SelectCfg {
  /** 0 高・1 低・2 中 */
  Sel: 0 | 1 | 2;
  /** bit0〜2 ＝ 入力 1〜3 を使う */
  Use: number;
  /** 0 自動・1〜3 固定（保持する値） */
  Fix: number;
}

export interface SelectInputs {
  In1?: number; In2?: number; In3?: number;
  Bad1?: boolean; Bad2?: boolean; Bad3?: boolean;
  BkOkIn?: boolean;
  BkValIn?: number;
  Init?: boolean;
  ReqSeq?: number;
  ReqItem?: number;
  ReqValue?: number;
  ReqWriter?: number;
}

export function selectDefaultCfg(): SelectCfg;

export class PB_Select {
  Out: number;
  Bad: boolean;
  SelNo: number;
  Trk1: boolean;
  Trk2: boolean;
  Trk3: boolean;
  /** 全部の調節計をトラッキングにする（調節計の TrkOn へ） */
  TrkAll: boolean;
  STS: number;
  MODE: number;
  ALM: number;
  DIAG: number;
  AckSeq: number;
  Result: number;
  call(inp: SelectInputs, cfg: SelectCfg): void;
}

export function f(x: number): number;
