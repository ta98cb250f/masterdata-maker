import { describe, expect, it } from 'vitest';
import { extendSeries, extendSeriesBackward, seriesFill } from './fill';
import type { FillValue } from './fill';

const num = (v: number): FillValue => ({ kind: 'number', v });
const big = (v: bigint): FillValue => ({ kind: 'bigint', v });
const str = (v: string): FillValue => ({ kind: 'string', v });
const dt = (iso: string): FillValue => ({ kind: 'datetime', ms: Date.parse(iso) });
const EMPTY: FillValue = { kind: 'empty' };

const nums = (vs: FillValue[]) => vs.map((v) => (v.kind === 'number' ? v.v : NaN));
const strs = (vs: FillValue[]) => vs.map((v) => (v.kind === 'string' ? v.v : '?'));

describe('受け入れ基準 4: 1, 2 を選んで下へ 3 セル分フィルする', () => {
  it('3, 4, 5 が入る', () => {
    expect(extendSeries([num(1), num(2)], 3)).toEqual([num(3), num(4), num(5)]);
  });
});

describe('数値', () => {
  it('等差で続ける（FR-FIL-02 の例）', () => {
    expect(nums(extendSeries([num(1), num(2)], 2))).toEqual([3, 4]);
    expect(nums(extendSeries([num(10), num(20)], 1))).toEqual([30]);
    expect(nums(extendSeries([num(5), num(3), num(1)], 3))).toEqual([-1, -3, -5]);
  });

  it('1 つなら複製する', () => {
    expect(nums(extendSeries([num(7)], 3))).toEqual([7, 7, 7]);
  });

  it('浮動小数の誤差を残さない', () => {
    expect(nums(extendSeries([num(0.1), num(0.2)], 3))).toEqual([0.3, 0.4, 0.5]);
    expect(nums(extendSeries([num(0.1), num(0.2), num(0.3)], 2))).toEqual([0.4, 0.5]);
    expect(nums(extendSeries([num(1.1), num(1.2)], 1))).toEqual([1.3]);
    expect(nums(extendSeries([num(1e-7), num(2e-7)], 1))).toEqual([3e-7]);
  });

  it('等差でなければ最小二乗法の直線で延長する（P-41。Googleスプレッドシートの値とは未検証）', () => {
    // x = 0, 1, 2 / y = 1, 2, 4 → 傾き 1.5、切片 5/6
    const r = nums(extendSeries([num(1), num(2), num(4)], 2));
    expect(r[0]).toBeCloseTo(5.333333333333, 10);
    expect(r[1]).toBeCloseTo(6.833333333333, 10);
    expect(nums(extendSeries([num(1), num(3), num(4), num(8)], 1))[0]).toBeCloseTo(9.5, 10);
  });

  it('上へのフィルは逆向きに続ける', () => {
    expect(nums(extendSeriesBackward([num(1), num(2)], 3))).toEqual([-2, -1, 0]);
    expect(nums(extendSeriesBackward([num(10), num(20), num(30)], 1))).toEqual([0]);
  });
});

describe('bigint', () => {
  it('1 つなら複製、等差なら正確に続ける', () => {
    expect(extendSeries([big(9007199254740993n)], 2)).toEqual([big(9007199254740993n), big(9007199254740993n)]);
    expect(extendSeries([big(9007199254740993n), big(9007199254740995n)], 2)).toEqual([
      big(9007199254740997n),
      big(9007199254740999n),
    ]);
  });

  it('等差でなければ並びを繰り返す', () => {
    expect(extendSeries([big(1n), big(2n), big(4n)], 4)).toEqual([big(1n), big(2n), big(4n), big(1n)]);
  });
});

describe('日時', () => {
  it('1 つなら複製', () => {
    expect(extendSeries([dt('2026-10-13T00:00:00Z')], 2)).toEqual([dt('2026-10-13T00:00:00Z'), dt('2026-10-13T00:00:00Z')]);
  });

  it('間隔が一定なら続ける', () => {
    expect(extendSeries([dt('2026-10-13T00:00:00Z'), dt('2026-10-14T00:00:00Z')], 2)).toEqual([
      dt('2026-10-15T00:00:00Z'),
      dt('2026-10-16T00:00:00Z'),
    ]);
    expect(extendSeriesBackward([dt('2026-10-13T12:00:00Z'), dt('2026-10-13T13:00:00Z')], 1)).toEqual([dt('2026-10-13T11:00:00Z')]);
  });

  it('一定でなければ直線で延長し、秒に丸める', () => {
    const r = extendSeries([dt('2026-10-13T00:00:00Z'), dt('2026-10-13T00:00:01Z'), dt('2026-10-13T00:00:03Z')], 1);
    // 0, 1, 3 秒 → 傾き 1.5 秒、切片 -1/6 秒。x = 3 で 4.333… 秒 → 4 秒
    expect(r).toEqual([dt('2026-10-13T00:00:04Z')]);
  });
});

