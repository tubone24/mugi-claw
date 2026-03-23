import type { ListStore } from '../../list-store.js';

export function handleListCommand(
  args: string[],
  userId: string,
  listStore: ListStore,
): string {
  const action = args[0]?.toLowerCase() ?? 'help';

  switch (action) {
    case 'create':
      return handleCreate(args.slice(1), userId, listStore);
    case 'add':
      return handleAddItem(args.slice(1), userId, listStore);
    case 'done':
    case 'complete':
      return handleDone(args.slice(1), userId, listStore);
    case 'undone':
    case 'reopen':
      return handleUndone(args.slice(1), userId, listStore);
    case 'show':
    case 'view':
      return handleShow(args.slice(1), userId, listStore);
    case 'list':
      return handleListAll(userId, listStore);
    case 'remove':
    case 'delete':
      return handleRemoveItem(args.slice(1), userId, listStore);
    case 'delete-list':
      return handleDeleteList(args.slice(1), userId, listStore);
    case 'help':
    default:
      return getListHelp();
  }
}

function handleCreate(args: string[], userId: string, store: ListStore): string {
  const name = args.join(' ');
  if (!name) {
    return '使い方: `/mugiclaw list create <リスト名>` わん';
  }

  if (store.getListByName(name, userId)) {
    return `リスト「${name}」は既に存在するわん`;
  }

  const list = store.createList({ name, createdBy: userId });
  return `リスト「${list.name}」を作成したわん！ :clipboard:`;
}

function handleAddItem(args: string[], userId: string, store: ListStore): string {
  // Expected: <list_name> <item_title>
  // Use -- as separator between list name and item: "list add mylist -- task title"
  const separatorIdx = args.indexOf('--');
  let listName: string;
  let itemTitle: string;

  if (separatorIdx > 0) {
    listName = args.slice(0, separatorIdx).join(' ');
    itemTitle = args.slice(separatorIdx + 1).join(' ');
  } else if (args.length >= 2) {
    // First arg is list name, rest is item title
    listName = args[0]!;
    itemTitle = args.slice(1).join(' ');
  } else {
    return '使い方: `/mugiclaw list add <リスト名> <タスク名>` わん\nまたは `/mugiclaw list add <リスト名> -- <タスク名>` わん';
  }

  if (!listName || !itemTitle) {
    return '使い方: `/mugiclaw list add <リスト名> <タスク名>` わん';
  }

  const list = store.getListByName(listName, userId);
  if (!list) {
    return `リスト「${listName}」が見つからないわん。先に \`/mugiclaw list create ${listName}\` で作成してわん`;
  }

  const item = store.createItem({
    listId: list.id,
    title: itemTitle,
    createdBy: userId,
  });

  return `リスト「${listName}」にタスク「${item.title}」を追加したわん！`;
}

function handleDone(args: string[], userId: string, store: ListStore): string {
  const separatorIdx = args.indexOf('--');
  let listName: string;
  let itemTitle: string;

  if (separatorIdx > 0) {
    listName = args.slice(0, separatorIdx).join(' ');
    itemTitle = args.slice(separatorIdx + 1).join(' ');
  } else if (args.length >= 2) {
    listName = args[0]!;
    itemTitle = args.slice(1).join(' ');
  } else {
    return '使い方: `/mugiclaw list done <リスト名> <タスク名>` わん';
  }

  const list = store.getListByName(listName, userId);
  if (!list) {
    return `リスト「${listName}」が見つからないわん`;
  }

  const item = store.getItemByTitle(list.id, itemTitle);
  if (!item) {
    return `タスク「${itemTitle}」が見つからないわん`;
  }

  store.updateItem(item.id, { status: 'done' });
  return `タスク「${itemTitle}」を完了にしたわん！ :white_check_mark:`;
}

function handleUndone(args: string[], userId: string, store: ListStore): string {
  const separatorIdx = args.indexOf('--');
  let listName: string;
  let itemTitle: string;

  if (separatorIdx > 0) {
    listName = args.slice(0, separatorIdx).join(' ');
    itemTitle = args.slice(separatorIdx + 1).join(' ');
  } else if (args.length >= 2) {
    listName = args[0]!;
    itemTitle = args.slice(1).join(' ');
  } else {
    return '使い方: `/mugiclaw list undone <リスト名> <タスク名>` わん';
  }

  const list = store.getListByName(listName, userId);
  if (!list) {
    return `リスト「${listName}」が見つからないわん`;
  }

  const item = store.getItemByTitle(list.id, itemTitle);
  if (!item) {
    return `タスク「${itemTitle}」が見つからないわん`;
  }

  store.updateItem(item.id, { status: 'open' });
  return `タスク「${itemTitle}」を未完了に戻したわん`;
}

