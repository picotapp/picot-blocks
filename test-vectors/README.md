# テストベクタの形式

ブロックごとに 1 つの JSON（例：`PB_AnaMon_基本版.json`）。**期待値は仕様書から手で起こす**（NF-4）。JS・ST の出力を期待値にしない。

## 全体

| キー | 内容 |
|---|---|
| `block` / `spec` | ブロック名と、元にした仕様書の版 |
| `tolerance` | 数値の許容誤差（`abs` 絶対誤差。REAL の丸めを考える：NF-3） |
| `configs` | 名前を付けた設定（`Cfg` 構造体の値）。ケースは `config` で選び、`cfg` で一部を上書きする |
| `cases` | 試験のケース |

## ケース

| キー | 内容 |
|---|---|
| `id` / `title` / `req` | 番号、内容、元の要件・仕様の項目 |
| `note` | 期待値の計算メモ（あれば） |
| `config` / `cfg` | 使う設定と、その上書き |
| `steps` | 1 要素 = 1 スキャン。上から順に実行する |

## ステップ

- `in`：入力。**前のステップの値を引き継ぐ**（書いたものだけ変わる）。ただし `Init` は書いたステップだけ TRUE。
  - `In`、`ChFault`、`dt`、`Init`、`ReqSeq`・`ReqItem`・`ReqValue`・`ReqWriter`
  - Intlk：`In1`〜`In8`、`Now`
  - 数値で表せない値は文字列 `"NaN"`・`"Inf"` で書く
- 設定の配列（Intlk の `Delay`）は要素ごとに `"NaN"` などを書ける。`cfgSet` では配列ごと置き換える
- `repeat`：同じ入力でこの数だけスキャンを続けて呼び、最後のスキャンの後だけ `expect` を確かめる（時間切れの試験など）
- `cfgSet`：このスキャンの前に、要求の口を通さずに設定を直接書き換える（Modbus で直接書かれた場合などを模す）
- `expect`：このスキャンの後に確かめる出力。**書いたものだけ確かめる**
  - FB の出力の名前そのまま（AnaMon：`PV`・`mA`・`Bad`…、BinMon：`Active`・`InAct`・`ActAlm`・`Fail`・`Bad`…）、`AckSeq`、`Result`
  - `q`：品質（0 Good・1 Uncertain・2 Bad・3 停止中）、`cause`：原因（0 プロセス・1 計器）
  - `oos`・`sim`・`manip`・`cfgErr`・`dtClamp`：STS の各ビット
  - `alm`：出ている警報の一覧。**一覧にないものは出ていないこと**。AnaMon：`HH`・`H`・`L`・`LL`・`Fail`、BinMon：`Act`（動作）・`Fail`（入力異常）、DevCore：`onFail`・`offFail`・`limFail`・`uncmdOn`・`uncmdOff`
  - `diag`：DIAG の立っているビットの一覧。一覧にないものは立っていないこと。AnaMon：`dtClamp`・`cfgErr`・`chFault`・`ne43Lo`・`ne43Hi`・`failPending`、BinMon：`dtClamp`・`cfgErr`・`chFault`・`pending`（遅延中）、DevCore：`dtClamp`・`cfgErr`・`moving`・`pcmdRej`・`statJudge`、Pid：`dtClamp`・`cfgErr`・`pvBad`・`trk`・`casShed`・`mvHi`・`mvLo`、Intlk：`dtClamp`・`cfgErr`・`pending`（遅延中の原因がある）
  - `STS`・`ALM`・`DIAG`：ワードの数値（ビットの詰め方の確認用）
  - `cfg.<名前>`：設定の値（要求の口で変わったか）
