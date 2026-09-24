# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""SSE (Server-Sent Events) formatting utilities for streaming agent responses."""

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)
if os.environ.get("DEBUG", "false").lower() == "true":
    logger.setLevel(logging.DEBUG)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s | %(name)s | %(message)s"))
        logger.addHandler(handler)


def format_sse_event(event: dict[str, Any]) -> dict[str, Any] | None:
    """Convert a Strands streaming event to SSE-compatible format."""
    if logger.isEnabledFor(logging.DEBUG):
        logger.debug(f"Event keys: {list(event.keys())}")

    if "data" in event:
        result = {"data": event["data"]}
        if event.get("reasoning"):
            result["reasoning"] = True
        if "reasoningText" in event:
            result["reasoningText"] = event["reasoningText"]
        if "reasoning_signature" in event:
            result["reasoning_signature"] = event["reasoning_signature"]
        if "redactedContent" in event:
            result["redactedContent"] = event["redactedContent"]
        return result

    if "current_tool_use" in event:
        tool_use = event["current_tool_use"]
        if tool_use and (tool_use.get("name") or tool_use.get("toolUseId")):
            return {
                "current_tool_use": {
                    "toolUseId": tool_use.get("toolUseId", ""),
                    "name": tool_use.get("name", ""),
                    "input": tool_use.get("input", {})
                }
            }
        return None

    if "message" in event:
        return {"message": event["message"]}

    if "result" in event:
        result = event["result"]
        if hasattr(result, "message"):
            return {"result": {"message": result.message}}
        return {"result": result}

    return None
