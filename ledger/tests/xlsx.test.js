import test from 'node:test';
import assert from 'node:assert/strict';
import { buildXlsx, readXlsx } from '../js/xlsx.js';
import fs from 'node:fs';

test('xlsx writer → reader round trip (unicode, numbers, escaping)', async () => {
  const blob = buildXlsx([{ name: 'Data', rows: [['Date', 'Narration', 'Amount'], ['2026-03-01', 'Café & <Chai> ₹', 450.5], ['2026-03-02', 'Salary', 100000]], money: [2] }, { name: 'Other', rows: [['x']] }]);
  const rows = await readXlsx(await blob.arrayBuffer());
  assert.deepEqual(rows[0], ['Date', 'Narration', 'Amount']);
  assert.deepEqual(rows[1], ['2026-03-01', 'Café & <Chai> ₹', '450.5']);
  assert.equal(rows[2][2], '100000');
});

test('reads a workbook written by another tool (shared strings, deflate)', async (t) => {
  const f = '/tmp/pj/other.xlsx';
  if (!fs.existsSync(f)) return t.skip('no openpyxl fixture');
  const rows = await readXlsx(fs.readFileSync(f));
  assert.equal(rows[0][1], 'Narration');
  assert.equal(rows[1][1], 'UPI-SWIGGY');
});
