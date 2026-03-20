import type { ProfileStore } from '../../../profile/profile-store.js';

export function handleProfileCommand(args: string[], userId: string, profileStore: ProfileStore): string {
  const subAction = args[0]?.toLowerCase();

  if (subAction === 'set') {
    return handleProfileSet(args.slice(1), userId, profileStore);
  }

  // Default: show profile
  const profile = profileStore.getProfile(userId);
  if (!profile) {
    return 'プロフィールがまだ設定されていないわん！@むぎぼー に話しかけると、プロフィール設定を案内するわん！';
  }

  const lines = [
    `*:dog: ${profile.displayName ?? userId} のプロフィールわん！*`,
    '',
    `*場所:* ${profile.location ?? '未設定'}`,
    `*タイムゾーン:* ${profile.timezone}`,
    `*趣味:* ${profile.hobbies.length > 0 ? profile.hobbies.join(', ') : '未設定'}`,
    `*好きな食べ物:* ${profile.favoriteFoods.length > 0 ? profile.favoriteFoods.join(', ') : '未設定'}`,
    `*興味:* ${profile.interests.length > 0 ? profile.interests.join(', ') : '未設定'}`,
  ];

  return lines.join('\n');
}

function handleProfileSet(args: string[], userId: string, profileStore: ProfileStore): string {
  if (args.length < 2) {
    return '使い方: `/mugiclaw profile set <field> <value>` わん\n設定可能: displayName, location, timezone, hobbies, favoriteFoods, interests';
  }

  const field = args[0]!;
  const value = args.slice(1).join(' ');

  const arrayFields: string[] = ['hobbies', 'favoriteFoods', 'interests'];
  const validFields: string[] = ['displayName', 'location', 'timezone', ...arrayFields];

  if (!validFields.includes(field)) {
    return `「${field}」は無効なフィールドわん。設定可能: ${validFields.join(', ')}`;
  }

  if (arrayFields.includes(field)) {
    const arrayValue = value.split(/[,、]/).map(s => s.trim()).filter(Boolean);
    profileStore.upsertProfile(userId, { [field as string]: arrayValue });
  } else {
    profileStore.upsertProfile(userId, { [field as string]: value });
  }

  return `プロフィールの「${field}」を更新したわん！`;
}
