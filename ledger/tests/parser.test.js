import test from 'node:test';
import assert from 'node:assert/strict';
import { matchDate, groupLines, parseStatementPages, parseCSVStatement } from '../js/parser.js';

// Helper: build pdf.js-like items. cell = [x, text] ; width approximated at 5 per char; right-aligned if r=true.
function page(rows) {
  const items = [];
  let y = 800;
  for (const cells of rows) {
    for (const [x, str, right] of cells) {
      const w = str.length * 5;
      items.push({ str, x: right ? x - w : x, y, w });
    }
    y -= 12;
  }
  return groupLines(items);
}

const HDFC_HEAD = [[20, 'Date'], [90, 'Narration'], [260, 'Chq./Ref.No.'], [330, 'Value Dt'], [430, 'Withdrawal Amt.', true], [500, 'Deposit Amt.', true], [570, 'Closing Balance', true]];
const hdfcRow = (d, n, ref, wd, dp, bal) => [[20, d], [90, n], [260, ref], [330, d], ...(wd ? [[430, wd, true]] : []), ...(dp ? [[500, dp, true]] : []), [570, bal, true]];

test('matchDate handles Indian formats', () => {
  assert.equal(matchDate('05/03/26 UPI').iso, '2026-03-05');
  assert.equal(matchDate('5-Mar-2026').iso, '2026-03-05');
  assert.equal(matchDate('05 Mar 2026 foo').iso, '2026-03-05');
  assert.equal(matchDate('2026-03-05').iso, '2026-03-05');
  assert.equal(matchDate('31 Sept 2025'), null);
  assert.equal(matchDate('30 Sept 2025').iso, '2025-09-30');
  assert.equal(matchDate('Statement of account'), null);
  assert.equal(matchDate('99/99/2026'), null);
});

test('two-column layout (withdrawal / deposit / balance)', () => {
  const p = page([
    [[20, 'HDFC BANK LIMITED'], [300, 'Account No : 50100123456789']],
    HDFC_HEAD,
    hdfcRow('01/03/26', 'UPI-SWIGGY-swiggy@ybl', '0001', '450.00', null, '99,550.00'),
    hdfcRow('02/03/26', 'NEFT-ACME CORP-SALARY', '0002', null, '1,00,000.00', '1,99,550.00'),
    [[90, 'MARCH 2026']],
    hdfcRow('03/03/26', 'ATM WDL MG ROAD', '0003', '10,000.00', null, '1,89,550.00'),
    [[20, 'Page 1 of 2']],
  ]);
  const r = parseStatementPages([p]);
  assert.equal(r.meta.bank, 'HDFC Bank');
  assert.equal(r.meta.accountTail, '6789');
  assert.equal(r.rows.length, 3);
  assert.deepEqual(r.rows.map((x) => [x.type, x.amount]), [['debit', 450], ['credit', 100000], ['debit', 10000]]);
  assert.match(r.rows[2].desc, /ATM WDL MG ROAD MARCH 2026|ATM WDL MG ROAD/);
  assert.equal(r.stats.reconciled, r.stats.checked);
});

test('single amount column with Dr/Cr suffix and wrapped narration', () => {
  const p = page([
    [[20, 'Date'], [90, 'Particulars'], [420, 'Amount', true], [500, 'Balance', true]],
    [[20, '01 Mar 2026'], [90, 'UPI/412345678901/Zomato'], [420, '1,200.00 Dr', true], [520, '45,000.00 Cr', true]],
    [[90, 'zomato@icici/Payment']],
    [[20, '02 Mar 2026'], [90, 'ACH C- INTEREST PD'], [420, '300.00 Cr', true], [520, '45,300.00 Cr', true]],
  ]);
  const r = parseStatementPages([p]);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].type, 'debit');
  assert.match(r.rows[0].desc, /zomato@icici/);
  assert.equal(r.rows[1].type, 'credit');
  assert.equal(r.rows[1].balance, 45300);
});

test('no columns at all: type comes from the balance chain, newest-first order handled', () => {
  const p = page([
    [[20, '03/03/2026'], [90, 'Shop A'], [400, '500.00', true], [480, '8,500.00', true]],
    [[20, '02/03/2026'], [90, 'REFUND from Shop B'], [400, '1,000.00', true], [480, '9,000.00', true]],
    [[20, '01/03/2026'], [90, 'Shop C'], [400, '2,000.00', true], [480, '8,000.00', true]],
    [[20, 'Opening Balance'], [480, '10,000.00', true]],
  ]);
  const r = parseStatementPages([p]);
  // chronological after reversal
  assert.deepEqual(r.rows.map((x) => x.date), ['2026-03-01', '2026-03-02', '2026-03-03']);
  assert.deepEqual(r.rows.map((x) => x.type), ['debit', 'credit', 'debit']);
  assert.equal(r.rows[0].typeSource, 'balance');
});

