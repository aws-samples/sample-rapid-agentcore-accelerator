# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""Streaming event types and parser for SSE responses from the agent.

This module provides typed event classes and a parser to convert SSE-formatted
data from the agent into structured events for the frontend.
"""

import json
from dataclasses import dataclass
from typing import Optional, Union


@dataclass
class TextDelta:
    """Incremental text content from the agent."""
    text: str


@dataclass
class ToolUse:
    """Tool invocation event with tool details."""
    tool_id: str
    tool_name: str
    tool_input: dict


@dataclass
class ToolResult:
    """Tool execution result."""
    tool_id: str
    status: str  # "success" or "error"
    output: str


@dataclass
class StreamComplete:
    """End of stream marker."""
    final_message: Optional[dict]


@dataclass
class StreamError:
    """Error during streaming."""
    error: str


# Union type for all stream events
StreamEvent = Union[TextDelta, ToolUse, ToolResult, StreamComplete, StreamError]


def parse_stream_event(data: dict) -> Optional[StreamEvent]:
    """Parse an SSE event dictionary into a typed StreamEvent.
    
    Handles the following event types:
    - data: Text delta → TextDelta
    - current_tool_use: Skipped (incremental, wait for complete toolUse in message)
    - message (assistant + toolUse): Complete tool invocation → ToolUse
    - message (user + toolResult): Tool result → ToolResult
    - message (assistant + text only): Skipped (duplicates streamed text)
    - result: Stream completion → StreamComplete
    - reasoning events: Skipped (internal model reasoning not for display)
    
    Args:
        data: Parsed JSON dictionary from SSE event
        
    Returns:
        StreamEvent if the event should be processed, None if it should be skipped
    """
    if not isinstance(data, dict):
        return None
    
    # Filter reasoning events - these contain internal model reasoning that
    # should not be displayed to users. Reasoning events have a "reasoning: true"
    # flag and may contain reasoningText, reasoning_signature, or redactedContent.
    if data.get("reasoning") is True:
        return None
    
    # Handle text delta events
    if "data" in data:
        text = data["data"]
        if isinstance(text, str):
            return TextDelta(text=text)
        return None
    
    # Skip incremental current_tool_use events - these are streamed as input is built up
    # We'll get the complete tool use from the message event with toolUse content
    if "current_tool_use" in data:
        # Skip - we'll use the complete toolUse from the assistant message instead
        return None
    
    # Handle message events
    if "message" in data:
        message = data["message"]
        if not isinstance(message, dict):
            return None
        
        role = message.get("role", "")
        content = message.get("content", [])
        
        # Tool result comes in user messages with toolResult content
        if role == "user" and isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and "toolResult" in item:
                    tool_result = item["toolResult"]
                    tool_id = tool_result.get("toolUseId", "")
                    status = tool_result.get("status", "success")
                    
                    # Extract output text from content array
                    output_parts = []
                    result_content = tool_result.get("content", [])
                    if isinstance(result_content, list):
                        for result_item in result_content:
                            if isinstance(result_item, dict) and "text" in result_item:
                                output_parts.append(result_item["text"])
                    
                    output = "\n".join(output_parts) if output_parts else ""
                    return ToolResult(tool_id=tool_id, status=status, output=output)
        
        # Extract complete tool use from assistant messages
        if role == "assistant" and isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and "toolUse" in item:
                    tool_use = item["toolUse"]
                    tool_id = tool_use.get("toolUseId", "")
                    tool_name = tool_use.get("name", "")
                    tool_input = tool_use.get("input", {})
                    
                    if tool_id or tool_name:
                        return ToolUse(tool_id=tool_id, tool_name=tool_name, tool_input=tool_input)
            # Skip assistant messages without toolUse (text already streamed via data events)
            return None
        
        return None
    
    # Handle stream completion
    if "result" in data:
        result = data["result"]
        final_message = None
        if isinstance(result, dict):
            final_message = result.get("message")
        return StreamComplete(final_message=final_message)
    
    # Unknown event type - skip
    return None


def parse_sse_line(line: str) -> Optional[StreamEvent]:
    """Parse a single SSE data line into a StreamEvent.
    
    Args:
        line: Raw SSE line (e.g., 'data: {"data": "hello"}')
        
    Returns:
        StreamEvent if successfully parsed, None otherwise
    """
    if not line:
        return None
    
    # Strip 'data: ' prefix if present
    if line.startswith("data: "):
        line = line[6:]
    elif line.startswith("data:"):
        line = line[5:]
    
    line = line.strip()
    if not line:
        return None
    
    try:
        data = json.loads(line)
        return parse_stream_event(data)
    except json.JSONDecodeError:
        return None
