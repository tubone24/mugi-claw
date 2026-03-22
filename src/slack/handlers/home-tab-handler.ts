import type { App } from '@slack/bolt';
import type { AppConfig } from '../../types.js';
import type { Logger } from 'pino';
import type { ProfileStore } from '../../profile/profile-store.js';
import type { TaskStore } from '../../scheduler/task-store.js';
import type { Scheduler } from '../../scheduler/scheduler.js';
import type { SettingsStore, ClaudeModel } from '../../db/settings-store.js';
import type { WhitelistStore } from '../../network/whitelist-store.js';
import { buildHomeTabView } from '../views/home-tab-view.js';
import { buildSettingsModal, SETTINGS_MODAL_CALLBACK_ID } from '../views/settings-modal.js';
import { buildScheduleModal } from './commands/schedule-modal.js';
import { buildWhitelistModal, WHITELIST_MODAL_CALLBACK_ID } from '../views/whitelist-modal.js';

export function registerHomeTabHandler(
  app: App,
  config: AppConfig,
  profileStore: ProfileStore,
  taskStore: TaskStore,
  scheduler: Scheduler,
  settingsStore: SettingsStore,
  whitelistStore: WhitelistStore | null,
  logger: Logger,
): void {

  // Track whitelist page per user (in-memory, resets on restart)
  const whitelistPageMap = new Map<string, number>();

  // Helper: publish home tab for a given user
  async function publishHomeTab(client: any, userId: string): Promise<void> {
    try {
      const isOwner = userId === config.owner.slackUserId;
      const profile = profileStore.getProfile(userId);
      const tasks = taskStore.getTasksByUser(userId);
      logger.debug({ userId, taskCount: tasks.length }, 'Home tab tasks loaded');
      const recentRuns = taskStore.getRecentRunsByUser(userId, 5);
      const currentModel = settingsStore.getModel();

      const data: import('../views/home-tab-view.js').HomeTabData = {
        profile,
        tasks,
        recentRuns,
        currentModel,
        isOwner,
        whitelist: isOwner && whitelistStore ? whitelistStore.list() : undefined,
        logLevel: isOwner ? (settingsStore.get('log_level') ?? config.logLevel) : undefined,
        whitelistPage: isOwner ? (whitelistPageMap.get(userId) ?? 0) : undefined,
      };

      const view = buildHomeTabView(data);
      await client.views.publish({
        user_id: userId,
        view,
      });
    } catch (err) {
      logger.error({ err, userId }, 'Home tab publish failed');
    }
  }

  // Event: app_home_opened
  app.event('app_home_opened', async ({ event, client }) => {
    if (event.tab !== 'home') return;
    await publishHomeTab(client, event.user);
  });

  // Action: Profile edit button
  app.action('home_profile_edit', async ({ ack, body, client }) => {
    await ack();
    const userId = body.user.id;
    const profile = profileStore.getProfile(userId);

    try {
      await client.views.open({
        trigger_id: (body as any).trigger_id,
        view: {
          type: 'modal' as const,
          callback_id: 'home_profile_modal_submit',
          title: { type: 'plain_text' as const, text: 'プロフィール編集' },
          submit: { type: 'plain_text' as const, text: '保存' },
          close: { type: 'plain_text' as const, text: 'キャンセル' },
          blocks: [
            {
              type: 'input',
              block_id: 'display_name_block',
              label: { type: 'plain_text', text: '呼び名' },
              element: {
                type: 'plain_text_input',
                action_id: 'display_name',
                placeholder: { type: 'plain_text', text: 'むぎぼーに呼んでほしい名前' },
                ...(profile?.displayName ? { initial_value: profile.displayName } : {}),
              },
              optional: true,
            },
            {
              type: 'input',
              block_id: 'location_block',
              label: { type: 'plain_text', text: '場所' },
              element: {
                type: 'plain_text_input',
                action_id: 'location',
                placeholder: { type: 'plain_text', text: '例: 東京' },
                ...(profile?.location ? { initial_value: profile.location } : {}),
              },
              optional: true,
            },
            {
              type: 'input',
              block_id: 'timezone_block',
              label: { type: 'plain_text', text: 'タイムゾーン' },
              element: {
                type: 'static_select',
                action_id: 'timezone',
                initial_option: {
                  text: { type: 'plain_text', text: `${profile?.timezone ?? 'Asia/Tokyo'}` },
                  value: profile?.timezone ?? 'Asia/Tokyo',
                },
                options: [
                  { text: { type: 'plain_text', text: 'Asia/Tokyo (JST)' }, value: 'Asia/Tokyo' },
                  { text: { type: 'plain_text', text: 'America/New_York (EST)' }, value: 'America/New_York' },
                  { text: { type: 'plain_text', text: 'America/Los_Angeles (PST)' }, value: 'America/Los_Angeles' },
                  { text: { type: 'plain_text', text: 'Europe/London (GMT)' }, value: 'Europe/London' },
                  { text: { type: 'plain_text', text: 'UTC' }, value: 'UTC' },
                ],
              },
              optional: true,
            },
            {
              type: 'input',
              block_id: 'hobbies_block',
              label: { type: 'plain_text', text: '趣味（カンマ区切り）' },
              element: {
                type: 'plain_text_input',
                action_id: 'hobbies',
                placeholder: { type: 'plain_text', text: '例: プログラミング, ゲーム, 料理' },
                ...(profile?.hobbies?.length ? { initial_value: profile.hobbies.join(', ') } : {}),
              },
              optional: true,
            },
            {
              type: 'input',
              block_id: 'interests_block',
              label: { type: 'plain_text', text: '興味あるトピック（カンマ区切り）' },
              element: {
                type: 'plain_text_input',
                action_id: 'interests',
                placeholder: { type: 'plain_text', text: '例: AI, Web開発, データ分析' },
                ...(profile?.interests?.length ? { initial_value: profile.interests.join(', ') } : {}),
              },
              optional: true,
            },
          ],
        },
      });
    } catch (err) {
      logger.error({ err }, 'Profile edit modal open failed');
    }
  });

  // View submission: Profile modal
  app.view('home_profile_modal_submit', async ({ ack, body, view, client }) => {
    await ack();
    const userId = body.user.id;
    const state = view.state.values;

    const displayName = state['display_name_block']?.['display_name']?.value;
    const location = state['location_block']?.['location']?.value;
    const timezone = (state['timezone_block']?.['timezone'] as any)?.selected_option?.value ?? 'Asia/Tokyo';
    const hobbiesRaw = state['hobbies_block']?.['hobbies']?.value;
    const interestsRaw = state['interests_block']?.['interests']?.value;

    const hobbies = hobbiesRaw ? hobbiesRaw.split(/[,、]/).map((s: string) => s.trim()).filter(Boolean) : [];
    const interests = interestsRaw ? interestsRaw.split(/[,、]/).map((s: string) => s.trim()).filter(Boolean) : [];

    profileStore.upsertProfile(userId, {
      displayName: displayName || undefined,
      location: location || undefined,
      timezone,
      hobbies,
      interests,
    });

    // Republish home tab
    await publishHomeTab(client, userId);
  });

  // Action: Schedule add button
  app.action('home_schedule_add', async ({ ack, body, client }) => {
    await ack();
    try {
      await client.views.open({
        trigger_id: (body as any).trigger_id,
        view: buildScheduleModal(),
      });
    } catch (err) {
      logger.error({ err }, 'Schedule modal open failed');
    }
  });

  // Action: Task overflow menu (matches pattern home_task_overflow_*)
  app.action(/^home_task_overflow_/, async ({ ack, body, client }) => {
    await ack();
    const userId = body.user.id;

    try {
      const action = (body as any).actions?.[0];
      const selectedValue = action?.selected_option?.value as string | undefined;
      if (!selectedValue) return;

      const [operation, ...idParts] = selectedValue.split('_');
      const taskId = idParts.join('_');
      if (!taskId) return;

      const task = taskStore.getTask(taskId);
      if (!task) {
        logger.warn({ taskId }, 'Task not found for overflow action');
        return;
      }

      switch (operation) {
        case 'edit': {
          await client.views.open({
            trigger_id: (body as any).trigger_id,
            view: buildScheduleModal(task),
          });
          return; // Don't republish - modal will handle it
        }
        case 'toggle': {
          taskStore.toggleTask(task.id);
          scheduler.toggleTask(task.id);
          break;
        }
        case 'run': {
          scheduler.runNow(task.id);
          break;
        }
        case 'delete': {
          scheduler.removeTask(task.id);
          taskStore.deleteTask(task.id);
          break;
        }
      }

      // Republish home tab after state change
      await publishHomeTab(client, userId);
    } catch (err) {
      logger.error({ err }, 'Task overflow action failed');
    }
  });

  // Action: Model select
  app.action('home_model_select', async ({ ack, body, client }) => {
    await ack();
    try {
      const action = (body as any).actions?.[0];
      const model = action?.selected_option?.value as string | undefined;
      if (model && (model === 'opus' || model === 'sonnet' || model === 'haiku')) {
        settingsStore.setModel(model as ClaudeModel);
      }
      await publishHomeTab(client, body.user.id);
    } catch (err) {
      logger.error({ err }, 'Model select failed');
    }
  });

  // Action: Open settings modal
  app.action('home_open_settings', async ({ ack, body, client }) => {
    await ack();
    try {
      const notifyComplete = settingsStore.get('notify_on_complete') === 'true';
      const notifyError = settingsStore.get('notify_on_error') === 'true';

      await client.views.open({
        trigger_id: (body as any).trigger_id,
        view: buildSettingsModal({
          notifyOnComplete: notifyComplete,
          notifyOnError: notifyError,
        }),
      });
    } catch (err) {
      logger.error({ err }, 'Settings modal open failed');
    }
  });

  // View submission: Settings modal
  app.view(SETTINGS_MODAL_CALLBACK_ID, async ({ ack, body, view, client }) => {
    await ack();
    const state = view.state.values;

    const notifyComplete = ((state['notify_complete']?.['notify_complete_check'] as any)?.selected_options ?? []).length > 0;
    const notifyError = ((state['notify_error']?.['notify_error_check'] as any)?.selected_options ?? []).length > 0;

    settingsStore.set('notify_on_complete', notifyComplete ? 'true' : 'false');
    settingsStore.set('notify_on_error', notifyError ? 'true' : 'false');

    await publishHomeTab(client, body.user.id);
  });

  // Action: Log level select (admin only)
  app.action('home_log_level_select', async ({ ack, body, client }) => {
    await ack();
    if (body.user.id !== config.owner.slackUserId) return;

    try {
      const action = (body as any).actions?.[0];
      const level = action?.selected_option?.value as string | undefined;
      if (level) {
        settingsStore.set('log_level', level);
        logger.level = level;
      }
      await publishHomeTab(client, body.user.id);
    } catch (err) {
      logger.error({ err }, 'Log level change failed');
    }
  });

  // Action: Add whitelist entry (admin only)
  app.action('home_whitelist_add', async ({ ack, body, client }) => {
    await ack();
    if (body.user.id !== config.owner.slackUserId) return;
    try {
      await client.views.open({
        trigger_id: (body as any).trigger_id,
        view: buildWhitelistModal(),
      });
    } catch (err) {
      logger.error({ err }, 'Whitelist add modal open failed');
    }
  });

  // Action: Whitelist overflow (edit/delete) (admin only)
  app.action(/^home_wl_overflow_/, async ({ ack, body, client }) => {
    await ack();
    if (body.user.id !== config.owner.slackUserId) return;

    try {
      const action = (body as any).actions?.[0];
      const selectedValue = action?.selected_option?.value as string | undefined;
      if (!selectedValue) return;

      const [operation, ...idParts] = selectedValue.split('_');
      const entryId = parseInt(idParts.join('_'), 10);
      if (isNaN(entryId)) return;

      switch (operation) {
        case 'edit': {
          const entry = whitelistStore?.getById(entryId);
          if (!entry) return;
          await client.views.open({
            trigger_id: (body as any).trigger_id,
            view: buildWhitelistModal(entry),
          });
          return; // Don't republish - modal handles it
        }
        case 'delete': {
          whitelistStore?.removeById(entryId);
          // Adjust page if current page becomes empty after deletion
          const currentPage = whitelistPageMap.get(body.user.id) ?? 0;
          if (currentPage > 0) {
            const remaining = whitelistStore ? whitelistStore.list().filter(e => e.id != null).length : 0;
            const { WHITELIST_PAGE_SIZE } = await import('../views/home-tab-view.js');
            const maxPage = Math.max(0, Math.ceil(remaining / WHITELIST_PAGE_SIZE) - 1);
            if (currentPage > maxPage) {
              whitelistPageMap.set(body.user.id, maxPage);
            }
          }
          break;
        }
      }

      await publishHomeTab(client, body.user.id);
    } catch (err) {
      logger.error({ err }, 'Whitelist overflow action failed');
    }
  });

  // Action: Whitelist pagination (prev/next)
  app.action(/^home_wl_page_(prev|next)$/, async ({ ack, body, client }) => {
    await ack();
    if (body.user.id !== config.owner.slackUserId) return;

    try {
      const action = (body as any).actions?.[0];
      const page = parseInt(action?.value ?? '0', 10);
      if (!isNaN(page)) {
        whitelistPageMap.set(body.user.id, page);
      }
      await publishHomeTab(client, body.user.id);
    } catch (err) {
      logger.error({ err }, 'Whitelist pagination failed');
    }
  });

  // View submission: Whitelist add/edit modal
  app.view(WHITELIST_MODAL_CALLBACK_ID, async ({ ack, body, view, client }) => {
    const state = view.state.values;
    const hostname = state['wl_hostname']?.['hostname']?.value?.trim();

    if (!hostname) {
      await ack({
        response_action: 'errors',
        errors: { wl_hostname: 'ホスト名を入力してわん' },
      });
      return;
    }

    const portStr = state['wl_port']?.['port']?.value?.trim();
    const port = portStr ? parseInt(portStr, 10) : undefined;
    if (portStr && (isNaN(port!) || port! < 1 || port! > 65535)) {
      await ack({
        response_action: 'errors',
        errors: { wl_port: 'ポート番号は1〜65535の数値を入力してわん' },
      });
      return;
    }

    const purpose = state['wl_purpose']?.['purpose']?.value?.trim() || undefined;

    await ack();

    let metadata: { entryId?: number } = {};
    if (view.private_metadata) {
      try {
        metadata = JSON.parse(view.private_metadata);
      } catch {
        // ignore
      }
    }

    if (metadata.entryId != null) {
      whitelistStore?.updateEntry(metadata.entryId, hostname, port, purpose);
    } else {
      whitelistStore?.addPermanent(hostname, body.user.id, port, purpose);
    }

    await publishHomeTab(client, body.user.id);
  });

  logger.info('Home tab handler registered');
}