test('page breaks do not glue footer text into narrations; header repeats ok', () => {
  const p1 = page([HDFC_HEAD, hdfcRow('01/03/26', 'UPI-A', '1', '100.00', null, '900.00'), [[20, 'Page 1 of 2']], [[20, 'Registered Office: Mumbai']]]);
  const p2 = page([HDFC_HEAD, hdfcRow('02/03/26', 'UPI-B', '2', null, '50.00', '950.00')]);
  const r = parseStatementPages([p1, p2]);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].desc.includes('Registered'), false);
});

test('CSV with separate debit/credit columns and quoted narration', () => {
  const csv = 'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\n' +
    '01/03/26,"UPI-SWIGGY, BLR",001,01/03/26,450.00,,"99,550.00"\n' +
    '02/03/26,SALARY ACME,002,02/03/26,,"1,00,000.00","1,99,550.00"\n';
  const r = parseCSVStatement(csv);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].desc, 'UPI-SWIGGY, BLR');
  assert.deepEqual(r.rows.map((x) => x.type), ['debit', 'credit']);
  assert.equal(r.rows[1].balance, 199550);
});

test('CSV with signed amount column', () => {
  const r = parseCSVStatement('Transaction Date;Description;Amount\n2026-03-01;Coffee;-150.50\n2026-03-02;Salary;50000\n');
  assert.deepEqual(r.rows.map((x) => [x.type, x.amount]), [['debit', 150.5], ['credit', 50000]]);
});

test('vertically-centred cells with two-line narration (date/amount sit between narration lines)', () => {
  const items = [];
  const put = (x, y, str, right) => { const w = str.length * 5; items.push({ str, x: right ? x - w : x, y, w }); };
  [[20, 'Date'], [90, 'Narration'], [260, 'Chq./Ref.No.'], [330, 'Value Dt'], [430, 'Withdrawal Amt.', 1], [500, 'Deposit Amt.', 1], [570, 'Closing Balance', 1]].forEach(([x, s, r]) => put(x, 800, s, r));
  const data = [
    ['01/09/26', 'NEFT CR-HDFC0001-', 'ACME TECHNOLOGIES-SALARY', 'N245678901', null, '1,00,000.00', '1,50,000.00'],
    ['03/09/26', 'ACH D- NETFLIX', 'COM-88321', 'ACH88321', '799.00', null, '1,49,201.00'],
    ['05/09/26', 'UPI-LANDLORD RENT-', 'rent@okaxis PAID FOR SEPTEMBER', '0000410000000001', '32,000.00', null, '1,17,201.00'],
  ];
  let y = 770;
  for (const [d, n1, n2, ref, wd, dp, bal] of data) {
    put(90, y + 6, n1); put(90, y - 6, n2);
    put(20, y, d); put(260, y, ref); put(330, y, d);
    if (wd) put(430, y, wd, 1); if (dp) put(500, y, dp, 1); put(570, y, bal, 1);
    y -= 30;
  }
  const r = parseStatementPages([groupLines(items)]);
  assert.equal(r.rows.length, 3);
  assert.equal(r.rows[0].desc, 'NEFT CR-HDFC0001- ACME TECHNOLOGIES-SALARY');
  assert.equal(r.rows[1].desc, 'ACH D- NETFLIX COM-88321');
  assert.deepEqual(r.rows.map((x) => x.type), ['credit', 'debit', 'debit']);
  assert.equal(r.stats.reconciled, r.stats.checked);
  assert.equal(r.rows[2].desc.includes('0000410000000001'), false);
});

import { parseTable, detectColumns } from '../js/parser.js';

test('table (xlsx-like) with Excel date serials, mapping override and reconciliation', () => {
  const table = [['Statement for A/C 123'], ['Txn Date', 'Description', 'Withdrawal', 'Deposit', 'Balance'], ['46082', 'UPI-SWIGGY', '450.00', '', '9550.00'], ['46083', 'SALARY', '', '50000', '59550.00']];
  const r = parseTable(table);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].date, '2026-03-01');
  assert.equal(r.stats.reconciled, r.stats.checked);
  assert.equal(r.stats.checked, 1);
  // headerless table needs the manual mapper
  const raw = [['01/03/2026', 'Coffee', '-150'], ['02/03/2026', 'Pay', '5000']];
  const none = parseTable(raw);
  assert.equal(none.needsMapping, true);
  const mapped = parseTable(raw, { hi: -1, idx: { date: 0, desc: 1, amt: 2 } });
  assert.deepEqual(mapped.rows.map((x) => [x.type, x.amount]), [['debit', 150], ['credit', 5000]]);
  assert.ok(detectColumns(table).signature.includes('txn date'));
});
