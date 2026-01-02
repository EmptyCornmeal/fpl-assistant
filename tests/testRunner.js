// tests/testRunner.js
// Minimal test harness for FPL Assistant
// Phase 9: Unit testing without external dependencies

/**
 * Simple test runner that works in browser and Node.js-like environments
 */
export class TestRunner {
  constructor() {
    this.suites = [];
    this.currentSuite = null;
    this.results = {
      passed: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };
  }

  /**
   * Define a test suite
   * @param {string} name - Suite name
   * @param {Function} fn - Suite function containing tests
   */
  describe(name, fn) {
    const suite = {
      name,
      tests: [],
      beforeAll: null,
      afterAll: null,
      beforeEach: null,
      afterEach: null,
    };
    this.suites.push(suite);
    this.currentSuite = suite;
    fn();
    this.currentSuite = null;
  }

  /**
   * Define a test
   * @param {string} name - Test name
   * @param {Function} fn - Test function
   */
  it(name, fn) {
    if (!this.currentSuite) {
      throw new Error("it() must be called inside describe()");
    }
    this.currentSuite.tests.push({ name, fn, skip: false });
  }

  /**
   * Skip a test
   */
  skip(name, fn) {
    if (!this.currentSuite) {
      throw new Error("skip() must be called inside describe()");
    }
    this.currentSuite.tests.push({ name, fn, skip: true });
  }

  /**
   * Run before all tests in suite
   */
  beforeAll(fn) {
    if (this.currentSuite) this.currentSuite.beforeAll = fn;
  }

  /**
   * Run after all tests in suite
   */
  afterAll(fn) {
    if (this.currentSuite) this.currentSuite.afterAll = fn;
  }

  /**
   * Run before each test
   */
  beforeEach(fn) {
    if (this.currentSuite) this.currentSuite.beforeEach = fn;
  }

  /**
   * Run after each test
   */
  afterEach(fn) {
    if (this.currentSuite) this.currentSuite.afterEach = fn;
  }

  /**
   * Run all tests
   * @returns {Object} Test results
   */
  async run() {
    const startTime = Date.now();
    this.results = { passed: 0, failed: 0, skipped: 0, errors: [] };

    for (const suite of this.suites) {
      console.log(`\n📦 ${suite.name}`);

      try {
        if (suite.beforeAll) await suite.beforeAll();

        for (const test of suite.tests) {
          if (test.skip) {
            console.log(`  ⏭️  ${test.name} (skipped)`);
            this.results.skipped++;
            continue;
          }

          try {
            if (suite.beforeEach) await suite.beforeEach();
            await test.fn();
            if (suite.afterEach) await suite.afterEach();

            console.log(`  ✅ ${test.name}`);
            this.results.passed++;
          } catch (error) {
            console.log(`  ❌ ${test.name}`);
            console.log(`     Error: ${error.message}`);
            this.results.failed++;
            this.results.errors.push({
              suite: suite.name,
              test: test.name,
              error: error.message,
              stack: error.stack,
            });
          }
        }

        if (suite.afterAll) await suite.afterAll();
      } catch (error) {
        console.log(`  ⚠️  Suite error: ${error.message}`);
        this.results.errors.push({
          suite: suite.name,
          test: "(suite setup/teardown)",
          error: error.message,
        });
      }
    }

    const duration = Date.now() - startTime;
    this.printSummary(duration);
    return this.results;
  }

  printSummary(duration) {
    const { passed, failed, skipped } = this.results;
    const total = passed + failed + skipped;

    console.log("\n" + "─".repeat(50));
    console.log(`📊 Test Results: ${passed}/${total} passed`);
    console.log(`   ✅ Passed: ${passed}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   ⏱️  Duration: ${duration}ms`);
    console.log("─".repeat(50));

    if (failed > 0) {
      console.log("\n❌ Failed Tests:");
      this.results.errors.forEach((err, i) => {
        console.log(`\n${i + 1}. ${err.suite} > ${err.test}`);
        console.log(`   ${err.error}`);
      });
    }
  }
}

/**
 * Assertion helpers
 */
export const assert = {
  /**
   * Assert value is truthy
   */
  ok(value, message = "Expected truthy value") {
    if (!value) throw new Error(message);
  },

  /**
   * Assert strict equality
   */
  equal(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(message || `Expected ${expected}, got ${actual}`);
    }
  },

  /**
   * Assert deep equality
   */
  deepEqual(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        message || `Deep equality failed:\nExpected: ${JSON.stringify(expected)}\nGot: ${JSON.stringify(actual)}`
      );
    }
  },

  /**
   * Assert value is within range
   */
  inRange(value, min, max, message) {
    if (value < min || value > max) {
      throw new Error(message || `Expected ${value} to be between ${min} and ${max}`);
    }
  },

  /**
   * Assert array contains value
   */
  contains(array, value, message) {
    if (!array.includes(value)) {
      throw new Error(message || `Expected array to contain ${value}`);
    }
  },

  /**
   * Assert array length
   */
  lengthOf(array, length, message) {
    if (array.length !== length) {
      throw new Error(message || `Expected length ${length}, got ${array.length}`);
    }
  },

  /**
   * Assert function throws
   */
  throws(fn, message) {
    let threw = false;
    try {
      fn();
    } catch (e) {
      threw = true;
    }
    if (!threw) {
      throw new Error(message || "Expected function to throw");
    }
  },

  /**
   * Assert async function throws
   */
  async rejects(fn, message) {
    let threw = false;
    try {
      await fn();
    } catch (e) {
      threw = true;
    }
    if (!threw) {
      throw new Error(message || "Expected promise to reject");
    }
  },

  /**
   * Assert value is an instance of type
   */
  instanceOf(value, type, message) {
    if (!(value instanceof type)) {
      throw new Error(message || `Expected instance of ${type.name}`);
    }
  },

  /**
   * Assert value has property
   */
  hasProperty(obj, prop, message) {
    if (!(prop in obj)) {
      throw new Error(message || `Expected object to have property "${prop}"`);
    }
  },

  /**
   * Assert value is approximately equal (for floating point)
   */
  approximately(actual, expected, delta = 0.001, message) {
    if (Math.abs(actual - expected) > delta) {
      throw new Error(message || `Expected ${actual} to be approximately ${expected} (±${delta})`);
    }
  },
};

// Global test runner instance
export const runner = new TestRunner();

// Shorthand exports
export const describe = (name, fn) => runner.describe(name, fn);
export const it = (name, fn) => runner.it(name, fn);
export const skip = (name, fn) => runner.skip(name, fn);
export const beforeAll = (fn) => runner.beforeAll(fn);
export const afterAll = (fn) => runner.afterAll(fn);
export const beforeEach = (fn) => runner.beforeEach(fn);
export const afterEach = (fn) => runner.afterEach(fn);

export default runner;
