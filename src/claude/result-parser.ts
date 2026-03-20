export interface ParsedResult {
  cleanText: string;
  newMemories: Array<{ category: string; content: string }>;
  profileUpdates: Record<string, string>;
  scheduleActions: Array<{
    action: 'add' | 'remove' | 'pause' | 'resume';
    name: string;
    cron?: string;
    prompt?: string;
    description?: string;
    notifyType?: 'dm' | 'channel';
    notifyChannel?: string;
    model?: string;
  }>;
}

/**
 * Parse structured sections from Claude's response.
 *
 * Expected format in Claude's output:
 *
 * [MEMORY_SAVE]
 * category: preference
 * content: ユーザーはコーヒーが好き
 * [/MEMORY_SAVE]
 *
 * [PROFILE_UPDATE]
 * displayName: たろう
 * location: 大阪
 * [/PROFILE_UPDATE]
 *
 * [SCHEDULE_ACTION]
 * action: add
 * name: gmail-check
 * cron: 0 9 * * *
 * prompt: Gmailを確認して未読メールの要約を送って
 * description: 毎朝9時のGmail確認
 * [/SCHEDULE_ACTION]
 */
export function parseClaudeResult(text: string): ParsedResult {
  let cleanText = text;
  const newMemories: ParsedResult['newMemories'] = [];
  const profileUpdates: ParsedResult['profileUpdates'] = {};
  const scheduleActions: ParsedResult['scheduleActions'] = [];

  // Parse MEMORY_SAVE blocks
  const memoryRegex = /\[MEMORY_SAVE\]\s*\n([\s\S]*?)\[\/MEMORY_SAVE\]/g;
  let match: RegExpExecArray | null;
  while ((match = memoryRegex.exec(text)) !== null) {
    const block = match[1] ?? '';
    const category = extractField(block, 'category') ?? 'fact';
    const content = extractField(block, 'content');
    if (content) {
      newMemories.push({ category, content });
    }
    cleanText = cleanText.replace(match[0], '');
  }

  // Parse PROFILE_UPDATE blocks
  const profileRegex = /\[PROFILE_UPDATE\]\s*\n([\s\S]*?)\[\/PROFILE_UPDATE\]/g;
  while ((match = profileRegex.exec(text)) !== null) {
    const block = match[1] ?? '';
    const lines = block.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        if (key && value) {
          profileUpdates[key] = value;
        }
      }
    }
    cleanText = cleanText.replace(match[0], '');
  }

  // Parse SCHEDULE_ACTION blocks
  const scheduleRegex = /\[SCHEDULE_ACTION\]\s*\n([\s\S]*?)\[\/SCHEDULE_ACTION\]/g;
  while ((match = scheduleRegex.exec(text)) !== null) {
    const block = match[1] ?? '';
    const action = extractField(block, 'action') as 'add' | 'remove' | 'pause' | 'resume' | undefined;
    const name = extractField(block, 'name');
    if (action && name) {
      scheduleActions.push({
        action,
        name,
        cron: extractField(block, 'cron'),
        prompt: extractField(block, 'prompt'),
        description: extractField(block, 'description'),
        notifyType: extractField(block, 'notifyType') as 'dm' | 'channel' | undefined,
        notifyChannel: extractField(block, 'notifyChannel'),
        model: extractField(block, 'model'),
      });
    }
    cleanText = cleanText.replace(match[0], '');
  }

  // Clean up extra whitespace
  cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();

  return { cleanText, newMemories, profileUpdates, scheduleActions };
}

function extractField(block: string, fieldName: string): string | undefined {
  const regex = new RegExp(`^${fieldName}:\\s*(.+)$`, 'mi');
  const match = regex.exec(block);
  return match?.[1]?.trim() || undefined;
}
