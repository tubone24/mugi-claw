export function convertMarkdown(text: string): string {
  let result = text;

  // ヘッディング: # → *bold*
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // Bold: **text** → *text* (Slack mrkdwn)
  // ただしコードブロック内は除外
  result = replaceOutsideCodeBlocks(result, /\*\*(.+?)\*\*/g, '*$1*');

  // Italic: _text_ はそのまま（Slackも同じ）

  // リンク: [text](url) → <url|text>
  result = replaceOutsideCodeBlocks(result, /\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');

  // 画像: ![alt](url) → url
  result = replaceOutsideCodeBlocks(result, /!\[([^\]]*)\]\(([^)]+)\)/g, '$2');

  // Strikethrough: ~~text~~ → ~text~
  result = replaceOutsideCodeBlocks(result, /~~(.+?)~~/g, '~$1~');

  return result;
}

function replaceOutsideCodeBlocks(
  text: string,
  pattern: RegExp,
  replacement: string,
): string {
  // コードブロックを一時退避
  const codeBlocks: string[] = [];
  let processed = text.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  // インラインコードも退避
  const inlineCodes: string[] = [];
  processed = processed.replace(/`[^`]+`/g, (match) => {
    inlineCodes.push(match);
    return `__INLINE_CODE_${inlineCodes.length - 1}__`;
  });

  // 変換適用
  processed = processed.replace(pattern, replacement);

  // コードブロック復元
  inlineCodes.forEach((code, i) => {
    processed = processed.replace(`__INLINE_CODE_${i}__`, code);
  });
  codeBlocks.forEach((code, i) => {
    processed = processed.replace(`__CODE_BLOCK_${i}__`, code);
  });

  return processed;
}
