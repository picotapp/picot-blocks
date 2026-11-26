# PICOT Blocks

計装のループ（伝送器・調節計・調節弁・ポンプ・弁・インターロック）を PLC で組むための、機器の種類ごとのファンクションブロック集です。IEC 61131-3 の ST で書いています。DCS の機能ブロックと同じ感覚で、PLC のメーカーに縛られずに使えることを目指しています。

*Function blocks for instrumentation loops on PLCs (IEC 61131-3 Structured Text): analog/digital monitoring, PID, control valve output, split range, selector/override, motor/valve core, interlock, and a request dispatcher for HMI writes. Each block comes with a specification, hand-derived test vectors, and a JavaScript reference implementation. Documentation is in Japanese.*

> **ご利用にあたって**
> - 参考実装です。**動作は保証しません**。実機に使う前に、利用者の責任で検証してください。
> - **安全計装システム（SIS）など、安全に関わる用途には使用できません。** IEC 61508・IEC 61511 の認証は受けていません。
> - ライセンスは MIT です（[LICENSE](LICENSE)）。

## ブロック

| ブロック | 内容 |
|---|---|
| `PB_AnaMon` | 伝送器：4〜20 mA → 工学値、計器故障、フィルタ、HH/H/L/LL 警報、品質、警報の抑制、代替値 |
| `PB_BinMon` | 接点：反転、ON/OFF 遅延、入力異常、警報の抑制、代替値 |
| `PB_DevCore` | 機器の核（ポンプ・ON/OFF 弁）：指令、アンサーバックの監視、インターロック、パーミッシブ |
| `PB_Pid` | 調節計：速度形 PID、MAN/AUT/CAS、トラッキング、カスケード、外部リセット（オーバーライド用） |
| `PB_AnaOut` | 調節弁の出力：開度 → AO、弁の向き、安全側、MAN、開度の偏差、調節計への戻り信号 |
| `PB_Split` | スプリットレンジ：1 つの MV を 2 つの弁に |
| `PB_Select` | セレクタ：高・低・中の選択、オーバーライド |
| `PB_Intlk` | インターロック：原因 8 点、ラッチ、ファーストアウト、手動・自動リセット、バイパス |
| `PB_ReqDispatch` | 受付箱：HMI からの書き込みを 1 か所で受けて各ブロックに振り分ける |

機能の説明は PICOT のページ（https://picotapp.com/picot-blocks ）にもあります。

## フォルダ

| フォルダ | 中身 |
|---|---|
| `st/` | ST のソース。`PB_Common.st`（共通の関数）とブロックごとの `.st` |
| `spec/blocks/` | ブロックごとの仕様書。テストベクタはここから手で起こしています |
| `spec/common/` | 全ブロックに共通の決まり（状態ワード・要求の口・Modbus の並び） |
| `test-vectors/` | テストベクタ（入力と、期待する出力のスキャンごとの並び）。形式は中の README |
| `js/` | JavaScript の参照実装と、テストベクタを流す試験 |
| `tools/st_check/` | ST の書き方の決まり（C-1〜C-8：多くの機種で通る書き方に限る）の検査 |
| `tools/st_test/` | テストベクタを STruC++ の単体試験に変えて ST に流す道具 |

## 使い方

1. `st/PB_Common.st` と、使うブロックの `.st` を PLC のプロジェクトに入れます。設定（`*_Cfg`）は保持領域に置き、`VAR_IN_OUT` で渡します。
2. 呼び方・入出力・設定は、各ブロックの仕様書（`spec/blocks/`）にあります。
3. 毎スキャン、前回からの時間 `dt`（秒）と、電源投入の最初のスキャンだけ TRUE の `Init` を渡します。

## 確かめ方

```sh
# JavaScript の参照実装にテストベクタを流す（Node.js 20 以上）
cd js && npm test

# ST の書き方の検査
node tools/st_check/check.mjs

# ST にテストベクタを流す（STruC++ 0.8.0 と g++ が要る。STRUCPP に strucpp の場所を入れる）
STRUCPP=/path/to/strucpp node tools/st_test/run.mjs
```

テストベクタの期待値は仕様書から手で起こしたもので、実装の出力から作ったものではありません。自分の PLC に移したときも、同じテストベクタで同じ結果になるかを確かめられます。

## 版

[CHANGELOG.md](CHANGELOG.md) を見てください。0.x のあいだは、入出力や Modbus の並びが変わることがあります。

## 不具合の報告

GitHub の Issue で受けています。今はプルリクエスト（コードの変更の提案）は受けていません。

## 商標

Modbus、OpenPLC、Node-RED、CODESYS、STruC++、三菱電機（GX Works）、Siemens、Rockwell Automation、ABB、横河電機（CENTUM）、NAMUR、Apple、Microsoft Excel などは、それぞれの権利者の商標または登録商標です。このソフトウェアは各社の製品と関係がなく、各社が認めたものでもありません。仕様書の中の各社の製品への言及は、公開されているマニュアルを読んで確かめたもので、出典（文書番号・章）を書いています。
