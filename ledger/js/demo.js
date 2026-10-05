// Realistic demo data (relative to today) so every feature can be tried without importing a real statement.
import { addDays, addMonths, rng, toISO } from './util.js';

export function demoTransactions(today = toISO(new Date())) {
  const r = rng(42);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const rnd = (a, b) => Math.round(a + r() * (b - a));
  const out = [];
  const add = (date, desc, amount, type) => { if (date <= today) out.push({ date, desc, amount, type, balance: null }); };
  const first = addMonths(today.slice(0, 8) + '01', -8);
  for (let m = 0; m < 9; m++) {
    const base = addMonths(first, m);
    const d = (day) => addDays(base, day - 1);
    add(d(1), 'NEFT-ACME TECHNOLOGIES-SALARY', 118000, 'credit');
    add(d(3), 'UPI/410000000001/Paid to Landlord Rent/rent@okaxis/Rent', 32000, 'debit');
    add(d(5), 'ACH D- ICCL-ZERODHA MF SIP-110011', 10000, 'debit');
    add(d(5), 'ACH D- BSE STAR MF SIP 7788', 3000, 'debit');
    add(d(7), 'ACH D- NETFLIX COM-88321', m >= 6 ? 799 : 649, 'debit');
    add(d(9), 'UPI/410000000009/Spotify India/spotify@hdfcbank', 119, 'debit');
    add(d(11), 'AIRTEL PREPAID RECHARGE/airtel@paytm', m >= 7 ? 449 : 399, 'debit');
    add(d(12), 'ACH D- HOTSTAR DISNEY-99221', 299, 'debit');
    add(d(14), 'AMAZON PRIME MEMBERSHIP', 299, 'debit');
    add(d(15), 'ACH D- HDFC BANK HOME LOAN EMI', 24500, 'debit');
    add(d(18), 'BESCOM ELECTRICITY BILL BBPS', rnd(1100, 2600), 'debit');
    add(d(20), 'ACT FIBERNET BROADBAND', 1050, 'debit');
    add(d(22), 'APARTMENT MAINTENANCE SOCIETY', 2500, 'debit');
    add(d(25), 'ATM WDL MG ROAD BLR', pick([2000, 3000, 5000]), 'debit');
    for (let i = 0; i < rnd(10, 16); i++) add(d(rnd(1, 28)), `UPI/4100${rnd(10000000, 99999999)}/${pick(['SWIGGY', 'ZOMATO'])}/${pick(['swiggy', 'zomato'])}@ybl`, rnd(140, 780), 'debit');
    for (let i = 0; i < rnd(4, 7); i++) add(d(rnd(1, 28)), `UPI/4100${rnd(10000000, 99999999)}/${pick(['BigBasket', 'Blinkit', 'DMart', 'Zepto'])}/pay@okicici`, rnd(250, 2200), 'debit');
    for (let i = 0; i < rnd(5, 9); i++) add(d(rnd(1, 28)), `UPI/4100${rnd(10000000, 99999999)}/${pick(['UBER', 'OLA', 'RAPIDO'])} RIDE/uber@axl`, rnd(90, 520), 'debit');
    for (let i = 0; i < rnd(1, 3); i++) add(d(rnd(1, 28)), `POS 4567XXXXXXXX1234 ${pick(['AMAZON PAY INDIA', 'FLIPKART INTERNET', 'MYNTRA DESIGNS'])}`, rnd(399, 4200), 'debit');
    if (r() < 0.6) add(d(rnd(1, 28)), 'APOLLO PHARMACY HSR', rnd(150, 1800), 'debit');
    if (r() < 0.5) add(d(rnd(1, 28)), 'BOOKMYSHOW PVR CINEMAS', rnd(400, 1200), 'debit');
    if (r() < 0.4) add(d(rnd(1, 28)), 'UPI/410000000777/RAMESH KUMAR/ramesh@oksbi/Dinner split', rnd(300, 1500), 'debit');
    if (m % 3 === 2) add(d(28), 'CREDIT INTEREST CAPITALISED SB INT PD', rnd(1200, 1800), 'credit');
    if (m === 2 || m === 8) add(d(10), 'LIC OF INDIA PREMIUM', 24000, 'debit');
    if (m === 4) add(d(16), 'STAR HEALTH INSURANCE PREMIUM', 18500, 'debit');
    if (m === 5) add(d(9), 'CASHBACK CREDIT AMAZON PAY', 150, 'credit');
  }
  return out;
}
