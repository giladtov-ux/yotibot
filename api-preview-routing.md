---
name: API preview routing
description: Development-preview path behavior affecting API route smoke tests.
---

The previous internal bot port collided with the mockup Vite service, causing forwarded requests to return a Vite base-path (`/__mockup`) 404. This does not mean the Express API route itself is absent.

**Why:** earlier diagnostics mistook the upstream Vite response for a failure to register the API route.

**How to apply:** reserve a private bot port distinct from all registered artifact service ports, and verify the upstream service identity rather than treating any open port as a healthy bot. Do not add `/__mockup` to production webhook URLs.