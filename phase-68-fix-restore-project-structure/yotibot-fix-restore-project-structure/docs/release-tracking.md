# Release and Build Identity

## Phase 105 candidate baseline

- Annotated tag: `phase-106-baseline-6bd4a6b2`
- Exact tagged commit: `6bd4a6b2b6baa56570f95476e7df2adeb096dc6f`
- Tagged tree: `a9ec88e51c8e4a6cda0674db420a457ea4d1bc05`
- The tag is local only; it has not been pushed and no deployment was started.

The working tree for Phase 106 is based on the commit immediately after that baseline. The baseline tag intentionally remains fixed to the requested commit; do not move it to a later commit.

## Build metadata

The API build records:

- `id`: nearest Git tag plus distance and abbreviated source SHA, or `git-<short-sha>` when no tag is reachable; a dirty source tree appends `-dirty-<12-char content fingerprint>` so separate uncommitted builds are distinguishable.
- `commit`: full 40-character commit SHA, preferring the hosting build's `RENDER_GIT_COMMIT`, then `GIT_COMMIT_SHA`, then local Git `HEAD`.
- `releaseTag`: exact tag name only when the built commit is itself tagged; otherwise `null`.
- `dirty`: whether tracked or untracked source changes existed when the build ran.

The values are embedded at build time and returned by `/api/healthz` under `build`. They contain no secrets. A missing full commit SHA causes the build to fail rather than report an invented identifier. The `AH_SHELI_BUILD_ID` build override is optional; do not use it to conceal the source commit.

Example inspection:

```sh
git show --no-patch --format=fuller phase-106-baseline-6bd4a6b2
git rev-parse phase-106-baseline-6bd4a6b2^{tree}
curl -fsS "$STAGING_ORIGIN/api/healthz"
```

Do not print secret environment values while gathering release evidence. Record the health response's build fields and compare the commit to the approved source revision.

## Release boundary

The baseline tag is provenance, not approval to release. Phase 106 creates no deployment or Production configuration change. Only a clean, reviewed candidate with matching build identity and explicit human approval can enter a separate release/cutover process.
