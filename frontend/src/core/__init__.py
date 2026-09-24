# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""Core module for frontend application.

Contains configuration, utilities, streaming, and invocation handlers.
"""

from core.agent_registry import AgentRegistry
from core.config import AppConfig, OutboundAuth
from core.utils import get_user_info_from_headers, parse_agent_response, get_runtime_user_id
from core.auth import CognitoConfig, require_auth, render_login_page, get_logout_url
from core.streaming import (
    StreamEvent,
    TextDelta,
    ToolUse,
    ToolResult,
    StreamComplete,
    StreamError,
    parse_stream_event,
    parse_sse_line,
)
from core.invocations import invoke_agent, invoke_agent_streaming

__all__ = [
    # Agent Registry
    "AgentRegistry",
    # Config
    "AppConfig",
    "OutboundAuth",
    # Auth
    "CognitoConfig",
    "require_auth",
    "render_login_page",
    "get_logout_url",
    # Utils
    "get_user_info_from_headers",
    "parse_agent_response",
    "get_runtime_user_id",
    # Streaming
    "StreamEvent",
    "TextDelta",
    "ToolUse",
    "ToolResult",
    "StreamComplete",
    "StreamError",
    "parse_stream_event",
    "parse_sse_line",
    # Invocations
    "invoke_agent",
    "invoke_agent_streaming",
]
