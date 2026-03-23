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
    mentionUsers?: string[];
    mentionHere?: boolean;
    mentionChannel?: boolean;
  }>;
  canvasActions: Array<{
    action: 'create';
    title: string;
    content: string;
    channel?: string;
  }>;
  scheduledMessages: Array<{
    channel: string;
    postAt: string;
    text: string;
  }>;
  bookmarkActions: Array<{
    action: 'add' | 'remove' | 'list';
    channel: string;
    title?: string;
    url?: string;
  }>;
  listActions: Array<{
    action: 'create_list' | 'add_item' | 'complete_item' | 'remove_item';
    listName: string;
    title?: string;
    description?: string;
    assignee?: string;
    dueDate?: string;
    priority?: 'high' | 'medium' | 'low';
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
  const canvasActions: ParsedResult['canvasActions'] = [];
  const scheduledMessages: ParsedResult['scheduledMessages'] = [];
  const bookmarkActions: ParsedResult['bookmarkActions'] = [];
  const listActions: ParsedResult['listActions'] = [];

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
      const mentionUsersRaw = extractField(block, 'mentionUsers');
      scheduleActions.push({
        action,
        name,
        cron: extractField(block, 'cron'),
        prompt: extractField(block, 'prompt'),
        description: extractField(block, 'description'),
        notifyType: extractField(block, 'notifyType') as 'dm' | 'channel' | undefined,
        notifyChannel: extractField(block, 'notifyChannel'),
        model: extractField(block, 'model'),
        mentionUsers: mentionUsersRaw ? mentionUsersRaw.split(/[,、\s]+/).filter(Boolean) : undefined,
        mentionHere: extractField(block, 'mentionHere') === 'true',
        mentionChannel: extractField(block, 'mentionChannel') === 'true',
      });
    }
    cleanText = cleanText.replace(match[0], '');
  }

  // Parse CANVAS_ACTION blocks
  const canvasRegex = /\[CANVAS_ACTION\]\s*\n([\s\S]*?)\[\/CANVAS_ACTION\]/g;
  while ((match = canvasRegex.exec(text)) !== null) {
    const block = match[1] ?? '';
    const action = extractField(block, 'action') as 'create' | undefined;
    const title = extractField(block, 'title');
    const content = extractField(block, 'content') ?? extractMultilineField(block, 'content');
    if (action && title && content) {
      canvasActions.push({
        action,
        title,
        content,
        channel: extractField(block, 'channel'),
      });
    }
    cleanText = cleanText.replace(match[0], '');
  }

  // Parse SCHEDULED_MESSAGE blocks
  const smRegex = /\[SCHEDULED_MESSAGE\]\s*\n([\s\S]*?)\[\/SCHEDULED_MESSAGE\]/g;
  while ((match = smRegex.exec(text)) !== null) {
    const block = match[1] ?? '';
    const channel = extractField(block, 'channel');
    const postAt = extractField(block, 'post_at');
    const msgText = extractField(block, 'text');
    if (channel && postAt && msgText) {
      scheduledMessages.push({ channel, postAt, text: msgText });
    }
    cleanText = cleanText.replace(match[0], '');
  }

  // Parse BOOKMARK_ACTION blocks
  const bmRegex = /\[BOOKMARK_ACTION\]\s*\n([\s\S]*?)\[\/BOOKMARK_ACTION\]/g;
  while ((match = bmRegex.exec(text)) !== null) {
    const block = match[1] ?? '';
    const action = extractField(block, 'action') as 'add' | 'remove' | 'list' | undefined;
    const channel = extractField(block, 'channel');
    if (action && channel) {
      bookmarkActions.push({
        action,
        channel,
        title: extractField(block, 'title'),
        url: extractField(block, 'url'),
      });
    }
    cleanText = cleanText.replace(match[0], '');
  }

  // Parse LIST_ACTION blocks
  const listRegex = /\[LIST_ACTION\]\s*\n([\s\S]*?)\[\/LIST_ACTION\]/g;
  while ((match = listRegex.exec(text)) !== null) {
    const block = match[1] ?? '';
    const action = extractField(block, 'action') as 'create_list' | 'add_item' | 'complete_item' | 'remove_item' | undefined;
    const listName = extractField(block, 'list_name');
    if (action && listName) {
      listActions.push({
        action,
        listName,
        title: extractField(block, 'title'),
        description: extractField(block, 'description'),
        assignee: extractField(block, 'assignee'),
        dueDate: extractField(block, 'due_date'),
        priority: extractField(block, 'priority') as 'high' | 'medium' | 'low' | undefined,
      });
    }
    cleanText = cleanText.replace(match[0], '');
  }

  // Clean up extra whitespace
  cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();

  return { cleanText, newMemories, profileUpdates, scheduleActions, canvasActions, scheduledMessages, bookmarkActions, listActions };
}

function extractField(block: string, fieldName: string): string | undefined {
  const regex = new RegExp(`^${fieldName}:\\s*(.+)$`, 'mi');
  const match = regex.exec(block);
  return match?.[1]?.trim() || undefined;
}

function extractMultilineField(block: string, fieldName: string): string | undefined {
  const regex = new RegExp(`^${fieldName}:\\s*(.+(?:\\n(?!\\w+:).+)*)`, 'mi');
  const match = regex.exec(block);
  return match?.[1]?.trim() || undefined;
}
