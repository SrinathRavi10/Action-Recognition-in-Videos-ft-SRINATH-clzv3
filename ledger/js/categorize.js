// Merchant normalisation and category rules (India-centric). Everything runs locally.
import { titleCase } from './util.js';

/** group: spend | save | transfer | income  – decides how the dashboard counts a category. */
export const CATEGORIES = {
  'Food & Dining': { group: 'spend', color: '#e4572e' },
  Groceries: { group: 'spend', color: '#4f9d69' },
  Transport: { group: 'spend', color: '#3a86c8' },
  Travel: { group: 'spend', color: '#17a2b8' },
  Shopping: { group: 'spend', color: '#b565a7' },
  'Bills & Utilities': { group: 'spend', color: '#e0a526' },
  'Mobile & Internet': { group: 'spend', color: '#7c6bd6' },
  Subscriptions: { group: 'spend', color: '#d6336c' },
  'Rent & Housing': { group: 'spend', color: '#8d6e63' },
  'EMI & Loans': { group: 'spend', color: '#607d8b' },
  Insurance: { group: 'spend', color: '#2f9e9e' },
  Health: { group: 'spend', color: '#e8590c' },
  Education: { group: 'spend', color: '#5c7cfa' },
  Entertainment: { group: 'spend', color: '#f06595' },
  'Personal Care': { group: 'spend', color: '#9c88c4' },
  'Gifts & Donations': { group: 'spend', color: '#c08497' },
  'Cash Withdrawal': { group: 'spend', color: '#868e96' },
  'Fees & Charges': { group: 'spend', color: '#a0522d' },
  Tax: { group: 'spend', color: '#495057' },
  Uncategorized: { group: 'spend', color: '#adb5bd' },
  Investments: { group: 'save', color: '#2b8a3e' },
  'Credit Card Bill': { group: 'transfer', color: '#74808a' },
  Transfers: { group: 'transfer', color: '#9aa5b1' },
  Salary: { group: 'income', color: '#2b8a3e' },
  Interest: { group: 'income', color: '#37b24d' },
  Dividends: { group: 'income', color: '#51cf66' },
  'Refunds & Cashback': { group: 'income', color: '#69db7c' },
  'Investment Returns': { group: 'income', color: '#8ce99a' },
  'Other Income': { group: 'income', color: '#a9e34b' },
};

export const SPEND_CATS = Object.keys(CATEGORIES).filter((c) => CATEGORIES[c].group === 'spend');
export const ALL_CATS = Object.keys(CATEGORIES);
export const groupOf = (cat) => CATEGORIES[cat]?.group ?? 'spend';

/**
 * Colour follows the *family*, not the rank: 6 hues from the validated categorical palette + neutral for "Other".
 * Individual categories inside a family share its hue (they are told apart by name, not colour).
 */
export const FAMILIES = {
  home: { name: 'Home & bills', slot: 1, cats: ['Rent & Housing', 'Bills & Utilities', 'Mobile & Internet', 'EMI & Loans'] },
  food: { name: 'Food & groceries', slot: 2, cats: ['Food & Dining', 'Groceries'] },
  move: { name: 'Travel & transport', slot: 3, cats: ['Transport', 'Travel'] },
  shop: { name: 'Shopping & lifestyle', slot: 4, cats: ['Shopping', 'Personal Care', 'Gifts & Donations'] },
  fun: { name: 'Subscriptions & fun', slot: 5, cats: ['Subscriptions', 'Entertainment'] },
  care: { name: 'Health & learning', slot: 7, cats: ['Health', 'Insurance', 'Education'] },
  other: { name: 'Other', slot: 0, cats: ['Cash Withdrawal', 'Fees & Charges', 'Tax', 'Uncategorized'] },
  save: { name: 'Saved & invested', slot: 6, cats: ['Investments'] },
  xfer: { name: 'Transfers', slot: 0, cats: ['Credit Card Bill', 'Transfers'] },
  income: { name: 'Income', slot: 6, cats: ['Salary', 'Interest', 'Dividends', 'Refunds & Cashback', 'Investment Returns', 'Other Income'] },
};
const FAMILY_OF = {};
for (const [k, f] of Object.entries(FAMILIES)) for (const c of f.cats) FAMILY_OF[c] = k;
export const familyOf = (cat) => FAMILY_OF[cat] || 'other';
export const SPEND_FAMILIES = ['home', 'food', 'move', 'shop', 'fun', 'care', 'other'];
export const familyColor = (fam) => `var(--s${FAMILIES[fam]?.slot ?? 0})`;
export const colorOf = (cat) => familyColor(familyOf(cat));


