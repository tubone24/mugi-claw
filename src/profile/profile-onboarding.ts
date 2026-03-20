import type { WebClient } from '@slack/web-api';
import type { Logger } from 'pino';
import type { ProfileStore } from './profile-store.js';

export class ProfileOnboarding {
  constructor(
    private client: WebClient,
    private profileStore: ProfileStore,
    private logger: Logger,
  ) {}

  /** Check if user has a profile; if not, send onboarding DM */
  async checkAndOnboard(slackUserId: string): Promise<boolean> {
    const profile = this.profileStore.getProfile(slackUserId);
    if (profile) return false; // Already has profile

    try {
      await this.sendOnboardingDm(slackUserId);
      return true;
    } catch (err) {
      this.logger.error({ err, slackUserId }, 'オンボーディングDM送信失敗');
      return false;
    }
  }

  private async sendOnboardingDm(slackUserId: string): Promise<void> {
    // Open DM channel
    const dm = await this.client.conversations.open({ users: slackUserId });
    const channelId = dm.channel?.id;
    if (!channelId) throw new Error('DM channel open failed');

    await this.client.chat.postMessage({
      channel: channelId,
      text: 'はじめましてわん！むぎぼーだわん！プロフィールを教えてほしいわん！',
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '🐕 むぎぼーへようこそ！', emoji: true },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'はじめましてわん！むぎぼーだわん！\nあなたのことを教えてくれたら、もっとお手伝いしやすくなるわん！',
          },
        },
        {
          type: 'input',
          block_id: 'display_name_block',
          label: { type: 'plain_text', text: '呼び名', emoji: true },
          element: {
            type: 'plain_text_input',
            action_id: 'display_name',
            placeholder: { type: 'plain_text', text: 'むぎぼーに呼んでほしい名前' },
          },
          optional: true,
        },
        {
          type: 'input',
          block_id: 'location_block',
          label: { type: 'plain_text', text: '場所', emoji: true },
          element: {
            type: 'plain_text_input',
            action_id: 'location',
            placeholder: { type: 'plain_text', text: '例: 東京' },
          },
          optional: true,
        },
        {
          type: 'input',
          block_id: 'timezone_block',
          label: { type: 'plain_text', text: 'タイムゾーン', emoji: true },
          element: {
            type: 'static_select',
            action_id: 'timezone',
            initial_option: {
              text: { type: 'plain_text', text: 'Asia/Tokyo (JST)' },
              value: 'Asia/Tokyo',
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
          label: { type: 'plain_text', text: '趣味（カンマ区切り）', emoji: true },
          element: {
            type: 'plain_text_input',
            action_id: 'hobbies',
            placeholder: { type: 'plain_text', text: '例: プログラミング, ゲーム, 料理' },
          },
          optional: true,
        },
        {
          type: 'input',
          block_id: 'interests_block',
          label: { type: 'plain_text', text: '興味あるトピック（カンマ区切り）', emoji: true },
          element: {
            type: 'plain_text_input',
            action_id: 'interests',
            placeholder: { type: 'plain_text', text: '例: AI, Web開発, データ分析' },
          },
          optional: true,
        },
        {
          type: 'actions',
          block_id: 'onboarding_actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '登録するわん！', emoji: true },
              style: 'primary',
              action_id: 'profile_submit',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'スキップ' },
              action_id: 'profile_skip',
            },
          ],
        },
      ],
    });
  }

  /** Handle profile form submission from Block Kit */
  handleSubmit(slackUserId: string, state: Record<string, Record<string, { value?: string; selected_option?: { value: string } }>>): void {
    const displayName = state['display_name_block']?.['display_name']?.value;
    const location = state['location_block']?.['location']?.value;
    const timezone = state['timezone_block']?.['timezone']?.selected_option?.value ?? 'Asia/Tokyo';
    const hobbiesRaw = state['hobbies_block']?.['hobbies']?.value;
    const interestsRaw = state['interests_block']?.['interests']?.value;

    const hobbies = hobbiesRaw ? hobbiesRaw.split(/[,、]/).map(s => s.trim()).filter(Boolean) : [];
    const interests = interestsRaw ? interestsRaw.split(/[,、]/).map(s => s.trim()).filter(Boolean) : [];

    this.profileStore.upsertProfile(slackUserId, {
      displayName: displayName || undefined,
      location: location || undefined,
      timezone,
      hobbies,
      interests,
    });
  }

  /** Handle skip action */
  handleSkip(slackUserId: string): void {
    // Create a minimal profile so onboarding doesn't trigger again
    this.profileStore.upsertProfile(slackUserId, {});
  }
}
