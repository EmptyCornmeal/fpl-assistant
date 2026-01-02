// js/lib/memoize.js
// Performance utilities for memoization and caching

/**
 * Creates a memoized version of an async function with TTL support
 * @param {Function} fn - Async function to memoize
 * @param {Object} options - Configuration options
 * @param {Function} options.keyFn - Function to generate cache key from arguments
 * @param {number} options.ttl - Time-to-live in milliseconds (default: 5 minutes)
 * @param {number} options.maxSize - Maximum cache size (default: 1000)
 * @returns {Function} Memoized async function with .clear() and .stats() methods
 */
export function memoizeAsync(fn, options = {}) {
  const {
    keyFn = (...args) => JSON.stringify(args),
    ttl = 5 * 60 * 1000, // 5 minutes
    maxSize = 1000,
  } = options;

  const cache = new Map();
  let hits = 0;
  let misses = 0;

  const memoized = async function (...args) {
    const key = keyFn(...args);
    const now = Date.now();

    // Check cache
    if (cache.has(key)) {
      const { value, expiry } = cache.get(key);
      if (now < expiry) {
        hits++;
        return value;
      }
      // Expired - remove
      cache.delete(key);
    }

    // Cache miss - compute
    misses++;
    const result = await fn.apply(this, args);

    // Evict oldest if at capacity
    if (cache.size >= maxSize) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }

    cache.set(key, { value: result, expiry: now + ttl });
    return result;
  };

  memoized.clear = () => {
    cache.clear();
    hits = 0;
    misses = 0;
  };

  memoized.stats = () => ({
    size: cache.size,
    hits,
    misses,
    hitRate: hits + misses > 0 ? (hits / (hits + misses) * 100).toFixed(1) + '%' : '0%',
  });

  memoized.invalidate = (key) => cache.delete(key);

  return memoized;
}

/**
 * Creates a simple sync memoization function
 * @param {Function} fn - Function to memoize
 * @param {Function} keyFn - Function to generate cache key
 * @returns {Function} Memoized function
 */
export function memoize(fn, keyFn = (...args) => JSON.stringify(args)) {
  const cache = new Map();

  const memoized = function (...args) {
    const key = keyFn(...args);
    if (cache.has(key)) {
      return cache.get(key);
    }
    const result = fn.apply(this, args);
    cache.set(key, result);
    return result;
  };

  memoized.clear = () => cache.clear();
  memoized.has = (key) => cache.has(key);
  memoized.get = (key) => cache.get(key);

  return memoized;
}

/**
 * Batch async operations with concurrency control
 * @param {Array} items - Items to process
 * @param {Function} asyncFn - Async function to apply to each item
 * @param {Object} options - Configuration options
 * @param {number} options.concurrency - Max concurrent operations (default: 10)
 * @param {Function} options.onProgress - Progress callback (done, total)
 * @returns {Promise<Array>} Results in same order as input
 */
export async function batchAsync(items, asyncFn, options = {}) {
  const {
    concurrency = 10,
    onProgress = null,
  } = options;

  const results = new Array(items.length);
  let completed = 0;

  const processItem = async (item, index) => {
    try {
      results[index] = await asyncFn(item, index);
    } catch (error) {
      results[index] = { error, item };
    }
    completed++;
    if (onProgress) {
      onProgress(completed, items.length);
    }
  };

  // Process in batches with concurrency limit
  const queue = items.map((item, index) => ({ item, index }));
  const workers = [];

  for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const { item, index } = queue.shift();
        await processItem(item, index);
      }
    })());
  }

  await Promise.all(workers);
  return results;
}

/**
 * Parallel map with concurrency control (like Promise.all but throttled)
 * @param {Array} items - Items to process
 * @param {Function} asyncFn - Async function to apply
 * @param {number} concurrency - Max concurrent operations
 * @returns {Promise<Array>} Results array
 */
export async function parallelMap(items, asyncFn, concurrency = 10) {
  const results = [];
  const executing = [];

  for (const [index, item] of items.entries()) {
    const promise = Promise.resolve().then(() => asyncFn(item, index));
    results.push(promise);

    if (items.length >= concurrency) {
      const e = promise.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);

      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }
  }

  return Promise.all(results);
}

/**
 * Debounce function - delays execution until after wait ms have elapsed
 * @param {Function} fn - Function to debounce
 * @param {number} wait - Debounce delay in ms
 * @returns {Function} Debounced function with .cancel() method
 */
export function debounce(fn, wait = 300) {
  let timeoutId = null;

  const debounced = function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), wait);
  };

  debounced.cancel = () => clearTimeout(timeoutId);
  debounced.flush = function (...args) {
    clearTimeout(timeoutId);
    return fn.apply(this, args);
  };

  return debounced;
}

/**
 * Throttle function - ensures fn is called at most once per wait ms
 * @param {Function} fn - Function to throttle
 * @param {number} wait - Throttle interval in ms
 * @returns {Function} Throttled function
 */
export function throttle(fn, wait = 300) {
  let lastTime = 0;
  let timeoutId = null;

  return function (...args) {
    const now = Date.now();
    const remaining = wait - (now - lastTime);

    if (remaining <= 0) {
      clearTimeout(timeoutId);
      lastTime = now;
      return fn.apply(this, args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastTime = Date.now();
        timeoutId = null;
        fn.apply(this, args);
      }, remaining);
    }
  };
}

export default {
  memoizeAsync,
  memoize,
  batchAsync,
  parallelMap,
  debounce,
  throttle,
};
