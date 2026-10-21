# Local demo rendered-browser regression

These tests load the **existing API preview** at `/#demo`. They do not start
the Telegram worker or create real reminders. The browser blocks unexpected
network requests; only the same-origin public document, explicitly listed public
scripts/styles and Google Fonts GETs are allowed. The Telegram Mini App SDK
request is fulfilled locally with empty JavaScript, never sent to Telegram.
API requests, checkout and unrelated navigation remain blocked and fail the test.

## Run

From the workspace root, with an already running API server:

```sh
pnpm --filter @workspace/api-server exec playwright install chromium webkit
DEMO_BASE_URL=https://your-preview-host \
  pnpm --filter @workspace/api-server run test:demo:browser
```

`DEMO_BASE_URL` defaults to `https://$REPLIT_DEV_DOMAIN` if present. No credentials
are needed. This suite deliberately has no `webServer` command or bot dependency.

For a host with a preinstalled Chromium executable:

```sh
DEMO_CHROMIUM_PATH=/repl/tools/bin/chromium \
  pnpm --filter @workspace/api-server run test:demo:browser --project=chromium
```

Do not put an extra `--` before the Playwright arguments when using `pnpm run`.
Use `--project=webkit` to run WebKit separately. Missing browsers or host libraries
fail the selected project rather than silently skipping it.

The `firefox` project selects only the four `keyboard accessibility` cases;
it does not add Firefox Hebrew-layout or Safari coverage. On a supported host:

```sh
pnpm --filter @workspace/api-server exec playwright install firefox
pnpm --filter @workspace/api-server run test:demo:browser --project=firefox
```

## Coverage and limits

- Three phone widths: 320, 360 and 390 CSS pixels.
- A real DOM/layout engine, with Playwright's browser clock for deterministic
  animation timing. All progressive reply and popup fields are checked.
- The initial user bubble is visible immediately on loading `/#demo`, and the
  bot reply and visual reminder follow automatically without clicking replay.
- Following the user's video reference, the local card marks itself completed
  and shows a short assistant acknowledgement automatically, then fades and
  repeats. These visual steps do not call Telegram or perform real reminder actions.
- Rendered Hebrew glyph positions are RTL; time glyph positions are LTR and
  isolated at each intermediate `7`, `7:`, `7:3`, `7:30` state.
- Exact request/reply, completed widget fields, no horizontal card overflow,
  popup fields/buttons inside their card, scrolling and actual local done/delete
  button clicks, plus completion, fading, reset and the next request.
- In-page tab changes pause partial text and resume it.
- Page-visibility **events are explicitly simulated** with controlled
  `document.hidden`/`visibilityState` properties in a rendered browser. Headless
  tabs are not a reliable OS-backgrounding test; this is not a test of switching
  phone apps, screen locking, timer throttling or back-forward cache.
- Reduced-motion media emulation still autoplays progressive messages and the
  wake-up popup. Decorative motion is reduced, but pause/resume, deletion and
  replay remain available; there is no automatic static-preview mode.

Each full-cycle case attaches a screenshot of the completed card. Add
`--reporter=html` for a browsable report in `tests/browser/html-report/`.
Failures retain screenshots and traces in `tests/browser/results/`.

## Validation recorded on 2026-10-08

| Engine/check | Result |
| --- | --- |
| Chromium 152.0.7977.64, Playwright 1.63.0 | **6/6 passed**, including page-load autoplay and all three phone widths |
| Native VM/timer suite (`node --test artifacts/api-server/tests/demo-playback.test.mjs`) | **21/21 passed** |
| Playwright WebKit 26.6, revision 2359 | Downloaded and launch attempted, but **not executed**: Linux host lacks GTK 4, ICU 74, GStreamer, Pango/Harfbuzz, Cairo and other required libraries |
| Actual Safari on macOS/iPhone/iPad | **Not tested** |

Chromium command used by the browser tester (from `artifacts/api-server`):

