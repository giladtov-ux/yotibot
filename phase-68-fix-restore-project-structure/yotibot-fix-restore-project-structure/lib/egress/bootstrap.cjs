"use strict";

// Import this before application modules in every executable entry point.
// The process exits by throwing before app startup unless approval is explicit.
require("./egress-gate.cjs").installProcessEgressGuard(process.env);
