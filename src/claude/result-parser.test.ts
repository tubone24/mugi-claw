import { describe, it, expect } from "vitest";
import { parseClaudeResult } from "./result-parser.js";

describe("parseClaudeResult", () => {
  it("returns plain text as-is when no blocks are present", () => {
    const input = "こんにちは、今日はいい天気ですね";
    const result = parseClaudeResult(input);

    expect(result.cleanText).toBe(input);
    expect(result.newMemories).toEqual([]);
    expect(result.profileUpdates).toEqual({});
    expect(result.scheduleActions).toEqual([]);
  });

  it("parses a single MEMORY_SAVE block and removes it from cleanText", () => {
    const input = `Hello
[MEMORY_SAVE]
category: preference
content: ユーザーはコーヒーが好き
[/MEMORY_SAVE]
World`;

    const result = parseClaudeResult(input);

    expect(result.newMemories).toHaveLength(1);
    expect(result.newMemories[0]).toEqual({
      category: "preference",
      content: "ユーザーはコーヒーが好き",
    });
    expect(result.cleanText).toContain("Hello");
    expect(result.cleanText).toContain("World");
    expect(result.cleanText).not.toContain("[MEMORY_SAVE]");
    expect(result.cleanText).not.toContain("[/MEMORY_SAVE]");
    expect(result.cleanText).not.toContain("category:");
  });

  it("parses multiple MEMORY_SAVE blocks", () => {
    const input = `テスト
[MEMORY_SAVE]
category: preference
content: コーヒーが好き
[/MEMORY_SAVE]
中間テキスト
[MEMORY_SAVE]
category: fact
content: 東京在住
[/MEMORY_SAVE]
終わり`;

    const result = parseClaudeResult(input);

    expect(result.newMemories).toHaveLength(2);
    expect(result.newMemories[0]).toEqual({
      category: "preference",
      content: "コーヒーが好き",
    });
    expect(result.newMemories[1]).toEqual({
      category: "fact",
      content: "東京在住",
    });
    expect(result.cleanText).toContain("テスト");
    expect(result.cleanText).toContain("中間テキスト");
    expect(result.cleanText).toContain("終わり");
    expect(result.cleanText).not.toContain("[MEMORY_SAVE]");
  });

  it("parses a PROFILE_UPDATE block with multiple key-value pairs", () => {
    const input = `[PROFILE_UPDATE]
displayName: たろう
location: 大阪
hobbies: 読書, プログラミング
[/PROFILE_UPDATE]`;

    const result = parseClaudeResult(input);

    expect(result.profileUpdates).toEqual({
      displayName: "たろう",
      location: "大阪",
      hobbies: "読書, プログラミング",
    });
    expect(result.cleanText).not.toContain("[PROFILE_UPDATE]");
  });

  it("parses a SCHEDULE_ACTION add block with all fields including mentionUsers and mentionHere", () => {
    const input = `[SCHEDULE_ACTION]
action: add
name: gmail-check
cron: 0 9 * * *
prompt: Gmailを確認して未読メールの要約を送って
description: 毎朝9時のGmail確認
notifyType: channel
notifyChannel: C12345
mentionUsers: U12345, U67890
mentionHere: true
[/SCHEDULE_ACTION]`;

    const result = parseClaudeResult(input);

    expect(result.scheduleActions).toHaveLength(1);
    const action = result.scheduleActions[0]!;
    expect(action.action).toBe("add");
    expect(action.name).toBe("gmail-check");
    expect(action.cron).toBe("0 9 * * *");
    expect(action.prompt).toBe("Gmailを確認して未読メールの要約を送って");
    expect(action.description).toBe("毎朝9時のGmail確認");
    expect(action.notifyType).toBe("channel");
    expect(action.notifyChannel).toBe("C12345");
    expect(action.mentionUsers).toEqual(["U12345", "U67890"]);
    expect(action.mentionHere).toBe(true);
  });

  it("parses a SCHEDULE_ACTION remove block with only action and name", () => {
    const input = `[SCHEDULE_ACTION]
action: remove
name: gmail-check
[/SCHEDULE_ACTION]`;

    const result = parseClaudeResult(input);

    expect(result.scheduleActions).toHaveLength(1);
    const action = result.scheduleActions[0]!;
    expect(action.action).toBe("remove");
    expect(action.name).toBe("gmail-check");
    expect(action.cron).toBeUndefined();
    expect(action.prompt).toBeUndefined();
    expect(action.description).toBeUndefined();
    expect(action.mentionUsers).toBeUndefined();
    expect(action.mentionHere).toBe(false);
    expect(action.mentionChannel).toBe(false);
  });

  it("parses combined memory, profile, and schedule blocks in one text", () => {
    const input = `こんにちは！
[MEMORY_SAVE]
category: preference
content: 猫が好き
[/MEMORY_SAVE]
プロフィール更新もするよ
[PROFILE_UPDATE]
displayName: はなこ
location: 東京
[/PROFILE_UPDATE]
スケジュールも追加
[SCHEDULE_ACTION]
action: add
name: daily-report
cron: 0 18 * * 1-5
prompt: 日報を作成して
description: 平日18時の日報作成
[/SCHEDULE_ACTION]
以上です`;

    const result = parseClaudeResult(input);

    // Memory
    expect(result.newMemories).toHaveLength(1);
    expect(result.newMemories[0]).toEqual({
      category: "preference",
      content: "猫が好き",
    });

    // Profile
    expect(result.profileUpdates).toEqual({
      displayName: "はなこ",
      location: "東京",
    });

    // Schedule
    expect(result.scheduleActions).toHaveLength(1);
    expect(result.scheduleActions[0]!.action).toBe("add");
    expect(result.scheduleActions[0]!.name).toBe("daily-report");
    expect(result.scheduleActions[0]!.cron).toBe("0 18 * * 1-5");

    // Clean text
    expect(result.cleanText).toContain("こんにちは！");
    expect(result.cleanText).toContain("プロフィール更新もするよ");
    expect(result.cleanText).toContain("スケジュールも追加");
    expect(result.cleanText).toContain("以上です");
    expect(result.cleanText).not.toContain("[MEMORY_SAVE]");
    expect(result.cleanText).not.toContain("[PROFILE_UPDATE]");
    expect(result.cleanText).not.toContain("[SCHEDULE_ACTION]");
  });

  it("skips SCHEDULE_ACTION blocks with missing required fields (no name)", () => {
    const input = `[SCHEDULE_ACTION]
action: add
cron: 0 9 * * *
prompt: テスト
[/SCHEDULE_ACTION]`;

    const result = parseClaudeResult(input);

    expect(result.scheduleActions).toHaveLength(0);
    expect(result.cleanText).not.toContain("[SCHEDULE_ACTION]");
  });

  it("handles extra blank lines within blocks when fields are not indented", () => {
    const input = `[MEMORY_SAVE]

category:   preference

content:   スペースが多い

[/MEMORY_SAVE]`;

    const result = parseClaudeResult(input);

    expect(result.newMemories).toHaveLength(1);
    expect(result.newMemories[0]).toEqual({
      category: "preference",
      content: "スペースが多い",
    });
    expect(result.cleanText).not.toContain("[MEMORY_SAVE]");
  });
});
