---
name: Shopping icon reference
description: Why the supplied shopping icon dictionary takes precedence over conventional emoji meanings
---

Use the user's supplied shopping icon associations as the reference, even when
an association is unconventional. Do not silently replace them with what seems
to be a more semantically correct food or product icon.

**Why:** the user supplied an explicit dictionary alongside Telegram comparison
screenshots; the requested appearance, rather than conventional emoji meaning,
is the target.

**How to apply:** preserve those associations during presentation changes. Keep
the original saved product text and quantities intact; presentation must not
rename shopping items.

Shopping lists should match the supplied Botivation reference: a short header,
one native inline product button per row with the icon beside its name, and
item management/deletion after selecting the product. Do not duplicate the
product list as prose above the buttons.
Do not append a second plain-text list or action receipt below the shopping
card; update the selected card and use its callback toast for the action result.

**Why:** the user explicitly requested this presentation for Ah Sheli after
comparing its plain-text list with the reference bot, then repeated that the
duplicate text message beneath the buttons must be removed.
The user reported it again with screenshots showing contradictory inventories;
free-form or contextual shopping replies must not reconstruct products from
conversation history.

**How to apply:** use the same presentation for reads and verified shopping
mutations, retain original product text and quantities, and verify the serialized
Telegram payload rather than relying only on a mocked renderer.
Resolve displayed products from current owner-scoped saved data, not model
prose. Keep ordinary-sized shopping lists together instead of a five-item preview.
