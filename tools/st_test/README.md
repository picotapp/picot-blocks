# ST の単体試験（STruC++）

`test-vectors/` の JSON を STruC++ の試験ファイル（`TEST` ブロック）に変えて、`st/` の ST に流す。JS 参照実装と同じテストベクタ・同じ比べ方（`js/test/bits.js` を共有）。

```
node run.mjs            # できているブロックすべて
node run.mjs PB_AnaMon  # 1 つだけ
```

- STruC++ の場所は環境変数 `STRUCPP`（既定は PATH の `strucpp`。コマンド版 0.8.0 で確かめた）。g++ が要る
- ブロックと ST のファイルの対応は `run.mjs` の `BLOCKS`。ST ができたら足す
- テストベクタの形にしにくい試験は、このフォルダーに手で書いて `EXTRA` に足す（`test_PB_Pid_cascade.st`：調節計 2 台のカスケード。期待値は JS の `cascade.test.js` と同じ。`test_PB_ReqDispatch_wired.st`：受付箱に本物の調節計・インターロックをつなぐ。JS の `dispatch.test.js` と同じ）。試験専用の FB（`harness_dispatch.st`）など、ほかに要るソースは `EXTRA_SRC`
- ST の型で表せない値（INT の設定に小数など）は書かずに飛ばし、警告を出す（JS だけの場面。今は RD-10 の NumPorts 2.5 だけ）
- 作った試験ファイルは `out/`（リポジトリに入れない）
- 「同じ動きをした」の記録はここ。OpenPLC のランタイムに「取り込めた」の確認は別（NF-2。PICOT HMI の `tools/openplc/`）

## STruC++ 0.8.0 で分かったこと（2026-11-25）

| 場面 | 起きること | 対処 |
|---|---|---|
| `TEST` の中で FB を呼ぶ | VAR_IN_OUT の書き戻しが起きない（PROGRAM の中では起きる。「写して呼んで書き戻す」形） | 呼んだ後に `tc := fb.Cfg;` で取り戻す（`vec2st.mjs` が書く） |
| `NOT (a AND b)`（比較を AND・OR でつないだ式に NOT） | C++ のコンパイルで止まる | いったん BOOL の変数に入れてから NOT |
| 名前 | 大文字にして C++ に出る。C のマクロ（`NAN`・`INFINITY` など）とぶつかると止まる | ぶつからない名前にする（`vNaN`） |
| 大文字・小文字だけ違う名前 | ST は区別しないので同じ名前になる（例：BinMon の `Alm` と `ALM`、Pid の内部の `pvBad` と入力 `PvBad`）。STruC++ は「already defined」で止まる | 別の名前にする（BinMon は `ActAlm` に改名、仕様書 v0.3） |
| 入力の名前 `En` | IEC の EN とぶつかり、黙って動かない | 使わない（C-1〜C-8 の検査に入れる） |
| `FOR i := 1 TO 32767`（i が INT） | 最後の回のあと i が 32768 になれず -32768 に戻り、終わらない（試験が SIGTERM で止まる）。INT の範囲の決まりによるので、ほかの機種でも起こりうる | 数え上げの変数は上限より大きい型（DINT）にする |
| 試験の名前 | 二重引用符は通らない | 一重引用符 `TEST 'AM-01'` |
| `ASSERT_*` | 1 つ失敗すると、その TEST はそこで止まる | 失敗の行の `'AM-10 s3 PV'`（ケース・ステップ・項目）で場所が分かる |
