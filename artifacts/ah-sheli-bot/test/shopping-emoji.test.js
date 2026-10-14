import test from "node:test";
import assert from "node:assert/strict";
import { shoppingItemLabel, listItemLabel } from "../src/shopping-emoji.js";
import { createEmptyStore } from "../src/store.js";
import { recordMenuForList, renderRecordDetails } from "../src/record-menu.js";
import { listReceiptText } from "../src/list-mutation-receipts.js";

test("products, prefixes and quantities receive specific emojis, not substring matches", () => {
  for (const [text, emoji] of [["ביצים x3", "🥚"], ["חלבה", "🍯"], ["חלב", "🥛"],
    ["נייר טואלט", "🧻"], ["מגבות למטבח", "🧺"], ["תפוחי אדמה", "🥔"], ["את הביצים", "🥚"]]) {
    assert.equal(shoppingItemLabel(text), `${emoji} ${text}`);
  }
  assert.equal(shoppingItemLabel("חלבון"), "חלבון");
  assert.equal(shoppingItemLabel("מוצר מיוחד"), "מוצר מיוחד");
  assert.equal(shoppingItemLabel("🥚 ביצים"), "🥚 ביצים");
  assert.equal(shoppingItemLabel("🛒 חלב"), "🥛 חלב");
  assert.equal(listItemLabel("משימות", "לקנות חלב"), "לקנות חלב");
});

test("shopping buttons, details and mutation receipts agree without mutating saved data", () => {
  const store = createEmptyStore();
  store.lists.a = { קניות: [{ id: "eggs", text: "ביצים x3", checked: false },
    { id: "milk", text: "חלב", checked: false }, { id: "unknown", text: "מוצר מיוחד", checked: false }] };
  const before = JSON.stringify(store);
  const menu = recordMenuForList(store, "a", "קניות");
  const buttons = menu.options.reply_markup.inline_keyboard.flat();
  assert.deepEqual(buttons.slice(0, 3).map(button => button.text), ["🥚 ביצים x3", "🥛 חלב", "מוצר מיוחד"]);
  assert.ok(buttons.every(button => !button.text.includes("🛒")));
  const [, , key, scope, mode, offset] = buttons[0].callback_data.split(":");
  const details = renderRecordDetails(store, "a", key, scope, mode, Number(offset));
  assert.match(details.text, /🥚 ביצים x3/u);
  assert.equal(listReceiptText({ listName: "קניות", before: [], after: store.lists.a.קניות }),
    "✅ הוספתי: 🥚 ביצים x3, 🥛 חלב, מוצר מיוחד.");
  assert.equal(listReceiptText({ listName: "קניות", before: store.lists.a.קניות, after: [] }),
    "🗑️ הסרתי: 🥚 ביצים x3, 🥛 חלב, מוצר מיוחד.");
  assert.equal(JSON.stringify(store), before);
});

test("specific paper, dairy and produce keywords override broader categories", () => {
  const examples = [
    ["נייר כסף", "🪙"], ["נייר אלומיניום", "🪙"], ["גליל אלומיניום 20 מטר", "🪙"],
    ["רדיד כסף", "🪙"], ["נייר טואלט", "🧻"], ["טואלט", "🧻"],
    ["מגבות נייר", "🧻"], ["מגבות חד-פעמיות", "🧻"], ["מגבות בד", "🧺"],
    ["מעדנים", "🥛"], ["מעדני חלב", "🥛"], ["יוגורט", "🥛"], ["גבינה", "🥛"],
    ["גבינות", "🥛"], ["גבינה לבנה", "🥛"], ["נייר", "🧻"],
    ["חלווה", "🍯"], ["חַלְוָה", "🍯"], ["דבש", "🍯"],
    ["ירקות", "🥗"], ["פירות", "🍎"], ["סלט עגבניות", "🍅"],
    ["את המלפפונים", "🥒"], ["תפוחי אדמה", "🥔"],
  ];
  for (const [text, emoji] of examples) {
    assert.equal(shoppingItemLabel(text), `${emoji} ${text}`, text);
  }
  for (const text of ["כסף", "חלבון", "מוצר שלא מוכר"]) {
    assert.equal(shoppingItemLabel(text), text);
  }
});

test("legacy wrong emojis are replaced, without losing quantities or duplicating symbols", () => {
  const examples = [
    ["נייר כסף 🌑", "🪙 נייר כסף"], ["נייר כסף 🧻", "🪙 נייר כסף"],
    ["🧀 גבינה", "🥛 גבינה"], ["ביצים🥚x3", "🥚 ביצים x3"],
    ["🧺 מגבות מטבח", "🧺 מגבות מטבח"], ["🛒 נייר כסף 🌑 x2", "🪙 נייר כסף x2"],
    ["מוצר מיוחד 🌑", "מוצר מיוחד"], ["🛒 מוצר מיוחד", "מוצר מיוחד"],
    ["🧑🏽‍🍳 חלב 2", "🥛 חלב 2"], ["חלב 1️⃣", "🥛 חלב 1️⃣"],
  ];
  for (const [text, expected] of examples) {
    assert.equal(shoppingItemLabel(text), expected, text);
    assert.equal(shoppingItemLabel(expected), expected, `repeat: ${text}`);
  }
});

test("updated mapping is identical in buttons and confirmed addition/removal messages", () => {
  const store = createEmptyStore();
  const items = ["נייר כסף 🌑", "גבינה 🧀", "מגבות נייר", "ירקות", "מלפפונים"].map((text, index) =>
    ({ id: `product-${index}`, text, checked: false }));
  store.lists.a = { קניות: items };
  const snapshot = JSON.stringify(store);
  const menu = recordMenuForList(store, "a", "קניות");
  const expected = ["🪙 נייר כסף", "🥛 גבינה", "🧻 מגבות נייר", "🥗 ירקות", "🥒 מלפפונים"];
  assert.deepEqual(menu.options.reply_markup.inline_keyboard.slice(0, 5).map(row => row[0].text), expected);
  for (const label of expected) {
    assert.ok(listReceiptText({ listName: "קניות", before: [], after: items }).includes(label));
    assert.ok(listReceiptText({ listName: "קניות", before: items, after: [] }).includes(label));
  }
  assert.equal(JSON.stringify(store), snapshot);
});