// Order matters: first match wins.
const DEBIT_RULES = [
  ['Credit Card Bill', /\b(CRED CLUB|CRED\b|CREDIT CARD|CC PAYMENT|CARD PAYMENT|CCPAY|AUTOPAY.*CARD|BILLDESK.*CARD)\b/],
  ['Tax', /\b(INCOME TAX|ADVANCE TAX|CBDT|NSDL TIN|TDS PAYMENT|SELF ASSESSMENT TAX)\b/],
  ['Investments', /\b(SIP|MUTUAL FUND|ZERODHA|GROWW|KUVERA|UPSTOX|ICCL|INDIAN CLEARING|NSE CLEARING|BSE STAR|SMALLCASE|ET MONEY|PAYTM MONEY|HDFC SEC|ICICI SEC|MOTILAL|DEMAT|NPS|PPF|ELSS|COIN BY|MF UTILITIES|MFU|ANGEL ONE|DHAN)\b/],
  ['Insurance', /\b(LIC|INSURANCE|HDFC LIFE|ICICI PRU|SBI LIFE|MAX LIFE|STAR HEALTH|CARE HEALTH|NIVA BUPA|ACKO|POLICYBAZAAR|BAJAJ ALLIANZ|TATA AIA|KOTAK LIFE|MEDICLAIM)\b/],
  ['EMI & Loans', /\b(EMI|LOAN|BAJAJ FIN|HOME LOAN|CAR LOAN|REPAYMENT|HDFC LTD|LIC HOUSING|FULLERTON|MUTHOOT|BAJAJFINSERV|KREDITBEE|MONEYVIEW|SLICE)\b/],
  ['Rent & Housing', /\b(RENT|LANDLORD|NOBROKER|NESTAWAY|MAINTENANCE|SOCIETY|APARTMENT|RESIDENT WELFARE|RWA)\b/],
  ['Subscriptions', /\b(NETFLIX|HOTSTAR|DISNEY|PRIME VIDEO|AMAZON PRIME|PRIME MEMBERSHIP|SPOTIFY|YOUTUBE|GOOGLE ONE|GOOGLE PLAY|GOOGLE STORAGE|APPLE\.?COM|APPLE SERVICES|ICLOUD|ITUNES|ZEE5|SONY ?LIV|JIO ?CINEMA|GAANA|WYNK|AUDIBLE|KINDLE|CHATGPT|OPENAI|ANTHROPIC|CLAUDE|NOTION|ADOBE|MICROSOFT|DROPBOX|LINKEDIN|TINDER|BUMBLE|CULT ?FIT|CUREFIT|SWIGGY ONE|ZOMATO GOLD|HBO|DISCOVERY|MUBI|CANVA|GITHUB)\b/],
  ['Groceries', /\b(BIGBASKET|BLINKIT|ZEPTO|INSTAMART|DMART|AVENUE SUPERMARTS|RELIANCE (FRESH|SMART)|JIOMART|MORE RETAIL|SPENCER|GROFERS|NATURE'?S BASKET|KIRANA|SUPERMARKET|SUPER MARKET|MILK|VEGETABLE|FRUITS|DAIRY|PROVISION|GENERAL STORE|STAR BAZAAR|COUNTRY DELIGHT|LICIOUS)\b/],
  ['Mobile & Internet', /\b(AIRTEL|JIO|VODAFONE|VI PREPAID|VIL|\bVI\b|BSNL|MTNL|ACT FIBERNET|HATHWAY|TATA PLAY|TATASKY|DISH TV|BROADBAND|RECHARGE|D2H|FIBER|FIBRE|YOU BROADBAND)\b/],
  ['Bills & Utilities', /\b(ELECTRIC|ELECTRICITY|BESCOM|TNEB|TANGEDCO|MSEDCL|BSES|TATA POWER|ADANI ELEC|WATER|GAS|INDRAPRASTHA|MAHANAGAR|PIPED|BBPS|MUNICIPAL|PROPERTY TAX|BWSSB|KSEB|TORRENT POWER|CESC|UTILITY|POWER)\b/],
  ['Food & Dining', /\b(SWIGGY|ZOMATO|DOMINO|PIZZA|MCDONALD|KFC|BURGER|STARBUCKS|CAFE|COFFEE|RESTAURANT|BIRYANI|BAKERY|EATSURE|DUNZO|BARBEQUE|DINING|DHABA|SUBWAY|HALDIRAM|CHAI|FOOD|KITCHEN|TIFFIN|EATFIT|BEHROUZ|FAASOS|BASKIN|ICE CREAM|JUICE|SWEETS|MESS)\b/],
  ['Travel', /\b(MAKEMYTRIP|GOIBIBO|CLEARTRIP|IXIGO|INDIGO|AIR INDIA|VISTARA|AKASA|SPICEJET|OYO|AIRBNB|BOOKING\.COM|AGODA|YATRA|IRCTC|REDBUS|ABHIBUS|TRAVEL|AIRLINES?|RESORT|HOTELS?|TRAIN)\b/],
  ['Transport', /\b(UBER|OLA|RAPIDO|METRO|FASTAG|NHAI|PETROL|FUEL|HPCL|BPCL|IOCL|INDIAN OIL|SHELL|PARKING|TOLL|NAMMA|DMRC|BLUSMART|BMTC|AUTO|CAB|TAXI|BIKE|PETROL PUMP|SERVICE STATION)\b/],
  ['Health', /\b(PHARMACY|PHARMA|APOLLO|MEDPLUS|PHARMEASY|1MG|NETMEDS|HOSPITAL|CLINIC|DIAGNOSTIC|LABS?|DOCTOR|DENTAL|PRACTO|MEDICAL|HEALTH|THYROCARE|LAL PATH|PATHOLOGY|OPTICAL|LENSKART|CHEMIST|MEDICINE|SCAN)\b/],
  ['Education', /\b(SCHOOL|COLLEGE|UNIVERSITY|TUITION|COURSERA|UDEMY|BYJU|UNACADEMY|EDUCATION|UPGRAD|SKILLSHARE|COACHING|ACADEMY|EXAM|INSTITUTE|VEDANTU|PHYSICS WALLAH)\b/],
  ['Entertainment', /\b(BOOKMYSHOW|PVR|INOX|CINEMA|MOVIE|STEAM|PLAYSTATION|XBOX|DREAM11|GAMES?|GAMING|EVENT|CONCERT|INSIDER|MPL|AMUSEMENT|BOWLING|THEATRE)\b/],
  ['Shopping', /\b(AMAZON|AMZN|FLIPKART|MYNTRA|AJIO|NYKAA|MEESHO|TATA CLIQ|DECATHLON|IKEA|LIFESTYLE|PANTALOONS|WESTSIDE|ZARA|H&M|CROMA|RELIANCE DIGITAL|SNAPDEAL|FIRSTCRY|PAYTM MALL|SHOPPERS STOP|MAX FASHION|UNIQLO|BATA|TRENDS|LENSKART|HOME CENTRE|PEPPERFRY|URBAN LADDER|APPAREL|FASHION|MALL|STORES?)\b/],
  ['Personal Care', /\b(SALON|SPA|URBAN COMPANY|URBANCLAP|BARBER|GROOMING|PARLOUR|PARLOR|BEAUTY|GYM|FITNESS|NATURALS)\b/],
  ['Gifts & Donations', /\b(DONATION|CHARITY|TEMPLE|NGO|GIVEINDIA|KETTO|FOUNDATION|MANDIR|GURUDWARA)\b/],
  ['Cash Withdrawal', /\b(ATM|CASH WDL|CASH WITHDRAWAL|NWD|AWB|CASH WD)\b/],
  ['Fees & Charges', /\b(CHARGES?|CHGS?|FEES?|GST|PENALTY|SMS ALERT|ANNUAL FEE|AMC|MIN BAL|FINANCE CHARGE|LATE FEE|CONVENIENCE|PROCESSING|DEBIT CARD|CARD FEE|INTEREST DEBIT|DISHONOUR|RETURN CHARGE|STAMP DUTY)\b/],
  ['Transfers', /\b(SELF|OWN ACCOUNT|OWN A\/C|MY ACCOUNT|SELF TRANSFER)\b/],
];

const CREDIT_RULES = [
  ['Salary', /\b(SALARY|SAL CR|PAYROLL|SAL FOR|SALARY CREDIT|SAL-|WAGES|STIPEND)\b/],
  ['Dividends', /\b(DIVIDEND|DIV|DIVID)\b/],
  ['Interest', /\b(INT\.? ?PD|INTEREST|INT PAID|INT CREDIT|SB INT|FD INT|CREDIT INTEREST|INT\.PD|INT CR)\b/],
  ['Refunds & Cashback', /\b(REFUND|REVERSAL|REVERSED|CASHBACK|CASH BACK|REWARD|CHARGEBACK|REV-|REVERSE)\b/],
  ['Investment Returns', /\b(REDEMPTION|REDEEM|MUTUAL FUND|ZERODHA|GROWW|KUVERA|SMALLCASE|SELL PROCEEDS|MATURITY)\b/],
  ['Transfers', /\b(SELF|OWN ACCOUNT|OWN A\/C|MY ACCOUNT|SELF TRANSFER)\b/],
];

const NOISE = new Set(
  ('UPI IMPS NEFT RTGS POS ACH NACH ECS ATM MMT BIL INF TRF TO BY FROM PAYMENT PYMT TXN REF NO P2A P2M P2P PAID DEBIT CREDIT DR CR ' +
    'PURCHASE ONLINE TRANSFER INB IB BIL ONL MOB MOBILE BANKING NET WITH FOR THE AND OF PAY PAYTM-' + ' VPA BANK LTD LIMITED PVT PRIVATE ' +
    'COM XXXX XX AT SENT RECEIVED COLLECT REQUEST MANDATE AUTOPAY SI AUTO DEBIT TPT CMS CHQ CHEQUE CLG CLEARING').split(' ')
);

/**
 * Reduce a bank narration to a stable merchant key, e.g.
 *   "UPI/412345678901/Paid to Swiggy/swiggy@ybl/Payment"  ->  "SWIGGY"
 *   "ACH D- NETFLIX COM-8837263"                          ->  "NETFLIX COM"
 *   "POS 4567XXXXXXXX1234 AMAZON PAY INDIA"                ->  "AMAZON PAY INDIA"
 */
export function merchantKey(desc) {
  const raw = String(desc || '').toUpperCase();
  const parts = raw.split(/[\/|]+/).map((p) => p.trim()).filter(Boolean);
  const candidates = [];
  for (const p of parts.length > 1 ? parts : [raw]) {
    let t = p
      .replace(/\b[A-Z0-9._-]+@[A-Z0-9]+\b/g, (m) => ' ' + m.split('@')[0].replace(/[0-9._-]+/g, ' ') + ' ')
      .replace(/[X*]{2,}\d*/g, ' ')
      .replace(/\b\d{4,}\b/g, ' ')
      .replace(/\b[A-Z]*\d+[A-Z\d]*\b/g, (m) => (/^[A-Z]{3,}\d{1,2}$/.test(m) ? m.replace(/\d+$/, '') : ' '))
      .replace(/[^A-Z&'. ]+/g, ' ')
      .replace(/\./g, ' ');
    const words = t.split(/\s+/).filter((w) => w && !NOISE.has(w) && w.length > 1);
    if (words.length) candidates.push(words);
  }
  if (!candidates.length) return 'UNKNOWN';
  // Prefer the first candidate that is not just generic words; keep up to 3 words.
  const best = candidates[0];
  return best.slice(0, 3).join(' ');
}

export const displayMerchant = (key) => titleCase(key);

/** Test a user keyword rule against an upper-cased narration. `/regex/` is supported; otherwise plain substring. */
export function ruleMatches(pattern, up) {
  const p = String(pattern || '').trim();
  if (!p) return false;
  const m = p.match(/^\/(.+)\/([a-z]*)$/);
  if (m) { try { return new RegExp(m[1], m[2].includes('i') ? m[2] : m[2] + 'i').test(up); } catch { return false; } }
  return up.includes(p.toUpperCase());
}

/**
 * Categorise one transaction. Priority: merchant rules learned from the user's edits → the user's keyword rules →
 * built-in rules. `aliases` maps one merchant key onto another ("SWIGGY INSTAMART" → "SWIGGY").
 */
export function categorize({ desc, type }, userRules = {}, { custom = [], aliases = {} } = {}) {
  let key = merchantKey(desc);
  if (aliases[key]) key = aliases[key];
  if (userRules[key]) return { category: userRules[key], key, source: 'user' };
  const up = String(desc || '').toUpperCase();
  for (const r of custom) if ((!r.type || r.type === type) && ruleMatches(r.pattern, up)) return { category: r.category, key, source: 'rule' };
  const rules = type === 'credit' ? CREDIT_RULES : DEBIT_RULES;
  for (const [cat, re] of rules) if (re.test(up)) return { category: cat, key, source: 'auto' };
  return { category: type === 'credit' ? 'Other Income' : 'Uncategorized', key, source: 'auto' };
}