function handleShow(args: string[], userId: string, store: ListStore): string {
  const listName = args.join(' ');
  if (!listName) {
    return '使い方: `/mugiclaw list show <リスト名>` わん';
  }

  const list = store.getListByName(listName, userId);
  if (!list) {
    return `リスト「${listName}」が見つからないわん`;
  }

  const items = store.getItems(list.id);
  if (items.length === 0) {
    return `リスト「${listName}」にタスクはまだないわん。\`/mugiclaw list add ${listName} <タスク名>\` で追加してわん`;
  }

  const lines = [`*:clipboard: ${listName}*`, ''];
  const openItems = items.filter(i => i.status === 'open');
  const doneItems = items.filter(i => i.status === 'done');

  if (openItems.length > 0) {
    for (const item of openItems) {
      const priority = item.priority === 'high' ? ':red_circle:' : item.priority === 'low' ? ':white_circle:' : ':large_blue_circle:';
      const due = item.dueDate ? ` | 期限: ${item.dueDate}` : '';
      const assignee = item.assignee ? ` | <@${item.assignee}>` : '';
      lines.push(`${priority} :white_large_square: ${item.title}${due}${assignee}`);
    }
  }

  if (doneItems.length > 0) {
    if (openItems.length > 0) lines.push('');
    for (const item of doneItems) {
      lines.push(`:white_check_mark: ~${item.title}~`);
    }
  }

  const openCount = openItems.length;
  const doneCount = doneItems.length;
  lines.push('');
  lines.push(`_${openCount}件 未完了 / ${doneCount}件 完了_`);

  return lines.join('\n');
}

function handleListAll(userId: string, store: ListStore): string {
  const lists = store.getListsByUser(userId);
  if (lists.length === 0) {
    return 'リストはまだないわん。`/mugiclaw list create <名前>` で作成してわん';
  }

  const lines = ['*:clipboard: リスト一覧わん！*', ''];
  for (const list of lists) {
    const items = store.getItems(list.id);
    const openCount = items.filter(i => i.status === 'open').length;
    const doneCount = items.filter(i => i.status === 'done').length;
    lines.push(`:clipboard: *${list.name}* — ${openCount}件 未完了 / ${doneCount}件 完了`);
  }

  return lines.join('\n');
}

function handleRemoveItem(args: string[], userId: string, store: ListStore): string {
  const separatorIdx = args.indexOf('--');
  let listName: string;
  let itemTitle: string;

  if (separatorIdx > 0) {
    listName = args.slice(0, separatorIdx).join(' ');
    itemTitle = args.slice(separatorIdx + 1).join(' ');
  } else if (args.length >= 2) {
    listName = args[0]!;
    itemTitle = args.slice(1).join(' ');
  } else {
    return '使い方: `/mugiclaw list remove <リスト名> <タスク名>` わん';
  }

  const list = store.getListByName(listName, userId);
  if (!list) {
    return `リスト「${listName}」が見つからないわん`;
  }

  const item = store.getItemByTitle(list.id, itemTitle);
  if (!item) {
    return `タスク「${itemTitle}」が見つからないわん`;
  }

  store.deleteItem(item.id);
  return `タスク「${itemTitle}」を削除したわん`;
}

function handleDeleteList(args: string[], userId: string, store: ListStore): string {
  const name = args.join(' ');
  if (!name) {
    return '使い方: `/mugiclaw list delete-list <リスト名>` わん';
  }

  const list = store.getListByName(name, userId);
  if (!list) {
    return `リスト「${name}」が見つからないわん`;
  }

  store.deleteList(list.id);
  return `リスト「${name}」を削除したわん（タスクも全て削除されたわん）`;
}

function getListHelp(): string {
  return `*:clipboard: リストコマンドわん！*

*リスト管理*
\`/mugiclaw list create <リスト名>\` - リスト作成
\`/mugiclaw list list\` - リスト一覧
\`/mugiclaw list show <リスト名>\` - リストのタスク表示
\`/mugiclaw list delete-list <リスト名>\` - リスト削除

*タスク管理*
\`/mugiclaw list add <リスト名> <タスク名>\` - タスク追加
\`/mugiclaw list done <リスト名> <タスク名>\` - タスク完了
\`/mugiclaw list undone <リスト名> <タスク名>\` - タスク未完了に戻す
\`/mugiclaw list remove <リスト名> <タスク名>\` - タスク削除

_リスト名にスペースがある場合は \`--\` で区切る: \`list add 買い物 -- 牛乳\`_`;
}
