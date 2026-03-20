import type { SettingsStore, ClaudeModel } from '../../../db/settings-store.js';

const VALID_MODELS: ClaudeModel[] = ['opus', 'sonnet', 'haiku'];

export function handleModelCommand(args: string[], settingsStore: SettingsStore): string {
  if (args.length === 0) {
    const current = settingsStore.getModel();
    return `現在のモデル: *${current}* わん`;
  }

  const model = args[0]!.toLowerCase();
  if (!VALID_MODELS.includes(model as ClaudeModel)) {
    return `無効なモデルわん。選択可能: ${VALID_MODELS.join(', ')}`;
  }

  settingsStore.setModel(model as ClaudeModel);
  return `モデルを *${model}* に切り替えたわん！`;
}
