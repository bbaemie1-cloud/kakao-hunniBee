class TaskManager {
  constructor() {
    this.tasks = new Map();
    this.recentTerminalStatuses = new Map();
  }

  createTask(taskId, formData) {
    const correctCaptcha = String(Math.floor(100000 + Math.random() * 900000));
    const task = {
      taskId,
      status: 'RUNNING',
      currentUrl: '',
      error: null,
      formData: formData || {},
      deferred: null,
      captchaCode: null,
      correctCaptcha,
      captchaText: null,
      timeoutId: null,
      attempts: 0
    };
    this.tasks.set(taskId, task);
    return task;
  }

  getTask(taskId) {
    return this.tasks.get(taskId) || this.recentTerminalStatuses.get(taskId);
  }

  updateTask(taskId, updates) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    if (updates.status === 'COMPLETED') {
      if (updates.currentUrl !== undefined) {
        task.currentUrl = updates.currentUrl;
      }
      this.completeTask(taskId);
      return;
    }

    if (updates.status === 'FAILED') {
      if (updates.currentUrl !== undefined) {
        task.currentUrl = updates.currentUrl;
      }
      this.failTask(taskId, updates.error || 'Failed');
      return;
    }

    Object.assign(task, updates);
  }

  pauseTask(taskId, captchaText, timeoutMs = 300000) {
    if (this.recentTerminalStatuses.has(taskId)) {
      const termInfo = this.recentTerminalStatuses.get(taskId);
      if (termInfo.status === 'COMPLETED') {
        throw new Error('Cannot pause a completed task');
      }
      if (termInfo.status === 'FAILED') {
        throw new Error('Cannot pause a failed task');
      }
    }

    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    if (task.deferred) {
      task.deferred.resolve('CANCELLED');
      task.deferred = null;
    }

    if (timeoutMs <= 0) {
      task.status = 'FAILED';
      task.error = 'Task paused due to security check timed out';
      return Promise.reject(new Error('Task paused due to security check timed out'));
    }

    task.status = 'PAUSED_SECURITY';
    task.captchaText = captchaText;

    if (task.timeoutId) {
      clearTimeout(task.timeoutId);
    }

    task.timeoutId = setTimeout(() => {
      this.failTask(taskId, `Task paused due to security check timed out`);
    }, timeoutMs);

    let resolveFn;
    let rejectFn;
    const promise = new Promise((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    task.deferred = {
      promise,
      resolve: resolveFn,
      reject: rejectFn
    };

    return promise;
  }

  resumeTask(taskId, captchaCode) {
    const task = this.getTask(taskId);
    if (!task) return { success: false, error: 'Task not found' };
    
    if (task.status !== 'PAUSED_SECURITY' || !task.deferred) {
      return { success: false, error: 'Task is not paused' };
    }

    if (captchaCode !== task.correctCaptcha) {
      task.attempts = (task.attempts || 0) + 1;
      if (task.attempts >= 5) {
        this.failTask(taskId, 'Too many invalid captcha attempts');
        return { success: false, error: 'Too many invalid captcha attempts. Task failed.' };
      }
      return { success: false, error: 'Invalid captcha code' };
    }

    if (task.timeoutId) {
      clearTimeout(task.timeoutId);
      task.timeoutId = null;
    }

    task.status = 'RUNNING';
    task.captchaCode = captchaCode;

    if (task.deferred) {
      task.deferred.resolve(captchaCode);
    }
    task.deferred = null;

    return { success: true, message: 'Resume signal received. Processing captcha...' };
  }

  completeTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task || task.status === 'FAILED') return;

    if (task.timeoutId) {
      clearTimeout(task.timeoutId);
      task.timeoutId = null;
    }

    task.status = 'COMPLETED';

    if (task.deferred) {
      task.deferred.resolve();
    }
    task.deferred = null;

    this.recentTerminalStatuses.set(taskId, {
      taskId,
      status: 'COMPLETED',
      currentUrl: task.currentUrl,
      error: task.error || null,
      deferred: null,
      timeoutId: null,
      formData: task.formData || {},
      correctCaptcha: task.correctCaptcha,
      captchaCode: task.captchaCode,
      captchaText: task.captchaText
    });

    if (this.recentTerminalStatuses.size > 100) {
      const oldestKey = this.recentTerminalStatuses.keys().next().value;
      this.recentTerminalStatuses.delete(oldestKey);
    }

    this.tasks.delete(taskId);
  }

  failTask(taskId, errorMessage) {
    const task = this.tasks.get(taskId);
    if (!task || task.status === 'COMPLETED') return;

    if (task.timeoutId) {
      clearTimeout(task.timeoutId);
      task.timeoutId = null;
    }

    task.status = 'FAILED';
    task.error = errorMessage;

    if (task.deferred) {
      task.deferred.reject(new Error(errorMessage));
    }
    task.deferred = null;

    this.recentTerminalStatuses.set(taskId, {
      taskId,
      status: 'FAILED',
      currentUrl: task.currentUrl,
      error: task.error || errorMessage,
      deferred: null,
      timeoutId: null,
      formData: task.formData || {},
      correctCaptcha: task.correctCaptcha,
      captchaCode: task.captchaCode,
      captchaText: task.captchaText
    });

    if (this.recentTerminalStatuses.size > 100) {
      const oldestKey = this.recentTerminalStatuses.keys().next().value;
      this.recentTerminalStatuses.delete(oldestKey);
    }

    this.tasks.delete(taskId);
  }

  cancelTask(taskId, reason = 'Cancelled') {
    const task = this.tasks.get(taskId);
    if (!task) return { success: false, error: 'Task not found' };
    if (task.status === 'COMPLETED' || task.status === 'FAILED') {
      return { success: false, error: `Task is already in terminal state: ${task.status}` };
    }
    task.status = 'FAILED';
    task.error = reason;
    if (task.timeoutId) {
      clearTimeout(task.timeoutId);
      task.timeoutId = null;
    }
    if (task.deferred) {
      task.deferred.resolve('CANCELLED');
      task.deferred = null;
    }

    this.recentTerminalStatuses.set(taskId, {
      taskId,
      status: 'FAILED',
      currentUrl: task.currentUrl,
      error: task.error || reason,
      deferred: null,
      timeoutId: null,
      formData: task.formData || {},
      correctCaptcha: task.correctCaptcha,
      captchaCode: task.captchaCode,
      captchaText: task.captchaText
    });

    if (this.recentTerminalStatuses.size > 100) {
      const oldestKey = this.recentTerminalStatuses.keys().next().value;
      this.recentTerminalStatuses.delete(oldestKey);
    }

    this.tasks.delete(taskId);
    return { success: true, message: `Task ${taskId} cancelled successfully` };
  }
}

module.exports = new TaskManager();
