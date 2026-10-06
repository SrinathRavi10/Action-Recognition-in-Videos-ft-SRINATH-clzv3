// Tiny i18n layer. English is the source; add a language by adding an object to STR.
const STR = {
  hi: {
    'Home': 'होम', 'Transactions': 'लेन-देन', 'Import': 'आयात', 'Bills': 'बिल व सदस्यता', 'Plan': 'योजना', 'Tax': 'कर', 'Reports': 'रिपोर्ट', 'Settings': 'सेटिंग्स',
    'Left after spending': 'खर्च के बाद बचत', 'Income': 'आय', 'Spent': 'खर्च', 'Invested': 'निवेश', 'Savings rate': 'बचत दर', 'Where your money went': 'आपका पैसा कहाँ गया',
    'Month by month': 'माह दर माह', 'Top merchants': 'शीर्ष दुकानें', 'What changed': 'क्या बदला', 'Budgets': 'बजट', 'Insights': 'सुझाव', 'Add expense': 'खर्च जोड़ें',
    'Search or jump to…': 'खोजें या जाएँ…', 'Offline & private': 'ऑफ़लाइन व निजी', 'Lock': 'लॉक', 'Cancel': 'रद्द करें', 'Save': 'सहेजें', 'Delete': 'हटाएँ',
    'Goals': 'लक्ष्य', 'Net worth': 'कुल संपत्ति', 'Forecast': 'पूर्वानुमान', 'Owed to you': 'आपको देय', 'Upcoming': 'आगामी', 'Calendar': 'कैलेंडर',
    'Old vs new regime': 'पुरानी बनाम नई व्यवस्था', 'Documents': 'दस्तावेज़', 'Rent receipts': 'किराया रसीदें', 'Theme': 'थीम', 'Language': 'भाषा', 'Appearance': 'दिखावट',
    'Backup & restore': 'बैकअप व पुनर्स्थापना', 'Privacy': 'गोपनीयता', 'Subscriptions': 'सदस्यताएँ', 'Search': 'खोज', 'Export': 'निर्यात', 'Print': 'प्रिंट',
    'Welcome': 'स्वागत है', 'Try with demo data': 'डेमो डेटा आज़माएँ', 'Import a statement': 'स्टेटमेंट आयात करें', 'Spending': 'खर्च', 'Saved': 'बचत',
  },
};
export const LANGS = { en: 'English', hi: 'हिन्दी (Hindi)' };
let lang = 'en';
export const setLang = (l) => { lang = STR[l] ? l : 'en'; document.documentElement.lang = lang; };
export const getLang = () => lang;
export const t = (s) => (lang === 'en' ? s : STR[lang]?.[s] ?? s);
