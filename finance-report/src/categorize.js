// Rule-based transaction categorization. Rules are [category, [keywords]]; first match wins.
// Categories listed in TRANSFER_CATEGORIES are excluded from income/expense totals (they move money between your own accounts).
export const TRANSFER_CATEGORIES = new Set(['תשלום כרטיס אשראי', 'העברות והשקעות']);

export const DEFAULT_RULES = [
  ['תשלום כרטיס אשראי', ['ישראכרט', 'לאומי קארד', 'מקס איט', 'max it', 'כאל', 'כרטיסי אשראי', 'ויזה כ.א.ל', 'אמריקן אקספרס', 'דיינרס', 'חיוב כרטיס']],
  ['העברות והשקעות', ['העברה לחשבון', 'העברה מחשבון', 'הפקדה לפיקדון', 'פירעון פיקדון', 'קניית ני"ע', 'מכירת ני"ע', 'קניה ני"ע', 'interactive brokers', 'ibkr', 'פיקדון', 'קרן כספית', 'הפקדה לקופת גמל', 'העברה עצמית']],
  ['משכורת', ['משכורת', 'שכר', 'salary', 'payroll']],
  ['קצבאות והחזרים', ['ביטוח לאומי', 'החזר מס', 'מס הכנסה החזר', 'קצבת']],
  ['סופר ומזון', ['שופרסל', 'רמי לוי', 'ויקטורי', 'יוחננוף', 'מגה', 'טיב טעם', 'אושר עד', 'חצי חינם', 'יינות ביתן', 'קרפור', 'am:pm', 'סופר', 'מכולת', 'ירקות', 'פירות', 'מאפייה', 'קצביה', 'קשת טעמים', 'פרש מרקט']],
  ['מסעדות ובתי קפה', ['מסעדה', 'מסעדת', 'קפה', 'cafe', 'coffee', 'ארומה', 'קפה גרג', 'לנדוור', 'מקדונלד', 'בורגר', 'פיצה', 'סושי', 'wolt', 'וולט', 'תן ביס', 'בר']],
  ['תחבורה ורכב', ['פז', 'דלק', 'סונול', 'דור אלון', 'ten', 'yellow', 'רב קו', 'רב-קו', 'gett', 'גט טקסי', 'מוניות', 'חניון', 'חניה', 'פנגו', 'סלופארק', 'כביש 6', 'נתיבי', 'רכבת', 'אגד', 'דן', 'טסט', 'מוסך', 'צמיגים']],
  ['דיור ומשכנתא', ['משכנתא', 'שכר דירה', 'שכירות', 'ועד בית', 'ארנונה', 'עירייה', 'עיריית']],
  ['חשבונות ותקשורת', ['חברת החשמל', 'חשמל', 'מי', 'תאגיד מים', 'מים', 'גז', 'סופרגז', 'אמישראגז', 'פזגז', 'בזק', 'הוט', 'hot', 'yes', 'סלקום', 'פרטנר', 'פלאפון', 'גולן טלקום', '012', '013', 'הוט מובייל', 'רמי לוי תקשורת', 'we4g', 'אינטרנט']],
  ['ביטוחים', ['ביטוח', 'הראל', 'מגדל', 'כלל', 'הפניקס', 'מנורה', 'איילון', 'ביטוח ישיר', 'aig', 'שומרה', 'ליברה']],
  ['בריאות', ['מכבי', 'כללית', 'מאוחדת', 'לאומית', 'סופר-פארם', 'סופר פארם', 'super-pharm', 'בית מרקחת', 'רופא', 'שיניים', 'אופטיקה', 'be']],
  ['חינוך וילדים', ['גן', 'גנון', 'צהרון', 'בית ספר', 'אוניברסיטה', 'מכללה', 'שכר לימוד', 'חוג', 'קייטנה', 'טויס', 'toys']],
  ['קניות וביגוד', ['amazon', 'אמזון', 'aliexpress', 'עלי אקספרס', 'shein', 'זארה', 'zara', 'h&m', 'קסטרו', 'פוקס', 'fox', 'גולף', 'נעלי', 'איקאה', 'ikea', 'ace', 'הום סנטר', 'מחסני חשמל', 'ksp', 'באג', 'ivory', 'אייבורי', 'שקם אלקטריק']],
  ['מנויים ובידור', ['netflix', 'spotify', 'apple.com', 'google', 'youtube', 'disney', 'סינמה', 'יס פלאנט', 'סינמה סיטי', 'הופעה', 'כרטיסים', 'steam', 'playstation', 'chatgpt', 'openai', 'anthropic', 'claude']],
  ['טיסות ונופש', ['אל על', 'el al', 'ישראייר', 'ארקיע', 'wizz', 'ryanair', 'easyjet', 'booking', 'airbnb', 'מלון', 'hotel', 'expedia']],
  ['מזומן ומשיכות', ['משיכת מזומן', 'כספומט', 'מזומן']],
  ['עמלות ומיסים', ['עמלה', 'דמי כרטיס', 'דמי ניהול', 'ריבית חובה', 'מס הכנסה', 'מע"מ', 'רשות המסים']],
  ['תרומות', ['תרומה', 'עמותה', 'jgive']],
];

// Categories that only apply to money coming in.
export const INCOME_ONLY = new Set(['משכורת', 'קצבאות והחזרים']);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Latin keywords and short Hebrew keywords (≤3 letters) must match a whole word ("hot" ≠ "hotel"); longer Hebrew ones match anywhere. */
function matcher(kw) {
  const k = kw.toLowerCase().trim();
  if (/[a-z]/.test(k) || k.length <= 3) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escape(k)}($|[^\\p{L}\\p{N}])`, 'u');
    return (h) => re.test(h);
  }
  return (h) => h.includes(k);
}

export function buildRules(cfg = {}) {
  const custom = Object.entries(cfg.categories || {}); // { "category": ["kw", ...] } — checked before defaults
  return [...custom, ...DEFAULT_RULES].map(([cat, kws]) => [cat, kws.map(matcher)]);
}

export function categorize(txn, rules, { incomeFallback = 'הכנסות אחרות', expenseFallback = 'אחר' } = {}) {
  const hay = `${txn.description || ''} ${txn.memo || ''}`.toLowerCase().replace(/\s+/g, ' ');
  for (const [cat, tests] of rules) {
    if (INCOME_ONLY.has(cat) && !(txn.amount > 0)) continue;
    if (tests.some((t) => t(hay))) return cat;
  }
  if (txn.scraperCategory) return txn.scraperCategory;
  return txn.amount > 0 ? incomeFallback : expenseFallback;
}