```sh
DEMO_BASE_URL=https://your-preview-host \
DEMO_CHROMIUM_PATH=/repl/tools/bin/chromium \
pnpm exec playwright test --config tests/browser/playwright.config.mjs \
  --project=chromium --reporter=html
```

Completed-card screenshots are attached to the HTML report (282×521, 322×521
and 352×521 pixels). No unexpected requests or page errors were reported.
The shipped HTML now shows the user bubble on its first frame, keeps the
animated bubbles from shrinking and scrolls to the reply/popup as they appear.
Passing Chromium does **not** establish Safari compatibility.
WebKit tests remain ready to run on a compatible host; even passing Playwright
WebKit would be automated engine coverage, not actual Safari-device verification.

## WebKit verification — 2026-10-10

**5/5 selected cases passed** on Playwright WebKit 26.6 (revision 2359),
Playwright 1.63.0, Linux x86_64 with Nix-provided libraries and Mesa software
rendering. See [the environment, commands and separate Safari-device
status](WEBKIT-VALIDATION.md). This supersedes the earlier *unavailable WebKit*
result for this selected layout/motion scope, not the other validation gaps.

**Actual Safari on an Apple device: not tested; no device was available.**

## Keyboard and accessible-name regression

Run only the four keyboard cases, without repeating the Hebrew layout suite:

```sh
DEMO_CHROMIUM_PATH=/repl/tools/bin/chromium \
  pnpm --filter @workspace/api-server run test:demo:browser \
  --project=chromium --grep='keyboard accessibility'
```

The cases verify:

- Native Enter and Space activation of pause/resume at a partial reply, frozen
  text while paused, continuation from that point, and focus retained through
  subsequent animation loops.
- The focused button's changing action name, both through accessible-name
  assertions and the browser accessibility snapshot, plus a visible focus outline.
- Tab and Shift+Tab order from the live-demo entry point through the message
  input, send, pause/resume and replay. Submitting a local message keeps input
  focus; deliberately resuming keeps control focus and preserves that message.
- Replay activation using both Enter and Space, its exposed accessible name,
  retained focus and preserved local messages.
- Pause, resume and replay remain enabled and keyboard-operable with reduced
  motion, including freezing the sequence until deliberate continuation.

On 2026-10-08 all **4/4 cases passed** in Chromium 152.0.7977.64 with
Playwright 1.63.0, and the VM/timer suite passed **21/21 cases**. No unexpected
requests or page errors occurred in these tests. Production HTML and bot code
were unchanged.

These are real-browser keyboard and accessibility-tree checks, **not** audible
screen-reader verification. They do not establish how NVDA or VoiceOver
announces a name change on an already-focused button. Actual assistive-technology
speech and Safari-device coverage require their respective environments.

### Firefox keyboard verification — 2026-10-10

All **4/4 cases passed** in Playwright Firefox **155.0**, revision **1543**,
with Playwright **1.63.0** on Linux x86_64. The same four cases also passed in
Chromium in the final combined run: **8/8 passed in 19.8 seconds**.
No unexpected requests or JavaScript page errors were reported.

The existing homepage now loads `brand-colors.css`; that specific same-origin
public stylesheet was added to the network allowlist. The entry-button selector
was updated to the current exact accessible name, `צפו בהדגמה`. No application
HTML, styles, playback code, bot code or bot workflow was changed.

This Nix host needed a coherent library path for the downloaded Firefox:

```sh
nix-instantiate --eval -E 'with import <nixpkgs> {}; lib.makeLibraryPath [
  gtk3 glib pango cairo atk gdk-pixbuf xorg.libX11 xorg.libX11.dev
  xorg.libxcb xorg.libXcomposite xorg.libXcursor xorg.libXdamage
  xorg.libXext xorg.libXfixes xorg.libXi xorg.libXrandr xorg.libXrender
  alsa-lib dbus stdenv.cc.cc.lib
]' | tr -d '"' > .cache/firefox-library-path

LD_LIBRARY_PATH="$(cat .cache/firefox-library-path)" \
DEMO_BASE_URL=http://localhost:80 \
DEMO_CHROMIUM_PATH=/repl/tools/bin/chromium \
pnpm --filter @workspace/api-server run test:demo:browser \
  --project=firefox --project=chromium --grep='keyboard accessibility' \
  --max-failures=1
```

