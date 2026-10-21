// Display only: never rewrite the stored product name, quantity or item ID.
const products = [
  ["🪙", "נייר כסף|נייר אלומיניום|רדיד כסף|רדיד אלומיניום|אלומיניום"],
  ["🧻", "נייר טואלט|טואלט|נייר סופג|נייר אפייה|מגבות נייר|מגבת נייר|מגבות חד פעמיות|טישו|נייר"],
  ["🧺", "מגבות בד|מגבת בד|מגבות למטבח|מגבות מטבח|מגבות|מגבת"],
  ["🥚", "ביצים|ביצה"],
  ["🍯", "חלבה|חלווה|חלוה|דבש"],
  ["🍫", "שוקולד"],
  ["🥛", "חלב|מעדן|מעדנים|מעדני חלב|מעדני|יוגורט"],
  ["🥛", "גבינה|גבינות|קוטג׳|קוטג'|קוטג"],
  ["🧈", "חמאה"],
  ["🍞", "לחם|לחמניות|לחמניה|חלה|חלות"],
  ["🥒", "מלפפון|מלפפונים"],
  ["🍅", "עגבניה|עגבנייה|עגבניות"],
  ["🥔", "תפוחי אדמה|תפוח אדמה"],
  ["🍎", "תפוח|תפוחים"],
  ["🍌", "בננה|בננות"],
  ["🍊", "תפוז|תפוזים"],
  ["🍋", "לימון|לימונים"],
  ["🍓", "תות|תותים"],
  ["🍇", "ענבים"],
  ["🍉", "אבטיח|אבטיחים"],
  ["🍐", "אגס|אגסים"],
  ["🍑", "אפרסק|אפרסקים"],
  ["🥑", "אבוקדו"],
  ["🥕", "גזר"],
  ["🧅", "בצל|בצלים"],
  ["🧄", "שום"],
  ["🥬", "חסה|כרוב"],
  ["🥗", "ירקות|ירק|סלט"],
  ["🍎", "פירות|פרי"],
  ["🍚", "אורז"],
  ["🍝", "פסטה|ספגטי"],
  ["🍗", "עוף|עופות|שניצל|שניצלים"],
  ["🥩", "בשר|סטייק|סטייקים"],
  ["🐟", "דג|דגים|טונה"],
  ["☕", "קפה"],
  ["🍵", "תה"],
  ["💧", "מים"],
  ["🧼", "סבון"],
];
const mapping = products.map(([emoji, names]) => ({
  emoji,
  pattern: new RegExp(`(?:^|\\s)[והבלמכש]{0,2}(?:${names})(?=\\s|$)`, "u"),
}));

export const isShoppingList = name => /קניות|מצרכים/u.test(name ?? "");
const graphemes = new Intl.Segmenter("he", { granularity: "grapheme" });

export function shoppingItemLabel(value) {
  // Replace legacy/generated symbols in display labels, including a wrong moon
  // or toilet-paper emoji on foil. Keep the saved name and numeric quantities.
  // Whole graphemes prevent dangling skin tones, variation selectors or joiners.
  const text = [...graphemes.segment(String(value))]
    .map(({ segment }) => /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(segment) ? " " : segment)
    .join("").replace(/[ \t]{2,}/gu, " ").trim();
  const normalized = text.normalize("NFKC").replace(/[\u0591-\u05C7]/gu, "")
    .replace(/[^\p{L}\p{N}'׳]+/gu, " ").trim();
  // Prefer the most specific (longest) keyword/phrase over a broad category:
  // "מגבות נייר" beats "מגבות"; "סלט עגבניות" beats generic "סלט".
  const matches = mapping.flatMap(entry => {
    const match = entry.pattern.exec(normalized);
    return match ? [{ emoji: entry.emoji, specificity: match[0].trim().length }] : [];
  }).sort((left, right) => right.specificity - left.specificity);
  const emoji = matches[0]?.emoji;
  return emoji ? `${emoji} ${text}` : text;
}

export const listItemLabel = (name, text) => isShoppingList(name) ? shoppingItemLabel(text) : text;