describe('末尾が数字の文字列（FR-FIL-03）', () => {
  it('1 つだけなら 1 ずつ進め、ゼロ埋めの桁数を保つ', () => {
    expect(strs(extendSeries([str('stage_01')], 3))).toEqual(['stage_02', 'stage_03', 'stage_04']);
    expect(strs(extendSeries([str('stage_09')], 2))).toEqual(['stage_10', 'stage_11']);
  });

  it('桁が増えるときは切り詰めない', () => {
    expect(strs(extendSeries([str('a98'), str('a99')], 2))).toEqual(['a100', 'a101']);
    expect(strs(extendSeries([str('x_009')], 2))).toEqual(['x_010', 'x_011']);
  });

  it('等差で進める', () => {
    expect(strs(extendSeries([str('stage_01'), str('stage_03')], 2))).toEqual(['stage_05', 'stage_07']);
    expect(strs(extendSeries([str('007')], 1))).toEqual(['008']);
  });

  it('上へのフィルは減らしていく。負になるところは絶対値（Excel と同じ。Googleスプレッドシートでは未検証）', () => {
    expect(strs(extendSeriesBackward([str('stage_05')], 3))).toEqual(['stage_02', 'stage_03', 'stage_04']);
    expect(strs(extendSeriesBackward([str('stage_03'), str('stage_04')], 2))).toEqual(['stage_01', 'stage_02']);
    expect(strs(extendSeries([str('a1'), str('a0')], 2))).toEqual(['a1', 'a2']);
  });

  it('前の部分が違う、数字で終わらない文字列があるときは並びを繰り返す', () => {
    expect(strs(extendSeries([str('a1'), str('b2')], 3))).toEqual(['a1', 'b2', 'a1']);
    expect(strs(extendSeries([str('a1'), str('b')], 2))).toEqual(['a1', 'b']);
    expect(strs(extendSeries([str('火'), str('水'), str('木')], 4))).toEqual(['火', '水', '木', '火']);
  });

  it('等差でなければ並びを繰り返す', () => {
    expect(strs(extendSeries([str('a1'), str('a2'), str('a4')], 3))).toEqual(['a1', 'a2', 'a4']);
  });

  it('非常に大きな数字でも正確に進める', () => {
    expect(strs(extendSeries([str('id_99999999999999999999')], 1))).toEqual(['id_100000000000000000000']);
  });
});

describe('それ以外は並びを繰り返す', () => {
  it('種類の混在・空・その他', () => {
    expect(extendSeries([num(1), str('a')], 3)).toEqual([num(1), str('a'), num(1)]);
    expect(extendSeries([num(1), EMPTY, num(3)], 4)).toEqual([num(1), EMPTY, num(3), num(1)]);
    const o: FillValue = { kind: 'other', v: [1, 2] };
    expect(extendSeries([o], 2)).toEqual([o, o]);
  });

  it('上へ繰り返すときは並びがつながるように置く', () => {
    // 上に 2 つ置くと、上から b, c, (a, b, c)
    expect(strs(extendSeriesBackward([str('a'), str('b'), str('c')], 2))).toEqual(['b', 'c']);
  });

  it('count が 0 以下なら空、元が空なら空欄', () => {
    expect(extendSeries([num(1)], 0)).toEqual([]);
    expect(extendSeries([], 2)).toEqual([EMPTY, EMPTY]);
  });
});

describe('連番入力（FR-FIL-05）', () => {
  it('number', () => {
    expect(seriesFill(1, 1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(seriesFill(100, -10, 3)).toEqual([100, 90, 80]);
    expect(seriesFill(0, 0.1, 4)).toEqual([0, 0.1, 0.2, 0.3]);
    expect(seriesFill(1, 1, 0)).toEqual([]);
  });

  it('bigint', () => {
    expect(seriesFill(9007199254740991n, 2n, 3)).toEqual([9007199254740991n, 9007199254740993n, 9007199254740995n]);
  });
});
