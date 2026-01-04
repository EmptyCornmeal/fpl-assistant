// tests/runTests.js
// Main test runner - imports and runs all test suites
// Phase 9: Minimum viable test coverage

import { runner } from "./testRunner.js";

// Import test suites
import "./transferOptimizer.test.js";
import "./statPicker.test.js";
import "./benchOptimizer.test.js";
import "./images.test.js";

// Run tests and output results
async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║         FPL Assistant - Phase 9 Unit Tests                 ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  const results = await runner.run();

  // Exit with appropriate code
  if (typeof process !== "undefined" && process.exit) {
    process.exit(results.failed > 0 ? 1 : 0);
  }

  return results;
}

// Run if executed directly
main().catch(console.error);

export { main as runTests };
