# Local demo WebKit validation — 2026-10-10

## Results (separate environments)

| Environment | Result |
| --- | --- |
| Automated Playwright WebKit 26.6, revision 2359; Playwright 1.63.0; Linux x86_64, Nix stable-25_05 libraries, Mesa software rendering | **5/5 selected cases passed**, 17.3 seconds, with the current `homepage-neo.css` loaded |
| Safari on a physical iPhone/iPad/Mac | **Not performed.** No Apple device or remote Apple-device session was available to this agent. |

This is real WebKit DOM/layout execution, **not Safari-device verification**.
An iPhone-sized viewport is not an iPhone. No production URL, Telegram worker,
real reminder, payment, account or private user data was used.

## Verified behavior

- Loading the development preview at `/#demo` immediately shows the real Hebrew
  request and automatically progresses through the reply, reminder and completion.
- Full cycles at **320, 360 and 390 CSS pixels**, each 740 pixels high.
- Hebrew glyph rectangles progress right-to-left. Both time fields have isolated
  left-to-right glyphs at every intermediate `7`, `7:`, `7:3`, `7:30` state.
- Exact popup title, body, time and period; all popup fields and buttons stay
  inside the narrow card, with no horizontal conversation overflow.
- Local completion/deletion buttons are enabled and clickable; replay works,
  automatic completion/acknowledgement appear, and the loop fades/resets.
- With reduced-motion media emulation, progressive typing still works,
  decorative animation durations are reduced, and deletion/replay work.
- The suite reported no unexpected network requests or JavaScript page errors.
  A 320-pixel completed-card WebKit screenshot was also visually inspected.

The existing full-cycle cases pause briefly to capture the popup and click its
buttons; this does not claim long-background lifecycle coverage. Keyboard,
screen-reader speech, prolonged backgrounding and enlarged text were not part of
this selected run. The reduced-motion case uses 390 pixels; it does not establish
every possible combination of viewport, text scaling and OS accessibility settings.

## Network isolation adjustment

The homepage now includes public billing/Mini App scripts and styles. The old
test guard rejected these GETs before any application defect was found.
`demo.spec.mjs` now allows only those six explicitly named, same-origin static
assets, including `homepage-neo.css`, alongside the public document and fonts.
The external Telegram SDK is
fulfilled with an empty local JavaScript response. All other requests still
abort and fail the test, including API traffic and checkout. Thus this result
does **not** validate Telegram integration or billing. Application HTML, bot
code and payment behavior were not changed.

The initial 16.7-second passing run preceded the homepage's separate stylesheet
being added to this workspace. Completion checking caught the missing allowlist
entry. The final run loaded that stylesheet and passed all five cases in 17.3
seconds; the table above records this final run, not the earlier visual state.

## Host setup and command used

The downloaded browser alone still could not run. Mixing arbitrary Nix library
versions also failed (incompatible glibc dependencies). The successful setup used
a coherent library set evaluated from the configured Nix channel, with explicit
compatibility libraries for the browser's ICU 74, JPEG 8 and JXL 0.8 ABI.
No Node package versions or persistent system configuration were changed.

From the workspace root, the primary library path was evaluated with:

```sh
nix-instantiate --eval -E 'with import <nixpkgs> {}; lib.makeLibraryPath [
  glib gtk4 pango harfbuzz gdk-pixbuf cairo vulkan-loader graphene libxml2
  sqlite libxslt lcms2 libevent libopus gst_all_1.gstreamer
  gst_all_1.gst-plugins-base gst_all_1.gst-plugins-bad flite libwebp libavif
  harfbuzzFull libepoxy libjpeg_turbo xorg.libX11 wayland libmanette enchant2
  mesa libdrm hyphen libsecret atk at-spi2-atk libxkbcommon libglvnd x264
  stdenv.cc.cc.lib libgbm gst_all_1.gst-libav libsoup_3 libbacktrace
]' | tr -d '"'
```

The compatibility directories appended in this environment were:

```text
/nix/store/12mwjnja5rwxmxay4svjz81lmy3cv3ss-icu4c-74.2/lib
/nix/store/40rjm9f2dcphg8d2g9by6l5dah1mmhwm-libjxl-0.8.1/lib
/nix/store/4l3nrjbh9gswcwgvnad6gf384fpd185p-libjpeg-turbo-3.0.4/lib
```

The resulting path was saved as generated, ignored local state in
`.cache/webkit-library-path`. Both downloaded `minibrowser-{wpe,gtk}/MiniBrowser`
shell wrappers reset `LD_LIBRARY_PATH`; their cached copies were adjusted from
`"${MYDIR}/lib:${MYDIR}/sys/lib"` to
`"${MYDIR}/lib:${MYDIR}/sys/lib:${LD_LIBRARY_PATH:-}"`. No browser executable
or rendering engine was modified. A clean browser download loses this local
wrapper adjustment. These store paths are host-specific, not portable packages.

The successful command was:

```sh
GIO=$(nix-instantiate --eval -E \
  '(import <nixpkgs> {}).glib-networking.outPath' | tr -d '"')
LD_LIBRARY_PATH="$(cat .cache/webkit-library-path)" \
GIO_EXTRA_MODULES="$GIO/lib/gio/modules" \
PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 \
LIBGL_ALWAYS_SOFTWARE=1 \
__EGL_VENDOR_LIBRARY_FILENAMES=/nix/store/cpwib3zazj49fm0y04y53w4xkbqsgrgm-mesa-25.0.7/share/glvnd/egl_vendor.d/50_mesa.json \
pnpm --filter @workspace/api-server run test:demo:browser \
  --project=webkit \
  --grep='page load immediately|full progressive Hebrew|reduced motion autoplays' \
  --max-failures=1
```

The host preflight was explicitly bypassed because its dynamic-library check
consults `/sbin/ldconfig`, which does not list these Nix GLES/GStreamer libraries.
Both MiniBrowser executables were checked with `ldd` using the configured library
paths and their bundled libraries before execution. This bypass does **not**
skip any selected test or assertion. EGL software rendering and GLib TLS modules
were required to open a page and load the HTTPS development preview/fonts.

On a normally supported host, use an unmodified Playwright WebKit installation
with its supported host dependencies and run the same selected command without
these Nix-specific environment variables. Use `DEMO_BASE_URL` for the development
preview if `REPLIT_DEV_DOMAIN` is unavailable. Do not target production.

Generated screenshots are under `tests/browser/results/`, including
`demo-full-progressive-Hebrew-cycle-fits-at-{320,360,390}px-webkit/video-completed.png`.
They are ignored outputs and may be overwritten by later runs.

## Physical Safari checklist (not executed)

If an Apple device becomes available, open the **development preview** at
`/#demo` in Safari and record its model, iOS/macOS version, Safari version,
date, viewport and evidence. Watch Hebrew and both `7:30` fields through typing;
confirm fields and local buttons fit the narrow card, and click local actions
and replay. Repeat with the device's Reduce Motion setting enabled. Do not
register, check out or create a real reminder. Keep this device result separate
from the automated WebKit row above; leave it unverified until actually performed.
