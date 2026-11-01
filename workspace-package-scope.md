---
name: Workspace package helper scope
description: Generic package helper success can leave leaf workspace dependencies unchanged.
---

Verify the affected leaf workspace manifest and lockfile, not just a generic package helper's success message.

**Why:** a package-removal helper reported success without removing the dependency from the bot's leaf workspace manifest or lockfile. Repeating it after a leaf manifest edit still did not synchronize the lockfile.

**How to apply:** keep dependency changes scoped to the intended workspace package and synchronize its lockfile through the workspace package manager when the generic helper does not handle that scope. Do not leave mismatched manifests and lockfiles that will fail a frozen production build.
