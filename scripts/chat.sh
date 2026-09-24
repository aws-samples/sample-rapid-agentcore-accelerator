#!/bin/bash
# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

# Interactive CLI chat with an agent.
#
# Default: invokes the deployed AgentCore runtime, reading the ARN for the named
# agent from .rapid/outputs.json.
# With --local: talks to a locally running container at localhost:8080.
#
# Usage: scripts/chat.sh <agent> [OPTIONS]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUTS_FILE="$REPO_ROOT/.rapid/outputs.json"

PORT="${PORT:-8080}"
USER_ID="${USER_ID:-local-user}"
SESSION_ID="${SESSION_ID:-session-$(uuidgen 2>/dev/null || echo "chat-$$-$(date +%s)")}"
STREAMING="${STREAMING:-false}"
LOCAL_MODE="false"
AGENT_NAME=""

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
GRAY='\033[0;90m'
NC='\033[0m'
BOLD='\033[1m'

usage() {
    echo "Usage: scripts/chat.sh <agent> [OPTIONS]"
    echo ""
    echo "Arguments:"
    echo "  <agent>          Agent name as it appears in config.yaml (e.g. customer-support)"
    echo ""
    echo "Options:"
    echo "  --local          Talk to a local container at localhost (instead of the deployed runtime)"
    echo "  --stream, -s     Enable streaming mode (display text incrementally)"
    echo "  --no-stream      Disable streaming mode (default)"
    echo "  --port, -p PORT  Agent port (default: 8080, only with --local)"
    echo "  --help, -h       Show this help message"
    echo ""
    echo "Environment variables:"
    echo "  PORT             Agent port (default: 8080, only with --local)"
    echo "  USER_ID          User ID for the session"
    echo "  SESSION_ID       Session ID"
    echo "  STREAMING        Enable streaming (true/false)"
    echo ""
    echo "By default, invokes the deployed AgentCore runtime using the ARN for"
    echo "<agent> from .rapid/outputs.json. Use --local for local development."
    echo ""
    echo "Examples:"
    echo "  scripts/chat.sh customer-support --stream"
    echo "  scripts/chat.sh it-helpdesk --local"
    echo "  make chat AGENT=it-helpdesk"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --local)
            LOCAL_MODE="true"
            shift
            ;;
        --stream|-s)
            STREAMING="true"
            shift
            ;;
        --no-stream)
            STREAMING="false"
            shift
            ;;
        --port|-p)
            PORT="$2"
            shift 2
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        -*)
            echo "Unknown option: $1" >&2
            echo "Use --help for usage information" >&2
            exit 1
            ;;
        *)
            if [ -n "$AGENT_NAME" ]; then
                echo "Unexpected argument: $1" >&2
                echo "Use --help for usage information" >&2
                exit 1
            fi
            AGENT_NAME="$1"
            shift
            ;;
    esac
done

if [ -z "$AGENT_NAME" ]; then
    echo "Error: no agent name given." >&2
    echo "" >&2
    usage >&2
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo "Error: jq is required. Install jq and try again." >&2
    exit 1
fi

