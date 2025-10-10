// Database operation queue to prevent concurrent access issues
// This ensures all database operations are serialized

class DatabaseQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
  }

  async execute(operation) {
    return new Promise((resolve, reject) => {
      this.queue.push({ operation, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const { operation, resolve, reject } = this.queue.shift();

      try {
        const result = await operation();
        resolve(result);
      } catch (err) {
        reject(err);
      }

      // Small delay to allow event loop to process other events
      await new Promise(r => setTimeout(r, 10));
    }

    this.isProcessing = false;
  }
}

export const dbQueue = new DatabaseQueue();
