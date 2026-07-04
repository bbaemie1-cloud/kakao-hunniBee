/**
 * Task Manager for KakaoTalk Admin Assistant
 * 
 * Manages active browser automation tasks, their lifecycle state,
 * and handles pause/resume flow using Deferred Promises.
 */

class Deferred {
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

class TaskManager {
  constructor() {
    this.tasks = new Map();
  }

  /**
   * Create a new automation task.
   * @param {string} taskId Unique task identifier.
   * @returns {Object} The created task object.
   */
  createTask(taskId) {
    if (this.tasks.has(taskId)) {
      throw new Error(`Task with ID ${taskId} already exists`);
    }

    const task = {
      taskId,
      status: 'RUNNING',
      currentUrl: null,
      error: null,
      deferred: null,
      createdAt: new Date()
    };

    this.tasks.set(taskId, task);
    return task;
  }

  /**
   * Retrieve a task by its ID.
   * @param {string} taskId 
   * @returns {Object|undefined} The task object.
   */
  getTask(taskId) {
    return this.tasks.get(taskId);
  }

  /**
   * Update task fields.
   * @param {string} taskId 
   * @param {Object} updates 
   */
  updateTask(taskId, updates) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task with ID ${taskId} not found`);
    }
    Object.assign(task, updates);
  }

  /**
   * Pauses the execution flow by returning a Deferred Promise.
   * The returned promise will block the Playwright worker until resolved by resumeTask.
   * Includes a built-in safety timeout.
   * 
   * @param {string} taskId 
   * @param {number} timeoutMs Safety timeout (defaults to 5 minutes / 300,000 ms)
   * @returns {Promise<string>} Resolves with the captcha code.
   */
  waitForResume(taskId, timeoutMs = 300000) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return Promise.reject(new Error(`Task ${taskId} not found`));
    }

    // Set state to PAUSED_SECURITY
    task.status = 'PAUSED_SECURITY';
    
    // Create Deferred Promise
    const deferred = new Deferred();
    task.deferred = deferred;

    // Set safety timeout to prevent hanging worker processes
    const timeoutId = setTimeout(() => {
      if (task.deferred === deferred) {
        const errorMsg = 'Timeout waiting for human-in-the-loop verification (CAPTCHA)';
        deferred.reject(new Error(errorMsg));
        task.status = 'FAILED';
        task.error = errorMsg;
        task.deferred = null;
      }
    }, timeoutMs);

    // Wrap the resolve and reject to clean up the timer
    const originalResolve = deferred.resolve;
    deferred.resolve = (value) => {
      clearTimeout(timeoutId);
      originalResolve(value);
    };

    const originalReject = deferred.reject;
    deferred.reject = (err) => {
      clearTimeout(timeoutId);
      originalReject(err);
    };

    return deferred.promise;
  }

  /**
   * Resumes a paused automation task by resolving its Deferred Promise.
   * @param {string} taskId 
   * @param {string} captchaCode The security code provided by the user.
   */
  resumeTask(taskId, captchaCode) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.status !== 'PAUSED_SECURITY' || !task.deferred) {
      throw new Error(`Task ${taskId} is not in a paused state`);
    }

    if (!captchaCode || typeof captchaCode !== 'string') {
      throw new Error('Valid captcha code is required to resume');
    }

    const deferred = task.deferred;
    task.deferred = null; // Clear from task to prevent reuse
    task.status = 'RUNNING';
    deferred.resolve(captchaCode);
  }

  /**
   * Rejects the Deferred Promise and transitions task to FAILED state.
   * Useful when server is shutting down, or flow is explicitly aborted.
   * 
   * @param {string} taskId 
   * @param {string} errorMessage 
   */
  failTask(taskId, errorMessage) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = 'FAILED';
    task.error = errorMessage || 'Task was aborted';
    
    if (task.deferred) {
      task.deferred.reject(new Error(task.error));
      task.deferred = null;
    }
  }

  /**
   * Remove a task from the manager (cleanup).
   * @param {string} taskId 
   */
  deleteTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task && task.deferred) {
      task.deferred.reject(new Error('Task was deleted'));
    }
    this.tasks.delete(taskId);
  }
}

// Export a singleton instance
module.exports = new TaskManager();
