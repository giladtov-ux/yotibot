import { menuRecords } from "./record-menu.js";

// These are Hebrew infinitive forms, not required commands. Unrecognized or
// ambiguous phrasing continues to the contextual AI rather than being rejected.
const infinitive = /^ל(?:ה[א-ת]+|קנות|שלוח|כתוב|עשות|בדוק|סדר|תאם|תכנן|קפוץ|לכת|קרוא|בקר|זכור|פגוש|דבר|שלם|נקות|שטוף|ארגן|אסוף|תקן)(?:\s|$)/u;

export function parseBareTasks(rawText) {
  const text = rawText.trim().replace(/[.!]+$/u, "").trim();
  if (!infinitive.test(text) || /[?？]|(?:^|\s)(?:המשימה|הפריט|התזכורת|ברשימה|נשמע|כדאי|אולי|לדוגמה|סיימתי|עשיתי|בוצע|גמרתי|כבר|תוריד|תעיף|מחק|לא|אין|בלי)(?:\s|$)|מה\s+דעתך|את\s+(?:זה|אותו|אותה)(?:\s|$)/u.test(text)) return null;
  const parts = text.split(/[\n,;]+|\s+ו(?=ל[א-ת])/u).map(part => part.trim()).filter(Boolean);
  const items = parts.length > 1 && parts.every(part => infinitive.test(part)) ? parts : [text];
  if (items.length > 20 || items.some(item => item.length > 200)) return null;
  return items.length === 1 ? { type: "add-task", text: items[0] }
    : { type: "add-items", listName: "משימות", items };
}

const normalize = value => String(value ?? "").normalize("NFKC").toLocaleLowerCase("he-IL")
  .replace(/[\u0591-\u05C7]/gu, "").replace(/([וי])\1+/gu, "$1")
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const isReference = value => !value || /^(?:זה|את זה|אותו|אותה|משימה|פריט|המשימה|הפריט|המשימה הזו|המשימה הזאת|הפריט הזה)$/u.test(value.trim());
const wordForms = word => /^[ולבכמשה][א-ת]{3,}$/u.test(word)
  ? [word, word.slice(1)] : [word];
function containsTarget(text, requested) {
  const haystack = normalize(text).split(" ");
  const needle = requested.split(" ").filter(Boolean);
  if (!needle.length || requested.length < 3) return false;
  return haystack.some((_, start) => needle.every((word, index) =>
    haystack[start + index] && wordForms(word).some(form =>
      wordForms(haystack[start + index]).includes(form))));
}

export function parseNaturalTaskAction(rawText) {
  const text = rawText.trim().replace(/[.!]+$/u, "").trim();
  if (/[?？]|^(?:אל|לא|איך|האם|למה|לדוגמה|דוגמה|ציטוט)(?:\s|$)/u.test(text)) return null;
  const remove = /^(?:(?:בבקשה|אחי)\s+)?(?:תוריד|תורידי|להוריד|תסיר|תסירי|הסר|להסיר|תמחק|תמחקי|מחק|למחוק|תעיף)\s+(?:לי\s+)?(?:את\s+)?(.+)$/u.exec(text);
  const complete = /^(?:(?:בבקשה|אחי)\s+)?(?:סיימתי|גמרתי|עשיתי|השלמתי|סגרתי)\s+(?:(?:את|עם)\s+)?(.+)$/u.exec(text);
  const suffix = /^(.+?)\s+(?:בוצע|בוצעה|הושלם|הושלמה|סיימתי|✅)$/u.exec(text);
  const visited = /^(?:כבר\s+)?(?:הלכתי|ביקרתי|ראיתי)\s+(.+)$/u.exec(text);
  const match = remove ?? complete ?? suffix ?? visited;
  if (!remove && /(?:^|\s)(?:לא|טרם|מחר)(?:\s|$)/u.test(text)) return null;
  if (!match || /תזכורת|תזכורות|רשימ[הת]|לו[״"׳']?ז|לוח\s*שנה|הכול|הכל|כולם|כולן/u.test(match[1])) return null;
  const itemText = match[1].replace(/\s+(?:בבקשה|תודה)$/u, "").trim();
  return itemText ? { type: remove ? "remove-item" : "mark-item", itemText } : null;
}

const completionWords = new Set(["את", "עם", "של", "לי", "אני", "כבר", "היום", "הלכתי", "ראיתי", "ביקרתי", "עשיתי", "סיימתי", "ללכת", "לבצע", "בוצע"]);
function completionTokens(text) {
  return normalize(text).split(" ").filter(word => !completionWords.has(word))
    .map(word => wordForms(word).at(-1)).filter(word => word.length >= 3);
}
function nearWord(left, right) {
  if (left === right) return true;
  if (Math.min(left.length, right.length) < 4 || Math.abs(left.length - right.length) > 1) return false;
  let row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 0; i < left.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < right.length; j++) next.push(Math.min(next[j] + 1,
      row[j + 1] + 1, row[j] + Number(left[i] !== right[j])));
    row = next;
  }
  return row[right.length] <= 1;
}
export function fuzzyCompletionCandidates(candidates, text) {
  // A single-record fallback must not discard a second action in a batch.
  if (/[,;\n]|\s(?:וגם|וכן|בנוסף|ו(?:ל[א-ת]{2,}|סיימתי|עשיתי))\s/u.test(text)) return [];
  const requested = completionTokens(text);
  if (!requested.length) return [];
  const ranked = candidates.map(candidate => {
    const words = completionTokens(candidate.item.text);
    const hits = requested.filter(word => words.some(other => nearWord(word, other)));
    const distinctive = hits.some(word => word.length >= 4);
    const score = distinctive ? hits.length / requested.length * .75
      + hits.length / Math.max(1, words.length) * .25 : 0;
    return { candidate, score };
  }).filter(hit => hit.score >= .55).sort((a, b) => b.score - a.score);
  if (!ranked.length || ranked[1] && ranked[0].score - ranked[1].score < .15) return [];
  return [ranked[0].candidate];
}

