---
name: Browser engine availability
description: WebKit validation requires a compatible host, not just a downloaded Playwright browser
---

Do not assume Playwright WebKit is usable in this workspace after downloading it.
The default launch can lack GTK, ICU, GStreamer and related Linux runtime
libraries, while the supplied Chromium executable works. A compatible Nix-backed
WebKit runtime has since been demonstrated; do not treat the earlier missing
libraries as a permanent prohibition.

**Why:** downloading the WebKit binary succeeded but did not make its host
dependencies available. Treating the download as validation would falsely imply
Safari coverage.

**How to apply:** check whether the selected browser actually launched and ran
assertions. Report an unavailable engine separately from passing Chromium.
If Safari validation is needed, use a compatible WebKit host or an actual Apple
device and say exactly which was used.

Firefox can reject the development HTTPS hostname with
`SEC_ERROR_UNKNOWN_ISSUER` even when other browsers and curl accept it.

**Why:** the downloaded Firefox uses a different trust store from the host.

**How to apply:** for local preview-only interaction checks, use the same
existing preview through its local port-80 proxy, keeping the network guard
intact. Do not disable certificate checks or claim this verifies HTTPS trust.
Use the browser-suite environment report for the required Nix runtime libraries.

Use a coherent Nix-channel library set, not arbitrary first-matching store
entries. Browser wrappers may reset the supplied library path; rendering needs
an explicit Mesa EGL provider and HTTPS needs GLib's TLS modules. A host
preflight that only checks ldconfig can miss valid Nix libraries.

**Why:** arbitrary store entries mixed incompatible glibc versions; satisfying
linking alone did not provide EGL rendering or TLS. Disabling a preflight was
not evidence of success; actual browser assertions were still required.

**How to apply:** consult the browser tests' environment report before adapting
the runtime. Prefer a supported host when available. Never equate these Linux
runtime adjustments or passing engine assertions with physical Apple coverage.

Native background validation also requires evidence that the document actually
became hidden. In this workspace, both the managed browser and headed local
Chromium on X11 kept `document.hidden` false after foregrounding another page;
targeted window minimization also did not produce a native visibility event,
even with Playwright's background-disabling flags removed.
Persistent contexts without the automation flag did not resolve this.
Chromium also reported its window genuinely minimized through its browser
window API while the document remained visible.

**Why:** a visible window change is not sufficient evidence of a document
visibility transition, and the attempted CDP visibility setter was unsupported.

**How to apply:** assert native hidden visibility and a trusted event before
running long-background checks. If the gate fails, report blocked coverage;
do not replace it with fabricated visibility or count skipped tests as passes.
