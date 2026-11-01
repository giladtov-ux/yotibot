---
name: Git provider authorization
description: Distinguish a connected GitHub account from successful CLI write authentication
---

An active GitHub connection, or a healthy authorization-status response, is not
proof that the git/gh transport can authenticate a write. Verify the remote
branch before reporting that prepared changes were uploaded.

**Why:** a connected provider reported healthy authorization while gh had no
authenticated session and git push rejected the credential. Read-only access
to the public repository still worked, concealing the write failure.

**How to apply:** preserve the prepared local branch when a write is rejected.
Follow the integrations skill's authorization-recovery flow rather than reading
tokens, asking for credentials in chat or repeatedly retrying an unchanged
authentication setup. Report local validation and remote publication separately.

Do not assume the generic integration API client is available merely because
the Git-provider connection is active.

**Why:** the Git-provider setup advertised CLI access, but an alternative
generic API connection was unavailable in the same context as the rejected
push.

**How to apply:** use the instructions returned for the actual provider. If
both the authenticated transport and the documented alternative are unavailable,
keep the prepared work and request authorization recovery rather than retrying
unchanged routes or claiming the remote repository was updated.

When the user explicitly chooses PAT authentication, an operation-scoped
credential helper is an acceptable alternative to a broken OAuth transport.
Keep the token in Replit Secrets, never in the remote URL, Git config, source
files or command arguments.

**Why:** an explicitly approved PAT push succeeded through an ephemeral helper
after the provider-backed CLI rejected authentication. Clearing inherited
credential helpers for that operation avoided reusing the rejected credential.

**How to apply:** disable credential helpers and trace output only for the
authenticated command, pass the secret through the helper's environment, remove
the helper afterwards, and verify both the uploaded branch and unchanged main.
Do not infer authorization to merge or activate production from approval to push.
