// Keys and default expected returns match the calculator's asset types (index.html), so exports line up.
export const ASSET_CLASSES = {
  cash: { label: 'עו"ש / מזומן', ret: 0.5 },
  deposit: { label: 'פיקדון / קרן כספית', ret: 3.5 },
  stocks: { label: 'מניות / קרנות מחקות', ret: 7 },
  bonds: { label: 'אג"ח', ret: 4 },
  gemel: { label: 'קופת גמל להשקעה', ret: 6 },
  hishtalmut: { label: 'קרן השתלמות', ret: 6 },
  pension: { label: 'פנסיה / ביטוח מנהלים', ret: 5 },
  crypto: { label: 'קריפטו', ret: 8 },
  realEstate: { label: 'נדל"ן', ret: 4 },
  other: { label: 'אחר', ret: 4 },
  liability: { label: 'התחייבויות', ret: 0 },
};
export const assetLabel = (k) => ASSET_CLASSES[k]?.label ?? k;

/** Guess an asset class from a security / product name. */
export function guessAssetClass(name = '', fallback = 'stocks') {
  const s = String(name);
  if (/השתלמות/.test(s)) return 'hishtalmut';
  if (/פנסי|ביטוח מנהלים|מנהלים/.test(s)) return 'pension';
  if (/גמל/.test(s)) return 'gemel';
  if (/כספית|מק"?מ|money market|פיקדון|פקדון/i.test(s)) return 'deposit';
  if (/אג"?ח|אגח|bond|treasury|שקלית|ממשלתי|צמוד/i.test(s)) return 'bonds';
  if (/bitcoin|ethereum|crypto|ביטקוין|קריפטו/i.test(s)) return 'crypto';
  return fallback;
}
