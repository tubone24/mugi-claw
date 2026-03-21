import cron from 'node-cron';
import type { Logger } from 'pino';
import type { ScheduledTask } from '../types.js';
import type { TaskStore } from './task-store.js';
import type { TaskRunner } from './task-runner.js';
import type { Notifier } from '../slack/notifier.js';

export class Scheduler {
  private jobs = new Map<string, cron.ScheduledTask>();

  constructor(
    private taskStore: TaskStore,
    private taskRunner: TaskRunner,
    private notifier: Notifier,
    private logger: Logger,
  ) {}

  /** Load all enabled tasks from DB and register cron jobs */
  initialize(): void {
    const tasks = this.taskStore.getEnabledTasks();
    for (const task of tasks) {
      this.registerJob(task);
    }
    this.logger.info({ count: tasks.length }, 'スケジューラ初期化完了');
  }

  /** Add and start a new task */
  addTask(task: ScheduledTask): void {
    if (task.enabled) {
      this.registerJob(task);
    }
  }

  /** Remove a task's cron job */
  removeTask(taskId: string): void {
    const job = this.jobs.get(taskId);
    if (job) {
      void job.stop();
      this.jobs.delete(taskId);
      this.logger.info({ taskId }, 'cronジョブ削除');
    }
  }

  /** Toggle a task: stop or start its cron job */
  toggleTask(taskId: string): void {
    const task = this.taskStore.getTask(taskId);
    if (!task) return;

    if (task.enabled) {
      this.registerJob(task);
    } else {
      this.removeTask(taskId);
    }
  }

  /** Run a task immediately (outside of cron) */
  async runNow(taskId: string): Promise<void> {
    const task = this.taskStore.getTask(taskId);
    if (!task) {
      this.logger.warn({ taskId }, 'タスクが見つからない');
      return;
    }
    await this.executeTask(task);
  }

  /** Stop all cron jobs */
  shutdown(): void {
    for (const [taskId, job] of this.jobs) {
      void job.stop();
      this.logger.debug({ taskId }, 'cronジョブ停止');
    }
    this.jobs.clear();
    this.logger.info('スケジューラ停止');
  }

  private registerJob(task: ScheduledTask): void {
    // Remove existing job if any
    this.removeTask(task.id);

    if (!cron.validate(task.cronExpression)) {
      this.logger.error({ taskId: task.id, cron: task.cronExpression }, '無効なcron式');
      return;
    }

    const job = cron.schedule(task.cronExpression, () => {
      void this.executeTask(task);
    }, {
      timezone: 'Asia/Tokyo',
    });

    this.jobs.set(task.id, job);
    this.logger.info({ taskId: task.id, taskName: task.name, cron: task.cronExpression }, 'cronジョブ登録');
  }

  private async executeTask(task: ScheduledTask): Promise<void> {
    this.logger.info({ taskId: task.id, taskName: task.name }, 'タスク実行開始');

    const result = await this.taskRunner.run(task);

    try {
      await this.notifier.notify(task, result);
    } catch (err) {
      this.logger.error({ err, taskId: task.id }, '通知失敗');
    }
  }
}
