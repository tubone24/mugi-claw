#!/bin/bash
# =============================================================================
# Claude Code Hooks → Langfuse Logger (v2 - 全フィールド記録版)
#
# データモデル:
#   Claude Code session_id  → Langfuse Session (sessionId)
#   各ユーザープロンプト    → Langfuse Trace (ターン単位)
#   ツール実行              → Span (input=tool_input, output=tool_response)
#   サブエージェント        → Span (子ツールの親として機能)
#   通知/コンパクション     → Event (専用ハンドラ)
#   セッション終了時        → Generation (トークン使用量・コスト)
#
# 状態管理 (/tmp/claude-langfuse/{session_id}/):
#   current-trace-id              現在アクティブなトレースID
#   turn-counter                  ターン番号
#   model                         使用モデル名
#   git-branch                    gitブランチ名
#   git-commit                    gitコミットハッシュ
#   span-{tool}-{agent|root}      ツールSpan ID (Pre/Post ペアリング用)
#   subagent-{agent_id}           サブエージェントSpan ID (親子構造用)
#   subagent-type-{agent_type}    サブエージェントSpan ID (フォールバック)
# =============================================================================
set -uo pipefail

# --- 認証情報の読み込み ---
ENV_FILE="$HOME/.claude/.env"
# shellcheck disable=SC1090
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE" || exit 0
[[ -z "${LANGFUSE_PUBLIC_KEY:-}" || -z "${LANGFUSE_SECRET_KEY:-}" ]] && exit 0
LANGFUSE_BASE_URL="${LANGFUSE_BASE_URL:-https://us.cloud.langfuse.com}"

# --- 入力の読み込み ---
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
EVENT_NAME=$(echo "$INPUT" | jq -r '.hook_event_name // "unknown"')
CWD=$(echo "$INPUT" | jq -r '.cwd // ""')
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // ""')
AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // ""')
PERM_MODE=$(echo "$INPUT" | jq -r '.permission_mode // ""')
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

# --- Auth (Basic認証) ---
AUTH=$(printf '%s:%s' "$LANGFUSE_PUBLIC_KEY" "$LANGFUSE_SECRET_KEY" | base64)

# --- 環境設定 ---
LANGFUSE_ENVIRONMENT="${LANGFUSE_ENVIRONMENT:-development}"

# --- 状態管理ディレクトリ ---
STATE_DIR="/tmp/claude-langfuse/${SESSION_ID}"
mkdir -p "$STATE_DIR"

# =============================================================================
# ヘルパー関数
# =============================================================================

# 現在のトレースIDを取得 (なければ session_id をフォールバック)
get_trace_id() {
  cat "$STATE_DIR/current-trace-id" 2>/dev/null || echo "$SESSION_ID"
}

# ターンカウンターをインクリメントして返す
next_turn() {
  local counter
  counter=$(cat "$STATE_DIR/turn-counter" 2>/dev/null || echo 0)
  counter=$((counter + 1))
  echo "$counter" > "$STATE_DIR/turn-counter"
  echo "$counter"
}

# 保存済みモデル名を取得
get_model() {
  cat "$STATE_DIR/model" 2>/dev/null || echo "claude-opus-4-6"
}

# Langfuse Ingestion API に非同期送信
send() {
  curl -s -X POST "${LANGFUSE_BASE_URL}/api/public/ingestion" \
    -H "Authorization: Basic $AUTH" \
    -H "Content-Type: application/json" \
    -d "$1" \
    --max-time 5 \
    > /dev/null 2>&1 &
}

# サブエージェント内なら親SpanのIDを返す (グラフ構造用)
get_parent_id() {
  if [[ -n "$AGENT_ID" ]]; then
    cat "$STATE_DIR/subagent-${AGENT_ID}" 2>/dev/null || echo ""
  else
    echo ""
  fi
}

# JSONを安全にトランケート (大きすぎる場合はJSON文字列に変換)
safe_json() {
  local max_len=${1:-10240}
  local raw
  raw=$(cat)
  if [[ ${#raw} -le $max_len ]]; then
    echo "$raw"
  else
    printf '%s' "$raw" | head -c "$max_len" | jq -Rs '. + "... [truncated]"' 2>/dev/null \
      || echo "\"[output truncated, original ${#raw} chars]\""
  fi
}

# モデル別価格 (USD per token) を取得
# 返り値: "input_price output_price cache_read_price cache_create_price" (1トークンあたり)
get_model_pricing() {
  local model="$1"
  case "$model" in
    *opus*)
      # Opus 4.6: $5/$25/$0.50/$6.25 per MTok
      echo "0.000005 0.000025 0.0000005 0.00000625"
      ;;
    *haiku*)
      # Haiku 4.5: $1/$5/$0.10/$1.25 per MTok
      echo "0.000001 0.000005 0.0000001 0.00000125"
      ;;
    *)
      # Sonnet 4.6/4.5 (default): $3/$15/$0.30/$3.75 per MTok
      echo "0.000003 0.000015 0.0000003 0.00000375"
      ;;
  esac
}

# トークン数からコストを計算 (USD)
# 引数: model input_tokens output_tokens cache_read cache_create
# 返り値: "input_cost output_cost total_cost" (USD)
calc_cost() {
  local model="$1"
  local input_tok="${2:-0}" output_tok="${3:-0}" cache_read="${4:-0}" cache_create="${5:-0}"
  local pricing
  pricing=$(get_model_pricing "$model")
  # shellcheck disable=SC2086
  set -- $pricing
  local ip="$1" op="$2" crp="$3" ccp="$4"
  # non-cached input = total input - cache_read - cache_create
  # cost = non_cached * input_price + cache_read * cache_read_price + cache_create * cache_create_price + output * output_price
  awk -v it="$input_tok" -v ot="$output_tok" -v cr="$cache_read" -v cc="$cache_create" \
      -v ip="$ip" -v op="$op" -v crp="$crp" -v ccp="$ccp" \
    'BEGIN {
      non_cached = it - cr - cc
      if (non_cached < 0) non_cached = 0
      ic = non_cached * ip + cr * crp + cc * ccp
      oc = ot * op
      printf "%.10f %.10f %.10f", ic, oc, ic + oc
    }'
}

