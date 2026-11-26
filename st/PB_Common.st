(*
 * PICOT Blocks 共通の関数
 * 要件：C-1（標準の書き方だけ）、C-8（NaN・無限大を起こさない）
 *)

(* 有限の数か（NaN・無限大でない）。
 * 比較だけで判定する。NaN はどの比較も FALSE、無限大は REAL の最大値を超える。
 * 算術（x - x など）を使わないのは、NaN の演算でエラーを出す PLC があるため（C-8）。
 * REAL の最大値（約 3.4028235E38）との間の値は有限でも FALSE になるが、計装の値では起きない。 *)
FUNCTION PB_IsFinite : BOOL
VAR_INPUT
  x : REAL;
END_VAR
PB_IsFinite := (x >= -3.402823E38) AND (x <= 3.402823E38);
END_FUNCTION
