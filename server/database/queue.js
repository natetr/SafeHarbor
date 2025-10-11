// Database operation queue to prevent concurrent access issues
// This ensures all database operations are serialized

// Import zimLogger for queue monitoring
let zimLogger = null;
let loggerInitAttempted = false;

// Lazy load zimLogger to avoid circular dependency
async function getZimLogger() {
  if (zimLogger) return zimLogger;
  if (loggerInitAttempted) return null;

  try {
    loggerInitAttempted = true;
    const module = await import('../utils/zimLogger.js');
    zimLogger = module.zimLogger;
    return zimLogger;
  } catch (err) {
    // Logger not available yet (during startup)
    return null;
  }
}

class DatabaseQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.totalOperations = 0;
    this.completedOperations = 0;
    this.failedOperations = 0;
    this.totalWaitTime = 0;
    this.maxQueueDepth = 0;
    this.lastStatsLog = Date.now();
    this.lastQueueWarning = 0;
  }

  async execute(operation) {
    const queuedAt = Date.now();
    this.totalOperations++;

    // Track max queue depth
    if (this.queue.length > this.maxQueueDepth) {
      this.maxQueueDepth = this.queue.length;
    }

    // Warn if queue is getting long (potential contention)
    // Only log once every 10 seconds to avoid spam
    if (this.queue.length > 10 && (Date.now() - this.lastQueueWarning) > 10000) {
      this.lastQueueWarning = Date.now();
      console.warn(`⚠️  Database queue depth: ${this.queue.length} operations waiting`);

      // Use zimLogger if available
      const logger = await getZimLogger();
      if (logger) {
        logger.database.logQueueWarning(this.queue.length, {
          maxQueueDepth: this.maxQueueDepth,
          totalOperations: this.totalOperations
        });
      }
    }

    return new Promise((resolve, reject) => {
      this.queue.push({ operation, resolve, reject, queuedAt });
      this.process();
    });
  }

  async process() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const { operation, resolve, reject, queuedAt } = this.queue.shift();
      const waitTime = Date.now() - queuedAt;
      this.totalWaitTime += waitTime;

      // Warn if an operation waited too long in queue
      if (waitTime > 5000) {
        console.warn(`⚠️  Database operation waited ${waitTime}ms in queue`);
      }

      try {
        const result = await operation();
        this.completedOperations++;
        resolve(result);
      } catch (err) {
        this.failedOperations++;
        console.error('❌ Queued database operation failed:', err.message);
        reject(err);
      }

      // Small delay to allow event loop to process other events
      await new Promise(r => setTimeout(r, 10));
    }

    this.isProcessing = false;

    // Log statistics every 5 minutes
    if (Date.now() - this.lastStatsLog > 300000) {
      this.logStats();
      this.lastStatsLog = Date.now();
    }
  }

  logStats() {
    const avgWaitTime = this.totalOperations > 0
      ? Math.round(this.totalWaitTime / this.totalOperations)
      : 0;

    console.log('📊 Database Queue Statistics:');
    console.log(`   Total operations: ${this.totalOperations}`);
    console.log(`   Completed: ${this.completedOperations}`);
    console.log(`   Failed: ${this.failedOperations}`);
    console.log(`   Average wait time: ${avgWaitTime}ms`);
    console.log(`   Max queue depth: ${this.maxQueueDepth}`);
  }

  getStats() {
    return {
      totalOperations: this.totalOperations,
      completedOperations: this.completedOperations,
      failedOperations: this.failedOperations,
      averageWaitTime: this.totalOperations > 0
        ? Math.round(this.totalWaitTime / this.totalOperations)
        : 0,
      maxQueueDepth: this.maxQueueDepth,
      currentQueueDepth: this.queue.length
    };
  }
}

export const dbQueue = new DatabaseQueue();
