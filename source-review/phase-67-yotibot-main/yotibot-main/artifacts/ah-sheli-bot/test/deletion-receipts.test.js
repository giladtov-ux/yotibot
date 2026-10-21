import { test } from "node:test";
import assert from "node:assert/strict";
import { isDeletionSuccessClaim } from "../src/deletion-receipts.js";

test("model-generated deletion receipts are recognized, without mistaking questions, refusals or historical quotes for receipts", () => {
  for (const text of ["ניקיתי", "ניקיתי את הרשימה.", "סגור אחי, מחקתי את הפריט.",
    "✅ הפריט נמחק.", "אחי, הרשימה שלך נוקתה.", "כל הפריטים נמחקו."]) {
    assert.equal(isDeletionSuccessClaim(text), true, text);
  }
  for (const text of ["לא ניקיתי את הרשימה.", "עדיין לא מחקתי דבר.", "הפריט לא נמחק.",
    "מנקה את הרשימה. סגור?", "אמרת אתמול ״ניקיתי את הרשימה״.", "איך מוחקים פריט?", null]) {
    assert.equal(isDeletionSuccessClaim(text), false, text);
  }
});
