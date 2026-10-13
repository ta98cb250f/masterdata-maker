import { it } from 'vitest';
import { parseDocument, LineCounter, Parser, Composer } from 'yaml';
import { parseYaml } from './yaml-parse';
import { parseTableFile } from './parse';

it('bench', () => {
  const cols = 48;
  let y = 'table: big\nfields:\n';
  for (let c = 0; c < cols; c++) y += `  - name: c${c}\n    type: ${c % 3 === 0 ? 'string' : c % 3 === 1 ? 'int' : 'float'}\n`;
  y += 'records:\n';
  for (let r = 0; r < 10000; r++) {
    y += `  - id: ${r + 1}\n    version: "1.0.${r}"\n`;
    for (let c = 0; c < cols; c++) y += `    c${c}: ${c % 3 === 0 ? `name_${r}_${c}` : c % 3 === 1 ? r * c : (r * c) / 7}\n`;
  }
  let t = performance.now();
  const lc = new LineCounter();
  parseDocument(y, { intAsBigInt: true, lineCounter: lc, prettyErrors: false });
  console.log('parseDocument', Math.round(performance.now() - t));
  t = performance.now();
  parseDocument(y, { intAsBigInt: true, prettyErrors: false, uniqueKeys: false });
  console.log('parseDocument nouniq', Math.round(performance.now() - t));
  t = performance.now();
  let n = 0; for (const tok of new Parser().parse(y)) n++;
  console.log('cst', Math.round(performance.now() - t));
  t = performance.now();
  parseYaml(y);
  console.log('parseYaml', Math.round(performance.now() - t));
  t = performance.now();
  parseTableFile('tables/big.yaml', y);
  console.log('table', Math.round(performance.now() - t));
}, 120000);
