/**
 * REAL（IEC 61131-3 の 32 ビット浮動小数点）の再現（NF-3）。
 * JS の number は 64 ビットなので、計算のたびに Math.fround で 32 ビットに丸める。
 * ST と同じ順番で計算し、途中の値もすべて丸める。
 */
export const f = Math.fround;

/** a + b（REAL） */
export const add = (a, b) => f(f(a) + f(b));
/** a − b（REAL） */
export const sub = (a, b) => f(f(a) - f(b));
/** a × b（REAL） */
export const mul = (a, b) => f(f(a) * f(b));
/** a ÷ b（REAL）。b が 0 になる呼び出しはしない（C-8）。呼ぶ側で確かめる */
export const div = (a, b) => f(f(a) / f(b));

/** 有限の数か（NaN・無限大でない） */
export const finite = (x) => typeof x === "number" && Number.isFinite(x);