The HTTPS development hostname initially failed with
`SEC_ERROR_UNKNOWN_ISSUER` in Firefox. The final run used the **same existing
preview through its local port-80 proxy**, not a separate server or static
fixture. Certificate checks were not disabled, the browser executable was not
modified, and Playwright's host preflight was not bypassed. `.cache/` and test
results are ignored generated local state. API, checkout and unrelated requests
remain blocked; the Telegram SDK remains locally fulfilled, and only the
already-allowed public font requests may go to their external hosts.

This validates native keyboard input and browser-exposed accessible names,
not audible screen-reader announcements. No Safari or additional Hebrew layout
tests were run for this verification.

## NVDA speech verification — 2026-10-10

**Blocked, not tested.** This workspace is Linux and no Windows host running
NVDA and Chrome was available. Windows, NVDA and Chrome versions therefore
remain unrecorded; there are no observed speech results. The earlier Chromium
accessible-name results above are not evidence of audible announcements.
No application changes were made and no speech defect was inferred.

To finish on a Windows host, record Windows, NVDA and Chrome versions, the
NVDA speech language/verbosity settings and the page revision tested. Capture
Speech Viewer output and listen to the announcements for each scenario:

- Focus pause during a partial reply. Use Enter to pause and resume while
  retaining focus; repeat independently with Space.
- Check both name changes: `השהיית ההדגמה המקומית` to
  `המשך ההדגמה המקומית מאותה נקודה`, and back again.
- Type in `כתבו הודעה להדגמה` while the demo is running, then submit a local
  message. Record announcements during typing/submission, Tab through send to
  the now-resume button, and activate resume with Enter and separately Space.
- For every transition, record the actual words and whether announcements
  are missing, duplicated, stale or confusing, distinguishing control-name
  announcements from demo-message live-region announcements.

Only fix a defect confirmed by this real NVDA run, then repeat the affected
scenario. Safari/iPhone and bot behavior are outside this verification.

## Native background lifecycle attempt — 2026-10-08

**Blocked, not passed.** No prolonged-background lifecycle assertions ran.
Both managed Chromium 140 and local headed Chromium 152.0.7977.64 kept the
original document `hidden=false`, `visibilityState='visible'`, with no native
`visibilitychange` after foregrounding another page. The headed attempt used
`DISPLAY=:0`, fluxbox and `/repl/tools/bin/chromium`, with Playwright's
`--disable-background-timer-throttling`, `--disable-renderer-backgrounding` and
`--disable-backgrounding-occluded-windows` arguments removed. Minimizing only
the test's own window via `xdotool` also did not produce hidden visibility.
The CDP command `Emulation.setPageVisibilityState` was unsupported.

A retry using a persistent (non-incognito) context, with `--enable-automation`
also removed, did not change this result. A further native window-state check
on `DISPLAY=:1` confirmed `Browser.getWindowBounds` reported `minimized` after
`Browser.setWindowBounds`, while the document still reported `hidden=false`
and no visibility event. Freezing/reactivating the page also did not produce
a hidden transition and was not counted as background-visibility coverage.

These are environment observations, not an application defect finding. No
visibility property overrides, synthetic events or fake clock were used.
An experimental lifecycle test stopped at the genuine-hidden-state gate; it
was not retained as a validated regression suite.

To finish verification, use a browser host that produces a native, trusted
hidden `visibilitychange`. With native wall-clock timers, hide the demo during
a partial reply for at least 65 seconds and verify unchanged text, indices,
remaining delay and no active demo timer. On return, verify one-character
progression without accelerated catch-up and only one timer chain. Repeat
during popup typing, with explicit user pause (which must persist until resume),
and through rapid hide/show cycles. Record native transitions, timing samples
and the browser environment. Headed Linux coverage would not establish actual
iOS/Android app-backgrounding or Safari-device coverage.
