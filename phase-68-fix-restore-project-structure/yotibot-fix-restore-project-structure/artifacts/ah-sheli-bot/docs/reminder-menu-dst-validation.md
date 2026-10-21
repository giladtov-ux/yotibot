# Reminder day-menu DST checks

Run the focused integration suite from the workspace root:

```sh
node --test artifacts/ah-sheli-bot/test/reminder-menu-dst.integration.test.js
```

The suite runs the real menu, schedule query and callback code against synthetic
in-memory stores. Callback persistence and Telegram delivery are injected spies;
it does not load or save user records, contact Telegram, or run the scheduler.
A temporary data directory is set before importing the bot dependency graph.

Fixtures use explicit UTC instants, independently of the production local-time
parser. Israel's 2026 transitions are March 27 (02:00 becomes 03:00) and
October 25 (02:00 becomes 01:00).

## Verified scenarios

- Today and tomorrow omit the nonexistent spring 02:30 weekly occurrence rather
  than inventing a replacement clock.
- Two separately saved one-off reminders at the first and second autumn 01:30
  remain two distinct records in UTC order, each appearing exactly once.
- The autumn day is unchanged before, during and after the repeated hour.
- Local Israel days are selected even when the UTC date is still the day before.
- Weekly definitions recover the displayed occurrence after the worker has
  advanced the stored deadline, with correct spring/winter offsets.
- Page, detail and back callbacks agree with menu clocks and dates for passing
  cases. A current-day delivery receipt retains the correct date after advancement.
- All navigation preserves reminders, deadlines, queue order, saved definitions,
  lists, pending writes and other users' view context. Only the navigating
  owner's view context may change.

## Discovered defects (not fixed in this test-only change)

Nine executable tests are explicitly marked `todo`, not skipped. They assert
the required correct behavior and currently fail. The runner therefore exits
successfully **without establishing that these cases work**:

1. **Wrong date in weekly details:** after the stored deadline advances, the
   day-menu button uses the selected day's projected occurrence, but details
   select the next stored deadline or an older open delivery receipt. Eight
   cases cover spring/autumn, today/tomorrow and absent/old receipts.
2. **Invented weekly duplicate in the autumn fold:** if the stored weekly
   reminder uses the first 01:30, reconstructing its definition chooses the
   second 01:30 and adds an extra occurrence for the same reminder. Separate
   real one-off reminders at both instants must still be retained.

These are display defects, not evidence that the worker sends reminders at
incorrect times. Fix them in separately approved changes without altering
scheduling or completion/deletion semantics. Remove the corresponding `todo`
annotations once those fixes pass the existing assertions.
