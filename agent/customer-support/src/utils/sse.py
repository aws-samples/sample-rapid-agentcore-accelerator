# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""SSE (Server-Sent Events) formatting utilities for streaming agent responses.

This module provides utilities to convert Strands agent streaming events
into SSE-formatted data for HTTP streaming responses.
"""

import json
import logging
import os
from typing import Any

# Configure logger for this module - check DEBUG env var
logger = logging.getLogger(__name__)
if os.environ.get("DEBUG", "false").lower() == "true":
    logger.setLevel(logging.DEBUG)
    # Ensure we have a handler if not already configured
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s | %(name)s | %(message)s"))
        logger.addHandler(handler)


def format_sse_event(event: dict[str, Any]) -> dict[str, Any] | None:
    """Convert a Strands streaming event to SSE-compatible format.
    
    Handles the following Strands event types:
    - data: Text delta from the model's output
    - current_tool_use: Tool invocation information
    - message: Message with tool results
    - result: Final agent result
    
    Args:
        event: A Strands streaming event dictionary
        
    Returns:
        SSE-formatted dictionary or None if event should be skipped
    """
    # Debug logging - log only event type/keys, not content (which may contain user data)
    if logger.isEnabledFor(logging.DEBUG):
        logger.debug(f"Event keys: {list(event.keys())}")
    
    # Handle text delta events
    # Preserve reasoning flag if present - frontend will filter these out
    if "data" in event:
        result = {"data": event["data"]}
        # Include reasoning-related fields if present so frontend can filter them
        if event.get("reasoning"):
            result["reasoning"] = True
        if "reasoningText" in event:
            result["reasoningText"] = event["reasoningText"]
        if "reasoning_signature" in event:
            result["reasoning_signature"] = event["reasoning_signature"]
        if "redactedContent" in event:
            result["redactedContent"] = event["redactedContent"]
        return result
    
    # Handle tool use events - check for current_tool_use with any content
    if "current_tool_use" in event:
        tool_use = event["current_tool_use"]
        if logger.isEnabledFor(logging.DEBUG):
            logger.debug(f"Tool use event: toolUseId={tool_use.get('toolUseId')}, name={tool_use.get('name')}")
        # Emit tool use event if we have a tool use ID or name
        # Tool input may be streamed incrementally, so emit even with partial data
        if tool_use and (tool_use.get("name") or tool_use.get("toolUseId")):
            return {
                "current_tool_use": {
                    "toolUseId": tool_use.get("toolUseId", ""),
                    "name": tool_use.get("name", ""),
                    "input": tool_use.get("input", {})
                }
            }
        return None
    
    # Handle message events (contains tool results)
    if "message" in event:
        message = event["message"]
        return {"message": message}
    
    # Handle final result events
    if "result" in event:
        result = event["result"]
        # Extract the message from AgentResult if present
        if hasattr(result, "message"):
            return {"result": {"message": result.message}}
        return {"result": result}
    
    # Skip other event types (init_event_loop, start_event_loop, etc.)
    if logger.isEnabledFor(logging.DEBUG):
        logger.debug(f"Skipping event type: {list(event.keys())}")
    
    return None


def _safe_serialize(obj: Any) -> Any:
    """Safely serialize an object for logging, handling non-serializable types."""
    if isinstance(obj, dict):
        return {k: _safe_serialize(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [_safe_serialize(item) for item in obj]
    elif hasattr(obj, "__dict__"):
        return f"<{type(obj).__name__}>"
    else:
        return obj
