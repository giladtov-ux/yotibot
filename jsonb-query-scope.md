---
name: JSONB query scope
description: Avoid accidental item-level correlation when reading canonical state through nested JSONB generators
---

Qualify the authoritative outer state JSON in nested PostgreSQL JSONB subqueries.

**Why:** JSONB set-returning functions expose a default column named `value`.
An unqualified reference can resolve to the current item rather than the whole
state, silently turning a related-event lookup into an empty array and treating
a future appointment's tracking task as today's task.

**How to apply:** use explicit table/column aliases for new nested projections;
test both a future linked appointment and a recurring occurrence delivered today.
Keep task completions separate from event delivery evidence.
