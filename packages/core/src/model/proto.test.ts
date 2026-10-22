import { describe, expect, it } from 'vitest';
import type { FieldDef } from './field';
import { legacyProto, protoAfterColumnChange, resolveProto } from './proto';

const cols = (...defs: [string, FieldDef['type'], boolean?][]): FieldDef[] =>
  defs.map(([name, type, exported]) => (exported === false ? { name, type, export: false } : { name, type }));

describe('フィールド番号（P-63）', () => {
  it('proto が無ければ以前の規則: 出力する列の順に 1 から、続けて出力しない列', () => {
    expect(legacyProto(cols(['id', 'int'], ['memo', 'string', false], ['hp', 'int']))).toEqual({
      fields: [
        ['id', 1],
        ['memo', 3],
        ['hp', 2],
      ],
      reserved: [],
    });
  });

  it('番号の無い列は、reserved を含めた最大 + 1。19000〜19999 は飛ばす', () => {
    const stored = { fields: [['id', 1] as [string, number]], reserved: [{ number: 18_999 }] };
    expect(resolveProto(stored, cols(['id', 'int'], ['a', 'int'], ['b', 'int'])).fields).toEqual([
      ['id', 1],
      ['a', 20_000],
      ['b', 20_001],
    ]);
  });

  it('列名の変更は番号を引き継ぎ、proto の型が変わったら古い番号を reserved にする', () => {
    const before = cols(['id', 'int'], ['a', 'int'], ['b', 'string']);
    const renamed = protoAfterColumnChange(undefined, before, cols(['id', 'int'], ['c', 'int'], ['b', 'string']), { from: 'a', to: 'c' });
    expect(renamed.fields).toEqual([
      ['id', 1],
      ['c', 2],
      ['b', 3],
    ]);
    // string → list<string> は optional から repeated に変わる
    const changed = protoAfterColumnChange(renamed, cols(['id', 'int'], ['c', 'int'], ['b', 'string']), cols(['id', 'int'], ['c', 'int'], ['b', 'list<string>']));
    expect(changed).toEqual({
      fields: [
        ['id', 1],
        ['c', 2],
        ['b', 4],
      ],
      reserved: [{ number: 3 }],
    });
  });

  it('消えた列の名前は、proto の識別子でないときと既に reserved にあるときは番号だけ reserved にする', () => {
    const stored = { fields: [['id', 1], ['my-memo', 2], ['gone', 3]] as [string, number][], reserved: [{ number: 9, name: 'gone' }] };
    expect(resolveProto(stored, cols(['id', 'int'])).reserved).toEqual([{ number: 2 }, { number: 3 }, { number: 9, name: 'gone' }]);
  });
});