# --- Local mode: the agent name only identifies which source tree is running ---
if [ "$LOCAL_MODE" = "true" ]; then
    if [ ! -d "$REPO_ROOT/agent/$AGENT_NAME/src" ]; then
        echo "Error: unknown agent \"$AGENT_NAME\" — agent/$AGENT_NAME/src does not exist." >&2
        echo "" >&2
        echo "Available agents:" >&2
        for dir in "$REPO_ROOT"/agent/*/src; do
            [ -d "$dir" ] || continue
            echo "  $(basename "$(dirname "$dir")")" >&2
        done
        exit 1
    fi
else
    # --- Deployed runtime setup (default mode) ---
    if [ ! -r "$OUTPUTS_FILE" ]; then
        echo "Outputs not found — run \`make deploy\` first." >&2
        exit 1
    fi

    AGENT_RUNTIME_ARN=$(jq -r --arg name "$AGENT_NAME" \
        '.agents[$name].runtimeArn // empty' "$OUTPUTS_FILE" 2>/dev/null)

    # No fallback to "the first agent": silently chatting with a different agent
    # than the one asked for is worse than failing.
    if [ -z "$AGENT_RUNTIME_ARN" ]; then
        echo "Error: no deployed runtime for agent \"$AGENT_NAME\" in .rapid/outputs.json." >&2
        echo "" >&2
        echo "Agents present in outputs:" >&2
        jq -r '.agents | keys[] | "  " + .' "$OUTPUTS_FILE" >&2 2>/dev/null \
            || echo "  (none)" >&2
        echo "" >&2
        echo "Run \`make deploy\` if this agent was added to config.yaml but not yet deployed." >&2
        exit 1
    fi

    # Extract region from the ARN (arn:aws:bedrock-agentcore:<region>:...) so the
    # CLI invokes the correct regional endpoint regardless of the shell's default.
    AGENT_REGION=$(echo "$AGENT_RUNTIME_ARN" | cut -d: -f4)
    if [ -z "$AGENT_REGION" ]; then
        AGENT_REGION="${AWS_DEFAULT_REGION:-${AWS_REGION:-us-east-1}}"
    fi
fi

clear

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║                                                           ║"
echo "║              🤖  Agent Chat  🤖                           ║"
echo "║                                                           ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "${GRAY}Agent: $AGENT_NAME${NC}"
echo -e "${GRAY}Session: $SESSION_ID${NC}"
echo -e "${GRAY}User: $USER_ID${NC}"
if [ "$LOCAL_MODE" = "true" ]; then
    echo -e "${GRAY}Endpoint: http://localhost:$PORT/invocations${NC}"
else
    echo -e "${GRAY}Runtime: $AGENT_RUNTIME_ARN${NC}"
fi
if [ "$STREAMING" = "true" ]; then
    echo -e "${GRAY}Mode: ${GREEN}Streaming enabled${NC}"
else
    echo -e "${GRAY}Mode: Non-streaming${NC}"
fi
echo ""
echo -e "${YELLOW}Type your message and press Enter. Type 'quit' or 'exit' to leave.${NC}"
echo -e "${YELLOW}Type 'clear' to clear the screen, 'new' for a new session.${NC}"
echo ""
echo -e "${GRAY}─────────────────────────────────────────────────────────────${NC}"
echo ""

# Build the request body with jq so quotes, backslashes, and newlines in the
# message survive. Interpolating the prompt straight into a JSON string produced
# a malformed body for anything containing a double quote.
json_payload() {
    jq -nc --arg prompt "$1" '{prompt: $prompt}'
}

# Read one field out of an SSE event, tolerating events where the field's parent
# holds an unexpected type.
#
# This matters more than it looks: the runtime's error event is
# {"error": ..., "error_type": ..., "message": "An error occurred during streaming"},
# so "message" is a string. Asking jq for .message.content[0] on a string is a
# type error, and jq exits 5. Under `set -e` that exit code propagated out of the
# command substitution and killed the whole chat session — surfacing as
# "make: *** [chat] Error 5" on the first failed turn, with the actual error
# never printed. `(...)? // empty` makes the filter yield nothing instead.
sse_field() {
    jq -r "($2)? // empty" <<< "$1" 2>/dev/null || true
}

# Print an SSE error event, if that is what this line is. Returns 0 when the
# line was an error (and has been reported), 1 otherwise.
handle_error_event() {
    local line="$1" err err_type

    err=$(sse_field "$line" '.error')
    [ -n "$err" ] || return 1

    err_type=$(sse_field "$line" '.error_type')
    echo ""
    if [ -n "$err_type" ]; then
        echo -e "${YELLOW}⚠️  ${err_type}: ${err}${NC}"
    else
        echo -e "${YELLOW}⚠️  ${err}${NC}"
    fi

    # A failed turn is reported over SSE, not as an HTTP error, so this is the
    # only place a container-side exception is visible without reading the
    # container logs. Missing credentials is by far the most common one, and the
    # fix is not in the agent — say where it is.
    case "$err" in
        *"Unable to locate credentials"*|*"could not be found"*|*ExpiredToken*|*InvalidClientTokenId*)
            echo -e "${GRAY}   The container has no usable AWS credentials.${NC}"
            echo -e "${GRAY}   Restart it with: make docker-run AGENT=$AGENT_NAME${NC}"
            echo -e "${GRAY}   docker-run.sh resolves host credentials and passes them in.${NC}"
            ;;
    esac
    return 0
}

# --- Local mode: send message to localhost ---
send_message_local() {
    local prompt="$1"
    local response

    if ! response=$(curl -s -X POST "http://localhost:$PORT/invocations" \
        -H "Content-Type: application/json" \
        -H "X-Amzn-Bedrock-AgentCore-Runtime-User-Id: $USER_ID" \
        -H "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id: $SESSION_ID" \
        --data-binary "$(json_payload "$prompt")" 2>/dev/null); then
        echo -e "${YELLOW}⚠️  Connection error. Is the agent running on port $PORT?${NC}"
        return 1
    fi

    if [ -z "$response" ]; then
        echo -e "${YELLOW}⚠️  Empty response. Is the agent running on port $PORT?${NC}"
        return 1
    fi

    # The endpoint answers with an SSE stream even in non-streaming mode, so the
    # events have to be collapsed here rather than read as a single JSON object.
    local events
    events=$(echo "$response" | sed -n 's/^data: //p')
    if [ -z "$events" ]; then
        echo "$response"
        return 0
    fi

    local line
    while IFS= read -r line; do
        [ -n "$line" ] || continue
        if handle_error_event "$line"; then
            return 1
        fi
    done <<< "$events"

    local text
    text=$(jq -s -r '[.[] | (.result.message.content[0].text)? // empty] | last // empty' \
        <<< "$events" 2>/dev/null || true)
    if [ -z "$text" ]; then
        text=$(jq -r '(.data)? // empty' <<< "$events" 2>/dev/null | tr -d '\n' || true)
    fi

    if [ -n "$text" ]; then
        echo "$text"
    else
        echo "$response"
    fi
}

# --- Local mode: send message with streaming ---
send_message_streaming_local() {
    local prompt="$1"

    curl -s -N -X POST "http://localhost:$PORT/invocations" \
        -H "Content-Type: application/json" \
        -H "X-Amzn-Bedrock-AgentCore-Runtime-User-Id: $USER_ID" \
        -H "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id: $SESSION_ID" \
        --data-binary "$(json_payload "$prompt")" 2>/dev/null | while IFS= read -r line; do

        if [[ -z "$line" ]] || [[ "$line" == ":" ]]; then
            continue
        fi

        if [[ "$line" == data:* ]]; then
            line="${line#data: }"
        fi

        if [[ -z "$line" ]] || [[ "$line" == " " ]]; then
            continue
        fi

        if handle_error_event "$line"; then
            continue
        fi

        text_delta=$(sse_field "$line" '.data')
        if [[ -n "$text_delta" ]]; then
            printf "%s" "$text_delta"
            continue
        fi

        tool_name=$(sse_field "$line" '.current_tool_use.name')
        if [[ -n "$tool_name" ]]; then
            tool_input=$(sse_field "$line" '.current_tool_use.input')
            echo ""
            echo -e "${YELLOW}🔧 Using tool: ${tool_name}${NC}"
            if [[ -n "$tool_input" ]] && [[ "$tool_input" != "{}" ]]; then
                echo -e "${GRAY}   Input: $tool_input${NC}"
            fi
            continue
        fi

        tool_result=$(sse_field "$line" '.message.content[0].toolResult.content[0].text')
        if [[ -n "$tool_result" ]]; then
            tool_status=$(sse_field "$line" '.message.content[0].toolResult.status')
            if [[ "$tool_status" == "success" ]]; then
                echo -e "${GREEN}   ✓ Result: ${tool_result:0:100}...${NC}"
            else
                echo -e "${YELLOW}   ⚠ Result: ${tool_result:0:100}...${NC}"
            fi
            echo ""
            continue
        fi

        result=$(sse_field "$line" '.result')
        if [[ -n "$result" ]]; then
            echo ""
            continue
        fi
    done || true
}

# --- Deployed mode: invoke the AgentCore runtime with streaming display ---
send_message_streaming_remote() {
    local prompt="$1"

    # The CLI treats a --payload string as base64, so pass raw bytes via fileb://
    local tmp_payload
    tmp_payload=$(mktemp)
    json_payload "$prompt" > "$tmp_payload"

    local had_output=false
    while IFS= read -r line; do
        if [[ -z "$line" ]]; then
            continue
        fi

        if [[ "$line" == data:* ]]; then
            line="${line#data: }"
        else
            continue
        fi

        if [[ -z "$line" ]]; then
            continue
        fi

        if handle_error_event "$line"; then
            had_output=true
            continue
        fi

        text_delta=$(sse_field "$line" '.data')
        if [[ -n "$text_delta" ]]; then
            printf "%s" "$text_delta"
            had_output=true
            continue
        fi

        tool_name=$(sse_field "$line" '.current_tool_use.name')
        if [[ -n "$tool_name" ]]; then
            echo ""
            echo -e "${YELLOW}🔧 Using tool: ${tool_name}${NC}"
            had_output=true
            continue
        fi
    done < <(aws bedrock-agentcore invoke-agent-runtime \
        --agent-runtime-arn "$AGENT_RUNTIME_ARN" \
        --runtime-session-id "$SESSION_ID" \
        --region "$AGENT_REGION" \
        --payload "fileb://$tmp_payload" \
        --no-cli-pager \
        /dev/stdout 2>"${tmp_payload}.err" || true)

    rm -f "$tmp_payload"

    if [ "$had_output" = false ]; then
        local err_msg=""
        if [ -f "${tmp_payload}.err" ]; then
            err_msg=$(cat "${tmp_payload}.err" 2>/dev/null)
        fi
        rm -f "${tmp_payload}.err"
        if [ -n "$err_msg" ]; then
            echo -e "\n${YELLOW}⚠️  ${err_msg}${NC}"
        else
            echo -e "\n${YELLOW}⚠️  No response received. Try --local for local testing.${NC}"
        fi
        return 1
    fi
    rm -f "${tmp_payload}.err"
    echo ""
}

# --- Deployed mode: invoke the AgentCore runtime via AWS CLI ---
send_message_remote() {
    local prompt="$1"

    local tmp_payload tmp_err response
    tmp_payload=$(mktemp)
    json_payload "$prompt" > "$tmp_payload"

    tmp_err=$(mktemp)
    response=$(aws bedrock-agentcore invoke-agent-runtime \
        --agent-runtime-arn "$AGENT_RUNTIME_ARN" \
        --runtime-session-id "$SESSION_ID" \
        --region "$AGENT_REGION" \
        --payload "fileb://$tmp_payload" \
        --no-cli-pager \
        /dev/stdout 2>"$tmp_err") || true
    rm -f "$tmp_payload"

    if [ -z "$response" ]; then
        local err_msg
        err_msg=$(cat "$tmp_err" 2>/dev/null)
        rm -f "$tmp_err"
        echo -e "${YELLOW}⚠️  Error invoking deployed runtime:${NC}"
        echo -e "${GRAY}${err_msg}${NC}"
        return 1
    fi
    rm -f "$tmp_err"

    # The response is SSE: "data: {...}\n\ndata: {...}\n\n..."
    local events
    events=$(echo "$response" | sed -n 's/^data: //p')
    if [ -z "$events" ]; then
        echo "$response"
        return 0
    fi

    # A turn that failed inside the runtime comes back as an error event with
    # HTTP 200, so it has to be checked before parsing for text.
    local line
    while IFS= read -r line; do
        [ -n "$line" ] || continue
        if handle_error_event "$line"; then
            return 1
        fi
    done <<< "$events"

    # Prefer the final "result" event, which carries the complete text.
    # Filters are error-suppressing: an event whose .message or .result is not an
    # object is a jq type error, which exits 5 and, under `set -e`, would take
    # the whole session down instead of printing anything.
    local final_text
    final_text=$(jq -s -r '[.[] | (.result.message.content[0].text)? // empty] | last // empty' \
        <<< "$events" 2>/dev/null || true)

    if [ -n "$final_text" ]; then
        echo "$final_text"
        return 0
    fi

    # Fallback: the non-streaming final "message" event.
    final_text=$(jq -s -r '[.[] | (.message.content[0].text)? // empty] | last // empty' \
        <<< "$events" 2>/dev/null || true)

    if [ -n "$final_text" ]; then
        echo "$final_text"
        return 0
    fi

    # Last fallback: concatenate the streaming text deltas.
    jq -r '(.data)? // empty' <<< "$events" 2>/dev/null | tr -d '\n' || true
    echo ""
}

while true; do
    echo -ne "${GREEN}${BOLD}You: ${NC}"
    read -r user_input || break

    if [ -z "$user_input" ]; then
        continue
    fi

    case "$user_input" in
        quit|exit|q)
            echo ""
            echo -e "${CYAN}👋 Goodbye!${NC}"
            echo ""
            exit 0
            ;;
        clear)
            clear
            echo -e "${GRAY}─────────────────────────────────────────────────────────────${NC}"
            echo ""
            continue
            ;;
        new)
            SESSION_ID="session-$(uuidgen 2>/dev/null || echo "chat-$$-$(date +%s)")"
            echo ""
            echo -e "${YELLOW}🔄 Started new session: $SESSION_ID${NC}"
            echo ""
            continue
            ;;
        stream)
            STREAMING="true"
            echo ""
            echo -e "${GREEN}✓ Streaming mode enabled${NC}"
            echo ""
            continue
            ;;
        nostream)
            STREAMING="false"
            echo ""
            echo -e "${YELLOW}✓ Streaming mode disabled${NC}"
            echo ""
            continue
            ;;
        help)
            echo ""
            echo -e "${YELLOW}Commands:${NC}"
            echo -e "  ${GRAY}quit, exit, q${NC} - Exit the chat"
            echo -e "  ${GRAY}clear${NC}         - Clear the screen"
            echo -e "  ${GRAY}new${NC}           - Start a new session"
            echo -e "  ${GRAY}stream${NC}        - Enable streaming mode"
            echo -e "  ${GRAY}nostream${NC}      - Disable streaming mode"
            echo -e "  ${GRAY}help${NC}          - Show this help"
            echo ""
            continue
            ;;
    esac

    echo ""
    echo -ne "${CYAN}${BOLD}Agent: ${NC}"

    # `|| true` on every call: one failed turn should report itself and hand the
    # prompt back, not exit the chat. Without it `set -e` ended the session.
    if [ "$LOCAL_MODE" = "true" ]; then
        if [ "$STREAMING" = "true" ]; then
            send_message_streaming_local "$user_input" || true
        else
            send_message_local "$user_input" || true
        fi
    else
        if [ "$STREAMING" = "true" ]; then
            send_message_streaming_remote "$user_input" || true
        else
            send_message_remote "$user_input" || true
        fi
    fi

    echo ""
done
