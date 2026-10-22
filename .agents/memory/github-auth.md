---
name: GitHub authentication paths
description: Replit's GitHub identity, Git pane provider link, Agent connector, and shell Git credentials are separate authentication paths.
---

A GitHub account shown as active for commit attribution does not necessarily provide credentials to `git` in the Shell. The Replit Agent GitHub connector can also remain unavailable to the Agent even when account linking appears active.

**Why:** In this workspace, HTTPS Git operations continued to reject authentication, the SSH agent had no listed identity, and the Agent connector remained `connect` after an attach attempt.

**How to apply:** Before a remote write, verify which path is actually authorized: connect the repository in Replit's Git pane, or use GitHub CLI's browser-based login followed by `gh auth setup-git` if the user approves. Never request or place a personal access token in chat or a remote URL.