# Git情報を取得・保存
capture_git_info() {
  local dir="$1"
  if command -v git &>/dev/null && [[ -d "$dir" ]]; then
    local branch commit
    branch=$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    commit=$(git -C "$dir" rev-parse --short HEAD 2>/dev/null || echo "")
    [[ -n "$branch" ]] && echo "$branch" > "$STATE_DIR/git-branch"
    [[ -n "$commit" ]] && echo "$commit" > "$STATE_DIR/git-commit"
  fi
}

get_git_branch() {
  cat "$STATE_DIR/git-branch" 2>/dev/null || echo ""
}

get_git_commit() {
  cat "$STATE_DIR/git-commit" 2>/dev/null || echo ""
}

# 保存済みプロンプトを取得
get_saved_prompt() {
  cat "$STATE_DIR/prompt" 2>/dev/null || echo ""
}

# 保存済みターン番号を取得
get_saved_turn() {
  cat "$STATE_DIR/turn-counter" 2>/dev/null || echo "0"
}

# =============================================================================
# イベントハンドリング
# =============================================================================
case "$EVENT_NAME" in

  # ---------------------------------------------------------------------------
  # セッション開始 → 初期トレース作成 + Git情報 + 環境情報
  # ---------------------------------------------------------------------------
  SessionStart)
    TRACE_ID="${SESSION_ID}-init"
    echo "$TRACE_ID" > "$STATE_DIR/current-trace-id"
    echo "0" > "$STATE_DIR/turn-counter"

    SOURCE=$(echo "$INPUT" | jq -r '.source // ""')
    MODEL=$(echo "$INPUT" | jq -r '.model // "claude-opus-4-6"')
    echo "$MODEL" > "$STATE_DIR/model"

    # Git情報をキャプチャ
    capture_git_info "$CWD"
    GIT_BRANCH=$(get_git_branch)
    GIT_COMMIT=$(get_git_commit)

    PAYLOAD=$(jq -n \
      --arg traceId "$TRACE_ID" \
      --arg sessionId "$SESSION_ID" \
      --arg ts "$TIMESTAMP" \
      --arg cwd "$CWD" \
      --arg permMode "$PERM_MODE" \
      --arg source "$SOURCE" \
      --arg model "$MODEL" \
      --arg env "$LANGFUSE_ENVIRONMENT" \
      --arg gitBranch "$GIT_BRANCH" \
      --arg gitCommit "$GIT_COMMIT" \
      '{
        batch: [{
          id: ("trace-" + $traceId),
          type: "trace-create",
          timestamp: $ts,
          body: {
            id: $traceId,
            sessionId: $sessionId,
            name: "session-init",
            environment: $env,
            tags: ([$model, ("source:" + $source)] + (if $gitBranch != "" then [("branch:" + $gitBranch)] else [] end)),
            input: {
              cwd: $cwd,
              permission_mode: $permMode,
              source: $source,
              model: $model
            },
            metadata: ({
              source: "claude-code-hooks",
              session_source: $source,
              model: $model,
              permission_mode: $permMode
            } + (if $gitBranch != "" then { git_branch: $gitBranch, git_commit: $gitCommit } else {} end))
          }
        }]
      }')
    send "$PAYLOAD"
    ;;

  # ---------------------------------------------------------------------------
  # ユーザープロンプト → 新しいトレース作成 (ターン単位)
  # ---------------------------------------------------------------------------
  UserPromptSubmit)
    TURN=$(next_turn)
    TRACE_ID="${SESSION_ID}-turn-${TURN}"
    echo "$TRACE_ID" > "$STATE_DIR/current-trace-id"

    PROMPT=$(echo "$INPUT" | jq -r '.prompt // ""' | head -c 10240)
    # Stop ハンドラでの trace 更新時に name/input を復元するため保存
    echo "$PROMPT" > "$STATE_DIR/prompt"
    MODEL=$(get_model)
    GIT_BRANCH=$(get_git_branch)

    # トランスクリプトの現在行数を保存 (Stop時の差分計算用)
    if [[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]]; then
      wc -l < "$TRANSCRIPT_PATH" | tr -d ' ' > "$STATE_DIR/transcript-offset"
    fi

    PAYLOAD=$(jq -n \
      --arg traceId "$TRACE_ID" \
      --arg sessionId "$SESSION_ID" \
      --arg ts "$TIMESTAMP" \
      --arg prompt "$PROMPT" \
      --arg env "$LANGFUSE_ENVIRONMENT" \
      --arg model "$MODEL" \
      --arg cwd "$CWD" \
      --arg gitBranch "$GIT_BRANCH" \
      --argjson turn "$TURN" \
      '{
        batch: [{
          id: ("trace-" + $traceId),
          type: "trace-create",
          timestamp: $ts,
          body: {
            id: $traceId,
            sessionId: $sessionId,
            name: ("turn-" + ($turn | tostring)),
            environment: $env,
            tags: ([$model] + (if $gitBranch != "" then [("branch:" + $gitBranch)] else [] end)),
            input: { prompt: $prompt },
            metadata: {
              turn: $turn,
              cwd: $cwd,
              model: $model
            }
          }
        }]
      }')
    send "$PAYLOAD"
    ;;

  # ---------------------------------------------------------------------------
  # ツール実行開始 → Span作成 (parentObservationId でグラフ構造)
  # ---------------------------------------------------------------------------
  PreToolUse)
    TRACE_ID=$(get_trace_id)
    TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
    TOOL_INPUT=$(echo "$INPUT" | jq -c '.tool_input // {}' | safe_json 10240)
    TOOL_USE_ID=$(echo "$INPUT" | jq -r '.tool_use_id // ""')
    SPAN_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
    PARENT_ID=$(get_parent_id)

    # PostToolUse とのペアリング用に保存
    # tool_use_id があれば一意キーとして使用 (並列実行時の衝突回避)
    if [[ -n "$TOOL_USE_ID" ]]; then
      echo "$SPAN_ID" > "$STATE_DIR/span-id-${TOOL_USE_ID}"
    fi
    echo "$SPAN_ID" > "$STATE_DIR/span-${TOOL_NAME}-${AGENT_ID:-root}"

    # tool_input からキーフィールドを抽出 (振り返り用のコンテキスト)
    INPUT_SUMMARY=$(echo "$INPUT" | jq -c '{
      file_path: .tool_input.file_path,
      command: (.tool_input.command // .tool_input.description),
      pattern: .tool_input.pattern,
      url: .tool_input.url,
      query: .tool_input.query,
      prompt: (.tool_input.prompt // null | if . then .[0:200] else null end),
      skill: .tool_input.skill
    } | with_entries(select(.value != null))' 2>/dev/null || echo '{}')

    PAYLOAD=$(jq -n \
      --arg id "$SPAN_ID" \
      --arg traceId "$TRACE_ID" \
      --arg name "tool:${TOOL_NAME}" \
      --arg ts "$TIMESTAMP" \
      --argjson input "$TOOL_INPUT" \
      --arg toolName "$TOOL_NAME" \
      --arg toolUseId "$TOOL_USE_ID" \
      --arg parentId "$PARENT_ID" \
      --argjson inputSummary "$INPUT_SUMMARY" \
      '{
        batch: [{
          id: ("span-" + $id),
          type: "span-create",
          timestamp: $ts,
          body: ({
            id: $id,
            traceId: $traceId,
            name: $name,
            startTime: $ts,
            input: $input,
            metadata: ({
              tool_name: $toolName,
              input_summary: $inputSummary
            } + (if $toolUseId != "" then { tool_use_id: $toolUseId } else {} end))
          } + (if $parentId != "" then { parentObservationId: $parentId } else {} end))
        }]
      }')
    send "$PAYLOAD"
    ;;

  # ---------------------------------------------------------------------------
  # ツール実行完了 → Span更新
  # output: tool_response + tool_input のコンテキスト情報
  # ---------------------------------------------------------------------------
  PostToolUse)
    TRACE_ID=$(get_trace_id)
    TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
    TOOL_USE_ID=$(echo "$INPUT" | jq -r '.tool_use_id // ""')

    # tool_response を安全に抽出
    TOOL_RESPONSE=$(echo "$INPUT" | jq -c '.tool_response // null' | safe_json 10240)

    # tool_input を丸ごと保持 (振り返り時に入力も確認可能)
    TOOL_INPUT_FULL=$(echo "$INPUT" | jq -c '.tool_input // {}' | safe_json 10240)

    # 出力を構造化: response(実行結果) + input(何を実行したか)
    OUTPUT_JSON=$(jq -n \
      --argjson response "$TOOL_RESPONSE" \
      --argjson input "$TOOL_INPUT_FULL" \
      --arg toolName "$TOOL_NAME" \
      '{
        tool_name: $toolName,
        input: $input,
        response: $response
      }')

    # tool_use_id でspan検索 → tool_name フォールバック (並列実行対応)
    SPAN_ID=""
    SPAN_FILE=""
    if [[ -n "$TOOL_USE_ID" && -f "$STATE_DIR/span-id-${TOOL_USE_ID}" ]]; then
      SPAN_FILE="$STATE_DIR/span-id-${TOOL_USE_ID}"
      SPAN_ID=$(cat "$SPAN_FILE")
      rm -f "$SPAN_FILE"
      # tool_name ベースのファイルも掃除 (重複防止)
      rm -f "$STATE_DIR/span-${TOOL_NAME}-${AGENT_ID:-root}" 2>/dev/null
    elif [[ -f "$STATE_DIR/span-${TOOL_NAME}-${AGENT_ID:-root}" ]]; then
      SPAN_FILE="$STATE_DIR/span-${TOOL_NAME}-${AGENT_ID:-root}"
      SPAN_ID=$(cat "$SPAN_FILE")
      rm -f "$SPAN_FILE"
    fi

    if [[ -n "$SPAN_ID" ]]; then
      PAYLOAD=$(jq -n \
        --arg id "$SPAN_ID" \
        --arg traceId "$TRACE_ID" \
        --arg ts "$TIMESTAMP" \
        --argjson output "$OUTPUT_JSON" \
        --arg toolName "$TOOL_NAME" \
        --arg toolUseId "$TOOL_USE_ID" \
        '{
          batch: [{
            id: ("span-upd-" + $id),
            type: "span-update",
            timestamp: $ts,
            body: {
              id: $id,
              traceId: $traceId,
              endTime: $ts,
              output: $output,
              level: "DEFAULT",
              statusMessage: "success",
              metadata: ({
                status: "success",
                tool_name: $toolName
              } + (if $toolUseId != "" then { tool_use_id: $toolUseId } else {} end))
            }
          }]
        }')
    else
      EVT_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
      PAYLOAD=$(jq -n \
        --arg id "$EVT_ID" \
        --arg traceId "$TRACE_ID" \
        --arg name "tool_success:${TOOL_NAME}" \
        --arg ts "$TIMESTAMP" \
        --argjson output "$OUTPUT_JSON" \
        '{
          batch: [{
            id: ("event-" + $id),
            type: "event-create",
            timestamp: $ts,
            body: {
              id: $id,
              traceId: $traceId,
              name: $name,
              startTime: $ts,
              level: "DEFAULT",
              output: $output
            }
          }]
        }')
    fi
    send "$PAYLOAD"
    ;;

  # ---------------------------------------------------------------------------
  # ツール実行失敗 → Span更新
  # output: error + tool_input のコンテキスト情報
  # ---------------------------------------------------------------------------
  PostToolUseFailure)
    TRACE_ID=$(get_trace_id)
    TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
    TOOL_USE_ID=$(echo "$INPUT" | jq -r '.tool_use_id // ""')
    ERROR_MSG=$(echo "$INPUT" | jq -r '.error // ""' | head -c 5120)
    IS_INTERRUPT=$(echo "$INPUT" | jq '.is_interrupt // false')

    # tool_input を丸ごと保持
    TOOL_INPUT_FULL=$(echo "$INPUT" | jq -c '.tool_input // {}' | safe_json 10240)

    # 出力を構造化: error + input(何が失敗したか)
    OUTPUT_JSON=$(jq -n \
      --arg error "$ERROR_MSG" \
      --argjson isInterrupt "$IS_INTERRUPT" \
      --argjson input "$TOOL_INPUT_FULL" \
      --arg toolName "$TOOL_NAME" \
      '{
        tool_name: $toolName,
        error: $error,
        is_interrupt: $isInterrupt,
        input: $input
      }')

    # tool_use_id でspan検索 → tool_name フォールバック
    SPAN_ID=""
    if [[ -n "$TOOL_USE_ID" && -f "$STATE_DIR/span-id-${TOOL_USE_ID}" ]]; then
      SPAN_ID=$(cat "$STATE_DIR/span-id-${TOOL_USE_ID}")
      rm -f "$STATE_DIR/span-id-${TOOL_USE_ID}"
      rm -f "$STATE_DIR/span-${TOOL_NAME}-${AGENT_ID:-root}" 2>/dev/null
    elif [[ -f "$STATE_DIR/span-${TOOL_NAME}-${AGENT_ID:-root}" ]]; then
      SPAN_ID=$(cat "$STATE_DIR/span-${TOOL_NAME}-${AGENT_ID:-root}")
      rm -f "$STATE_DIR/span-${TOOL_NAME}-${AGENT_ID:-root}"
    fi

    if [[ -n "$SPAN_ID" ]]; then
      PAYLOAD=$(jq -n \
        --arg id "$SPAN_ID" \
        --arg traceId "$TRACE_ID" \
        --arg ts "$TIMESTAMP" \
        --argjson output "$OUTPUT_JSON" \
        --arg errorMsg "$ERROR_MSG" \
        --arg toolName "$TOOL_NAME" \
        --argjson isInterrupt "$IS_INTERRUPT" \
        --arg toolUseId "$TOOL_USE_ID" \
        '{
          batch: [{
            id: ("span-upd-" + $id),
            type: "span-update",
            timestamp: $ts,
            body: {
              id: $id,
              traceId: $traceId,
              endTime: $ts,
              output: $output,
              level: "ERROR",
              statusMessage: $errorMsg,
              metadata: ({
                status: "failure",
                tool_name: $toolName,
                is_interrupt: $isInterrupt
              } + (if $toolUseId != "" then { tool_use_id: $toolUseId } else {} end))
            }
          }]
        }')
    else
      EVT_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
      PAYLOAD=$(jq -n \
        --arg id "$EVT_ID" \
        --arg traceId "$TRACE_ID" \
        --arg name "tool_failure:${TOOL_NAME}" \
        --arg ts "$TIMESTAMP" \
        --argjson output "$OUTPUT_JSON" \
        '{
          batch: [{
            id: ("event-" + $id),
            type: "event-create",
            timestamp: $ts,
            body: {
              id: $id,
              traceId: $traceId,
              name: $name,
              startTime: $ts,
              level: "ERROR",
              output: $output
            }
          }]
        }')
    fi
    send "$PAYLOAD"
    ;;

  # ---------------------------------------------------------------------------
  # サブエージェント開始 → Span作成 (子ツールの親になる)
  # ---------------------------------------------------------------------------
  SubagentStart)
    TRACE_ID=$(get_trace_id)
    AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // "unknown"')
    SUB_AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // ""')
    DESCRIPTION=$(echo "$INPUT" | jq -r '.description // ""')
    SPAN_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')

    # agent_id で保存 → 子ツールの parentObservationId に使われる
    if [[ -n "$SUB_AGENT_ID" ]]; then
      echo "$SPAN_ID" > "$STATE_DIR/subagent-${SUB_AGENT_ID}"
    fi
    echo "$SPAN_ID" > "$STATE_DIR/subagent-type-${AGENT_TYPE}"

    PAYLOAD=$(jq -n \
      --arg id "$SPAN_ID" \
      --arg traceId "$TRACE_ID" \
      --arg name "subagent:${AGENT_TYPE}" \
      --arg ts "$TIMESTAMP" \
      --arg agentType "$AGENT_TYPE" \
      --arg agentId "$SUB_AGENT_ID" \
      --arg description "$DESCRIPTION" \
      --arg cwd "$CWD" \
      '{
        batch: [{
          id: ("span-" + $id),
          type: "span-create",
          timestamp: $ts,
          body: {
            id: $id,
            traceId: $traceId,
            name: $name,
            startTime: $ts,
            input: ({
              agent_type: $agentType,
              cwd: $cwd
            } + (if $description != "" then { description: $description } else {} end)),
            metadata: ({
              agent_type: $agentType
            } + (if $agentId != "" then { agent_id: $agentId } else {} end))
          }
        }]
      }')
    send "$PAYLOAD"
    ;;

  # ---------------------------------------------------------------------------
  # サブエージェント終了 → Span更新 (output に last_assistant_message を記録)
  # ---------------------------------------------------------------------------
  SubagentStop)
    TRACE_ID=$(get_trace_id)
    AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // "unknown"')
    SUB_AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // ""')
    LAST_MSG=$(echo "$INPUT" | jq -r '.last_assistant_message // ""' | head -c 10240)
    AGENT_TRANSCRIPT=$(echo "$INPUT" | jq -r '.agent_transcript_path // ""')
    STOP_HOOK=$(echo "$INPUT" | jq '.stop_hook_active // false')

    SPAN_ID=""
    if [[ -n "$SUB_AGENT_ID" && -f "$STATE_DIR/subagent-${SUB_AGENT_ID}" ]]; then
      SPAN_ID=$(cat "$STATE_DIR/subagent-${SUB_AGENT_ID}")
      rm -f "$STATE_DIR/subagent-${SUB_AGENT_ID}"
    elif [[ -f "$STATE_DIR/subagent-type-${AGENT_TYPE}" ]]; then
      SPAN_ID=$(cat "$STATE_DIR/subagent-type-${AGENT_TYPE}")
      rm -f "$STATE_DIR/subagent-type-${AGENT_TYPE}"
    fi

    if [[ -n "$SPAN_ID" ]]; then
      PAYLOAD=$(jq -n \
        --arg id "$SPAN_ID" \
        --arg traceId "$TRACE_ID" \
        --arg ts "$TIMESTAMP" \
        --arg lastMsg "$LAST_MSG" \
        --arg agentType "$AGENT_TYPE" \
        --arg agentTranscript "$AGENT_TRANSCRIPT" \
        --argjson stopHook "$STOP_HOOK" \
        '{
          batch: [{
            id: ("span-upd-" + $id),
            type: "span-update",
            timestamp: $ts,
            body: {
              id: $id,
              traceId: $traceId,
              endTime: $ts,
              output: {
                last_assistant_message: $lastMsg,
                agent_type: $agentType
              },
              statusMessage: "completed",
              metadata: ({
                status: "completed",
                stop_hook_active: $stopHook
              } + (if $agentTranscript != "" then { agent_transcript_path: $agentTranscript } else {} end))
            }
          }]
        }')
    else
      EVT_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
      PAYLOAD=$(jq -n \
        --arg id "$EVT_ID" \
        --arg traceId "$TRACE_ID" \
        --arg name "subagent_stop:${AGENT_TYPE}" \
        --arg ts "$TIMESTAMP" \
        --arg lastMsg "$LAST_MSG" \
        --arg agentType "$AGENT_TYPE" \
        '{
          batch: [{
            id: ("event-" + $id),
            type: "event-create",
            timestamp: $ts,
            body: {
              id: $id,
              traceId: $traceId,
              name: $name,
              startTime: $ts,
              output: {
                last_assistant_message: $lastMsg,
                agent_type: $agentType
              }
            }
          }]
        }')
    fi
    send "$PAYLOAD"
    ;;

  # ---------------------------------------------------------------------------
  # 通知 → Event作成 (メッセージ・タイプを記録)
  # ---------------------------------------------------------------------------
  Notification)
    TRACE_ID=$(get_trace_id)
    EVT_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
    NOTIF_MSG=$(echo "$INPUT" | jq -r '.message // ""' | head -c 5120)
    NOTIF_TITLE=$(echo "$INPUT" | jq -r '.title // ""')
    NOTIF_TYPE=$(echo "$INPUT" | jq -r '.notification_type // ""')

    PAYLOAD=$(jq -n \
      --arg id "$EVT_ID" \
      --arg traceId "$TRACE_ID" \
      --arg ts "$TIMESTAMP" \
      --arg message "$NOTIF_MSG" \
      --arg title "$NOTIF_TITLE" \
      --arg notifType "$NOTIF_TYPE" \
      '{
        batch: [{
          id: ("event-" + $id),
          type: "event-create",
          timestamp: $ts,
          body: {
            id: $id,
            traceId: $traceId,
            name: ("notification:" + $notifType),
            startTime: $ts,
            input: {
              title: $title,
              message: $message,
              notification_type: $notifType
            },
            metadata: {
              notification_type: $notifType
            }
          }
        }]
      }')
    send "$PAYLOAD"
    ;;

  # ---------------------------------------------------------------------------
  # コンテキスト圧縮前 → Event作成 (トリガー・カスタム指示を記録)
  # ---------------------------------------------------------------------------
  PreCompact)
    TRACE_ID=$(get_trace_id)
    EVT_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
    TRIGGER=$(echo "$INPUT" | jq -r '.trigger // ""')
    CUSTOM_INSTR=$(echo "$INPUT" | jq -r '.custom_instructions // ""' | head -c 5120)

    PAYLOAD=$(jq -n \
      --arg id "$EVT_ID" \
      --arg traceId "$TRACE_ID" \
      --arg ts "$TIMESTAMP" \
      --arg trigger "$TRIGGER" \
      --arg customInstr "$CUSTOM_INSTR" \
      '{
        batch: [{
          id: ("event-" + $id),
          type: "event-create",
          timestamp: $ts,
          body: {
            id: $id,
            traceId: $traceId,
            name: ("compact:" + $trigger),
            startTime: $ts,
            level: "WARNING",
            input: {
              trigger: $trigger,
              custom_instructions: $customInstr
            },
            metadata: {
              trigger: $trigger
            }
          }
        }]
      }')
    send "$PAYLOAD"
    ;;

  # ---------------------------------------------------------------------------
  # 応答完了 → ターンごとのトークン使用量・コスト記録 + 応答テキスト
  # ---------------------------------------------------------------------------
  Stop)
    TRACE_ID=$(get_trace_id)
    MODEL=$(get_model)
    BATCH="[]"
    EVT_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')

    # last_assistant_message を抽出
    LAST_MSG=$(echo "$INPUT" | jq -r '.last_assistant_message // ""' | head -c 10240)
    STOP_HOOK_ACTIVE=$(echo "$INPUT" | jq '.stop_hook_active // false')

    # 保存済みのプロンプト・ターン番号を復元 (trace の name/input 復元用)
    SAVED_PROMPT=$(get_saved_prompt)
    SAVED_TURN=$(get_saved_turn)
    GIT_BRANCH=$(get_git_branch)

    # response_complete イベント
    BATCH=$(echo "$BATCH" | jq \
      --arg id "$EVT_ID" \
      --arg traceId "$TRACE_ID" \
      --arg ts "$TIMESTAMP" \
      --arg lastMsg "$LAST_MSG" \
      --argjson stopHookActive "$STOP_HOOK_ACTIVE" \
      '. + [{
        id: ("event-" + $id),
        type: "event-create",
        timestamp: $ts,
        body: {
          id: $id,
          traceId: $traceId,
          name: "response_complete",
          startTime: $ts,
          output: {
            last_assistant_message: $lastMsg
          },
          metadata: {
            stop_hook_active: $stopHookActive
          }
        }
      }]')

    # ターン内の全LLM呼び出しを個別 Generation として記録
    # トランスクリプトの差分 (UserPromptSubmit 以降) から assistant メッセージを抽出
    INPUT_TOKENS=0
    OUTPUT_TOKENS=0
    CACHE_READ=0
    CACHE_CREATE=0
    if [[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]]; then
      TRANSCRIPT_OFFSET=$(cat "$STATE_DIR/transcript-offset" 2>/dev/null || echo "0")

      # 制御文字 (U+0000〜U+001F、ただし改行\n=\012は除く) を除去してからパース
      # トランスクリプトに含まれるタブ等の制御文字が jq パースエラーを起こすため
      TURN_LINES=$(tail -n +"$((TRANSCRIPT_OFFSET + 1))" "$TRANSCRIPT_PATH" 2>/dev/null \
        | tr -d '\000-\011\013\014\016-\037')

      # モデル価格を取得 (jq に渡すため)
      # shellcheck disable=SC2086
      PRICING=$(get_model_pricing "$MODEL")
      set -- $PRICING
      P_INPUT="$1" P_OUTPUT="$2" P_CACHE_READ="$3" P_CACHE_CREATE="$4"

      # 全 assistant メッセージを jq 一発で generation batch に変換
      # thinking-only メッセージは次のメッセージにマージ (input=thinking, output=text/tool_use)
      # Claude は thinking と text/tool_use を別々の assistant メッセージとして出力するため
      GENERATION_BATCH=$(echo "$TURN_LINES" \
        | jq -sc --arg traceId "$TRACE_ID" \
          --argjson pInput "$P_INPUT" --argjson pOutput "$P_OUTPUT" \
          --argjson pCacheRead "$P_CACHE_READ" --argjson pCacheCreate "$P_CACHE_CREATE" '
          [.[] | select(.type == "assistant" and .message.usage != null)] |
          if length == 0 then [] else
            # Phase 1: thinking-only メッセージを次のメッセージにマージ
            # thinking-only = content に thinking しかなく stop_reason が null
            # Claude は thinking と text/tool_use を別メッセージで出力するため
            . as $msgs |
            reduce range($msgs | length) as $i (
              {merged: [], pending_thinking: null, pending_usage: null};
              ($msgs[$i].message.content // []) as $content |
              ($content | map(.type) | unique) as $types |
              if ($types == ["thinking"]) and ($msgs[$i].message.stop_reason == null) then
                # thinking-only: 次のメッセージにマージするため保留
                .pending_thinking = ($content | map(select(.type == "thinking") | .thinking) | join("") | .[0:4000]) |
                .pending_usage = $msgs[$i].message.usage
              else
                # 通常メッセージ: 保留中の thinking があればマージ
                ($content | map(select(.type == "thinking") | .thinking) | join("")) as $own_thinking |
                ([.pending_thinking, $own_thinking] | map(select(. != null and . != "")) | join("\n") | .[0:4000]) as $all_thinking |
                # usage をマージ (thinking-only の usage を加算)
                ($msgs[$i].message.usage) as $cur_usage |
                (if .pending_usage != null then {
                  input_tokens: ((.pending_usage.input_tokens // 0) + ($cur_usage.input_tokens // 0)),
                  output_tokens: ((.pending_usage.output_tokens // 0) + ($cur_usage.output_tokens // 0)),
                  cache_read_input_tokens: ((.pending_usage.cache_read_input_tokens // 0) + ($cur_usage.cache_read_input_tokens // 0)),
                  cache_creation_input_tokens: ((.pending_usage.cache_creation_input_tokens // 0) + ($cur_usage.cache_creation_input_tokens // 0)),
                  service_tier: ($cur_usage.service_tier // .pending_usage.service_tier // null)
                } else $cur_usage end) as $merged_usage |
                .merged += [{
                  msg: $msgs[$i],
                  thinking: $all_thinking,
                  usage: $merged_usage
                }] |
                .pending_thinking = null |
                .pending_usage = null
              end
            ) |
            # 末尾に thinking-only が残った場合も記録
            (if .pending_thinking != null then
              .merged += [{
                msg: ($msgs | last),
                thinking: .pending_thinking,
                usage: .pending_usage
              }]
            else . end) |
            .merged |
            # Phase 2: generation batch に変換
            to_entries | map(
              .value as $entry |
              ($entry.msg.message.content // []) as $content |
              {
                id: ("gen-" + $traceId + "-" + (.key | tostring)),
                type: "generation-create",
                timestamp: $entry.msg.timestamp,
                body: {
                  id: ($traceId + "-llm-" + (.key | tostring)),
                  traceId: $traceId,
                  name: ("llm:" + ($entry.msg.message.stop_reason // "streaming")),
                  model: $entry.msg.message.model,
                  startTime: $entry.msg.timestamp,
                  input: (
                    if ($entry.thinking | length) > 0 then { thinking: $entry.thinking } else null end
                  ),
                  output: (
                    ($content | map(select(.type == "text") | .text) | join("")) as $text |
                    ($content | map(select(.type == "tool_use") | {name, id})) as $tools |
                    {
                      content: (
                        if ($text | length) > 0 then ($text | .[0:2000])
                        elif ($tools | length) > 0 then ($tools | map(.name) | join(", "))
                        else ""
                        end
                      ),
                      stop_reason: $entry.msg.message.stop_reason
                    }
                    + (if ($tools | length) > 0 then { tool_calls: $tools } else {} end)
                  ),
                  usage: {
                    input: ($entry.usage.input_tokens // 0),
                    output: ($entry.usage.output_tokens // 0),
                    total: (($entry.usage.input_tokens // 0) + ($entry.usage.output_tokens // 0)),
                    cache_read_input_tokens: ($entry.usage.cache_read_input_tokens // 0),
                    cache_creation_input_tokens: ($entry.usage.cache_creation_input_tokens // 0)
                  },
                  costDetails: (
                    ($entry.usage.input_tokens // 0) as $it |
                    ($entry.usage.output_tokens // 0) as $ot |
                    ($entry.usage.cache_read_input_tokens // 0) as $cr |
                    ($entry.usage.cache_creation_input_tokens // 0) as $cc |
                    ([$it - $cr - $cc, 0] | max) as $non_cached |
                    ($non_cached * $pInput + $cr * $pCacheRead + $cc * $pCacheCreate) as $ic |
                    ($ot * $pOutput) as $oc |
                    { input: $ic, output: $oc, total: ($ic + $oc) }
                  ),
                  metadata: ({
                    stop_reason: ($entry.msg.message.stop_reason // null),
                    llm_call_index: .key,
                    service_tier: ($entry.usage.service_tier // null)
                  } + (if ($entry.thinking | length) > 0 then {
                    has_thinking: true,
                    thinking_length: ($entry.thinking | length)
                  } else {} end))
                }
              }
            )
          end
        ' 2>/dev/null || echo '[]')

      # バッチに追加
      BATCH=$(echo "$BATCH" | jq --argjson gens "$GENERATION_BATCH" '. + $gens')

      # ターン合計トークンを集計 (trace 更新用)
      USAGE_TOTALS=$(echo "$TURN_LINES" \
        | jq -sc '[.[] | select(.type == "assistant" and .message.usage != null) | .message.usage] |
          if length == 0 then { input_tokens: 0, output_tokens: 0, cache_read: 0, cache_create: 0 }
          else {
            input_tokens: (map(.input_tokens // 0) | add),
            output_tokens: (map(.output_tokens // 0) | add),
            cache_read: (map(.cache_read_input_tokens // 0) | add),
            cache_create: (map(.cache_creation_input_tokens // 0) | add)
          } end' 2>/dev/null || echo '{}')

      INPUT_TOKENS=$(echo "$USAGE_TOTALS" | jq '.input_tokens // 0')
      OUTPUT_TOKENS=$(echo "$USAGE_TOTALS" | jq '.output_tokens // 0')
      CACHE_READ=$(echo "$USAGE_TOTALS" | jq '.cache_read // 0')
      CACHE_CREATE=$(echo "$USAGE_TOTALS" | jq '.cache_create // 0')
    fi

    # Trace 更新: output のみを追加 (name/sessionId/input は UserPromptSubmit で設定済み)
    # Langfuse の trace-create は upsert 動作: 空文字列は null に正規化され既存値を上書きする
    # そのため、復元不要なフィールドは省略して既存値を保持する
    TRACE_UPDATE_BODY=$(jq -n \
      --arg traceId "$TRACE_ID" \
      --arg sessionId "$SESSION_ID" \
      --arg lastMsg "$LAST_MSG" \
      --arg model "$MODEL" \
      --arg prompt "$SAVED_PROMPT" \
      --arg turn "$SAVED_TURN" \
      --arg env "$LANGFUSE_ENVIRONMENT" \
      --arg gitBranch "$GIT_BRANCH" \
      --arg cwd "$CWD" \
      --argjson inputTokens "$INPUT_TOKENS" \
      --argjson outputTokens "$OUTPUT_TOKENS" \
      '{
        id: $traceId,
        output: {
          last_assistant_message: $lastMsg,
          model: $model,
          input_tokens: $inputTokens,
          output_tokens: $outputTokens
        }
      }
      # sessionId/name/input/tags/metadata は省略フィールドは保持される
      # ただし SAVED_TURN が有効な場合のみ復元する (安全策)
      + (if $sessionId != "" and $sessionId != "unknown" then { sessionId: $sessionId } else {} end)
      + (if $turn != "" and $turn != "0" then {
          name: ("turn-" + $turn),
          input: { prompt: $prompt },
          metadata: {
            turn: ($turn | tonumber),
            cwd: $cwd,
            model: $model
          }
        } else {} end)
      + (if $env != "" then { environment: $env } else {} end)
      + (if $model != "" or $gitBranch != "" then {
          tags: ([$model] + (if $gitBranch != "" then [("branch:" + $gitBranch)] else [] end))
        } else {} end)
      ' 2>/dev/null)

    # jq が失敗した場合は最低限の output のみ送信
    if [[ -z "$TRACE_UPDATE_BODY" ]]; then
      TRACE_UPDATE_BODY=$(jq -n \
        --arg traceId "$TRACE_ID" \
        --arg lastMsg "$LAST_MSG" \
        --arg model "$MODEL" \
        --argjson inputTokens "$INPUT_TOKENS" \
        --argjson outputTokens "$OUTPUT_TOKENS" \
        '{
          id: $traceId,
          output: {
            last_assistant_message: $lastMsg,
            model: $model,
            input_tokens: $inputTokens,
            output_tokens: $outputTokens
          }
        }')
    fi

    BATCH=$(echo "$BATCH" | jq \
      --arg ts "$TIMESTAMP" \
      --arg traceId "$TRACE_ID" \
      --argjson body "$TRACE_UPDATE_BODY" \
      '. + [{
        id: ("trace-upd-" + $traceId),
        type: "trace-create",
        timestamp: $ts,
        body: $body
      }]')

    PAYLOAD=$(echo "$BATCH" | jq '{ batch: . }')
    send "$PAYLOAD"
    ;;

  # ---------------------------------------------------------------------------
  # セッション終了 → セッション全体の使用量・コスト集計 + 終了理由
  # ---------------------------------------------------------------------------
  SessionEnd)
    TRACE_ID=$(get_trace_id)
    MODEL=$(get_model)
    BATCH="[]"
    EVT_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
    REASON=$(echo "$INPUT" | jq -r '.reason // ""')

    # session_end イベント (終了理由を含む)
    BATCH=$(echo "$BATCH" | jq \
      --arg id "$EVT_ID" \
      --arg traceId "$TRACE_ID" \
      --arg ts "$TIMESTAMP" \
      --arg reason "$REASON" \
      '. + [{
        id: ("event-" + $id),
        type: "event-create",
        timestamp: $ts,
        body: {
          id: $id,
          traceId: $traceId,
          name: "session_end",
          startTime: $ts,
          output: {
            reason: $reason
          },
          metadata: {
            reason: $reason
          }
        }
      }]')

    # セッション全体のトークン使用量を集計
    if [[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]]; then
      USAGE_JSON=$(jq -s '
        [.[] | (.message? // .) | select(.usage != null) | .usage] |
        if length == 0 then
          { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
        else {
          input_tokens: (map(.input_tokens // 0) | add),
          output_tokens: (map(.output_tokens // 0) | add),
          cache_read_input_tokens: (map(.cache_read_input_tokens // 0) | add),
          cache_creation_input_tokens: (map(.cache_creation_input_tokens // 0) | add)
        } end
      ' "$TRANSCRIPT_PATH" 2>/dev/null \
        || echo '{"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}')

      INPUT_TOKENS=$(echo "$USAGE_JSON" | jq '.input_tokens // 0')
      OUTPUT_TOKENS=$(echo "$USAGE_JSON" | jq '.output_tokens // 0')
      CACHE_READ=$(echo "$USAGE_JSON" | jq '.cache_read_input_tokens // 0')
      CACHE_CREATE=$(echo "$USAGE_JSON" | jq '.cache_creation_input_tokens // 0')

      if [[ "$INPUT_TOKENS" != "0" || "$OUTPUT_TOKENS" != "0" ]]; then
        GEN_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')

        # コスト計算 (モデル別価格で正確に算出)
        COST_STR=$(calc_cost "$MODEL" "$INPUT_TOKENS" "$OUTPUT_TOKENS" "$CACHE_READ" "$CACHE_CREATE")
        # shellcheck disable=SC2086
        set -- $COST_STR
        COST_INPUT="$1" COST_OUTPUT="$2" COST_TOTAL="$3"

        # Generation: セッション全体の集計 (costDetails で正確なコストを直接指定)
        BATCH=$(echo "$BATCH" | jq \
          --arg id "$GEN_ID" \
          --arg traceId "$TRACE_ID" \
          --arg ts "$TIMESTAMP" \
          --arg model "$MODEL" \
          --arg reason "$REASON" \
          --argjson inputTokens "$INPUT_TOKENS" \
          --argjson outputTokens "$OUTPUT_TOKENS" \
          --argjson cacheRead "$CACHE_READ" \
          --argjson cacheCreate "$CACHE_CREATE" \
          --argjson costInput "$COST_INPUT" \
          --argjson costOutput "$COST_OUTPUT" \
          --argjson costTotal "$COST_TOTAL" \
          '. + [{
            id: ("gen-" + $id),
            type: "generation-create",
            timestamp: $ts,
            body: {
              id: $id,
              traceId: $traceId,
              name: "session-total-usage",
              model: $model,
              usage: {
                input: $inputTokens,
                output: $outputTokens,
                total: ($inputTokens + $outputTokens),
                cache_read_input_tokens: $cacheRead,
                cache_creation_input_tokens: $cacheCreate
              },
              costDetails: {
                input: $costInput,
                output: $costOutput,
                total: $costTotal
              },
              metadata: {
                reason: $reason
              }
            }
          }]')
      fi
    fi

    PAYLOAD=$(echo "$BATCH" | jq '{ batch: . }')
    send "$PAYLOAD"

    # 状態ファイルのクリーンアップ
    rm -rf "$STATE_DIR" 2>/dev/null
    ;;

  # ---------------------------------------------------------------------------
  # その他のイベント → 全フィールドをメタデータとして記録
  # (ConfigChange, InstructionsLoaded, PermissionRequest, WorktreeCreate/Remove等)
  # ---------------------------------------------------------------------------
  *)
    TRACE_ID=$(get_trace_id)
    EVT_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')

    # イベント固有フィールドをすべて抽出 (共通フィールドを除外)
    EVT_DATA=$(echo "$INPUT" | jq -c 'del(.session_id, .transcript_path, .cwd, .permission_mode, .hook_event_name, .agent_id)' 2>/dev/null || echo '{}')

    PAYLOAD=$(jq -n \
      --arg id "$EVT_ID" \
      --arg traceId "$TRACE_ID" \
      --arg name "$EVENT_NAME" \
      --arg ts "$TIMESTAMP" \
      --arg cwd "$CWD" \
      --argjson data "$EVT_DATA" \
      '{
        batch: [{
          id: ("event-" + $id),
          type: "event-create",
          timestamp: $ts,
          body: {
            id: $id,
            traceId: $traceId,
            name: $name,
            startTime: $ts,
            input: $data,
            metadata: ($data + { cwd: $cwd })
          }
        }]
      }')
    send "$PAYLOAD"
    ;;
esac

exit 0
