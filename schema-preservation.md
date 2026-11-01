---
name: SQL schema preservation
description: Never approve destructive schema drift; keep ORM and development schemas aligned with existing production tables.
---

The user explicitly prohibits dropping or resetting existing SQL tables,
especially Google OAuth states, Mini App profiles and Calendar credentials.
Retain legacy columns even when the feature that originally used them is inactive.

**Why:** production-only tables created by runtime initialization were absent
from both the ORM and development database. Publish consequently proposed to
drop them. Preserving ORM declarations alone is insufficient: managed Publish
compares actual development and production schemas.

**How to apply:** compare production metadata read-only; represent every existing
table/column in the ORM and add missing development structure without copying
production user data. Never approve the old destructive Publish preview.
Regenerate its plan after alignment. Production changes go through managed
Publish, never custom production scripts or startup migration workarounds.

Use stable, existing constraint and index names when adopting a legacy table.
PostgreSQL truncates long generated FK names; preserving the actual existing
name avoids a spurious drop/recreate proposal for an unchanged relationship.
Never bypass the additive-only schema guard with a force push.