// Resolve AI intent against this user's complete canonical lists. Never use a
// partial model overview as proof of identity, or choose between ambiguous hits.
export function bindItemIntent(store, chatId, intent, rawText = "") {
  const lists = store.lists[chatId] ?? {};
  const entries = Object.entries(lists);
  const view = store.recordViews?.[chatId];
  const displayed = view && menuRecords(store, chatId, "s").find(record => record.key === view.key);
  const normalizedName = normalize(intent.listName);
  const normalizedRequest = ` ${normalize(rawText)} `;
  const explicitName = normalizedName && (
    ["ברשימת", "מרשימת", "מהרשימת", "ברשימה", "מהרשימה", "רשימת", "רשימה"]
      .some(prefix => normalizedRequest.includes(` ${prefix} ${normalizedName} `))
    || ["ב", "מ", "מה"].some(prefix => normalizedRequest.includes(` ${prefix}${normalizedName} `))
    || rawText.trim().startsWith(`${intent.listName}:`));
  const named = intent.listName ? entries.filter(([name]) => normalize(name) === normalize(intent.listName)) : [];
  const source = explicitName ? named : entries;
  let candidates = source.flatMap(([listName, items]) => items
    .filter(item => intent.type === "mark-item" ? !item.checked
      : intent.type !== "remove-item" || !item.checked
        || (displayed?.name === listName && displayed?.id === item.id))
    .map(item => ({ listName, item })));
  if (intent.itemId) candidates = candidates.filter(candidate => candidate.item.id === intent.itemId);
  if (isReference(intent.itemText)) {
    if (displayed?.kind === "item") {
      candidates = candidates.filter(({ item }) => item.id === displayed.id);
    } else if (view) {
      candidates = [];
    } else {
      const last = store.lastListActions?.[chatId]?.listName;
      candidates = candidates.filter(({ listName, item }) => listName === last && !item.checked);
    }
  } else {
    const requested = normalize(intent.itemText);
    const exact = candidates.filter(({ item }) => normalize(item.text) === requested);
    const contained = candidates.filter(({ item }) => containsTarget(item.text, requested));
    candidates = exact.length ? exact : contained.length ? contained
      : intent.type === "mark-item" ? fuzzyCompletionCandidates(candidates, intent.itemText) : [];
    if (candidates.length > 1 && named.length) {
      const inNamed = candidates.filter(candidate => candidate.listName === named[0][0]);
      if (inNamed.length) candidates = inNamed;
    }
    if (candidates.length > 1) {
      const inView = candidates.filter(candidate => candidate.listName === displayed?.name
        && candidate.item.id === displayed?.id);
      if (inView.length === 1) candidates = inView;
    }
  }
  if (candidates.length !== 1) return { response: candidates.length
    ? "יש כמה משימות שמתאימות. על איזו מהן מדובר?"
    : `ברשימה הפתוחה אין כרגע פריט בשם “${intent.itemText || "הפריט הזה"}”. הנה הרשימה העדכנית.` };
  return { ...intent, listName: candidates[0].listName, itemText: candidates[0].item.text,
    itemId: candidates[0].item.id };
}
