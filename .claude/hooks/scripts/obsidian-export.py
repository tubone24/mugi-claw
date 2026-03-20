#!/usr/bin/env python3
"""
Claude Code → Obsidian エクスポーター
セッション終了時にトランスクリプトをObsidianノートとして保存
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path


def get_obsidian_vault_path() -> Path:
    vault_path = os.environ.get("OBSIDIAN_VAULT_PATH", "")
    if not vault_path:
        home = Path.home()
        possible_paths = [
            home / "Documents" / "Obsidian Vault",
            home / "Documents" / "Obsidian",
            home / "Obsidian",
            home / ".obsidian",
        ]
        for path in possible_paths:
            if path.exists():
                vault_path = str(path)
                break

    if not vault_path:
        return None

    vault = Path(vault_path).expanduser()
    claude_folder = vault / "Claude-Sessions"
    claude_folder.mkdir(parents=True, exist_ok=True)
    return claude_folder


def parse_transcript(transcript_path: str) -> dict:
    result = {
        "prompts": [], "tool_uses": [], "files_edited": [],
        "files_created": [], "commands_run": [], "summary": ""
    }
    if not transcript_path or not Path(transcript_path).exists():
        return result

    with open(transcript_path, "r", encoding="utf-8") as f:
        for line in f:
            try:
                msg = json.loads(line.strip())
            except json.JSONDecodeError:
                continue
            role = msg.get("role", "")
            content = msg.get("content", [])
            if role == "user":
                if isinstance(content, str):
                    result["prompts"].append(content)
                elif isinstance(content, list):
                    for item in content:
                        if isinstance(item, dict) and item.get("type") == "text":
                            result["prompts"].append(item.get("text", ""))
            if role == "assistant" and isinstance(content, list):
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "tool_use":
                        tool_name = item.get("name", "")
                        tool_input = item.get("input", {})
                        result["tool_uses"].append({"tool": tool_name, "input": tool_input})
                        if tool_name in ["Edit", "Write"]:
                            file_path = tool_input.get("file_path", "")
                            if file_path:
                                if tool_name == "Edit":
                                    result["files_edited"].append(file_path)
                                else:
                                    result["files_created"].append(file_path)
                        if tool_name == "Bash":
                            cmd = tool_input.get("command", "")
                            if cmd:
                                result["commands_run"].append(cmd)
    return result


def generate_markdown(session_data: dict, input_data: dict) -> str:
    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    time_str = now.strftime("%H:%M:%S")
    cwd = input_data.get("cwd", "unknown")
    session_id = input_data.get("session_id", "unknown")

    md = f"""---
date: {date_str}
time: {time_str}
session_id: {session_id}
project: {Path(cwd).name if cwd else "unknown"}
tags:
  - claude-code
  - session
---

# Claude Code Session - {date_str} {time_str}

## Session Info

| Key | Value |
|-----|-------|
| Project | `{cwd}` |
| Session ID | `{session_id}` |
| Date | {date_str} {time_str} |

"""
    if session_data["prompts"]:
        md += "## User Prompts\n\n"
        for i, prompt in enumerate(session_data["prompts"], 1):
            if len(prompt) > 500:
                md += f"### Prompt {i}\n\n<details>\n<summary>Show full prompt ({len(prompt)} chars)</summary>\n\n```\n{prompt}\n```\n\n</details>\n\n"
            else:
                md += f"### Prompt {i}\n\n```\n{prompt}\n```\n\n"
    if session_data["files_edited"]:
        md += "## Files Edited\n\n"
        for f in list(dict.fromkeys(session_data["files_edited"])):
            md += f"- `{f}`\n"
        md += "\n"
    if session_data["files_created"]:
        md += "## Files Created\n\n"
        for f in list(dict.fromkeys(session_data["files_created"])):
            md += f"- `{f}`\n"
        md += "\n"
    if session_data["commands_run"]:
        md += "## Commands Run\n\n```bash\n"
        for cmd in session_data["commands_run"][:20]:
            md += f"{cmd[:200]}\n"
        if len(session_data["commands_run"]) > 20:
            md += f"# ... and {len(session_data['commands_run']) - 20} more commands\n"
        md += "```\n\n"
    if session_data["tool_uses"]:
        tool_counts = {}
        for tu in session_data["tool_uses"]:
            tool_counts[tu["tool"]] = tool_counts.get(tu["tool"], 0) + 1
        md += "## Tool Usage Summary\n\n| Tool | Count |\n|------|-------|\n"
        for tool, count in sorted(tool_counts.items(), key=lambda x: -x[1]):
            md += f"| {tool} | {count} |\n"
        md += "\n"
    md += "---\n\n*Exported by Claude Code Obsidian Hook*\n"
    return md


def main():
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)
    transcript_path = input_data.get("transcript_path", "")
    vault_path = get_obsidian_vault_path()
    if not vault_path:
        print("[Obsidian Hook] OBSIDIAN_VAULT_PATH not set, skipping export", file=sys.stderr)
        sys.exit(0)
    session_data = parse_transcript(transcript_path)
    if not session_data["prompts"]:
        print("[Obsidian Hook] No prompts found, skipping export", file=sys.stderr)
        sys.exit(0)
    markdown = generate_markdown(session_data, input_data)
    timestamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
    session_id = input_data.get("session_id", "unknown")[:8]
    filename = f"claude-session-{timestamp}-{session_id}.md"
    output_path = vault_path / filename
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(markdown)
    print(f"[Obsidian Hook] Session exported to: {output_path}", file=sys.stderr)
    sys.exit(0)


if __name__ == "__main__":
    main()
