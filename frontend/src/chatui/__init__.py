# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""Chat UI components for the Streamlit frontend.

This module provides reusable UI rendering functions for chat elements
like tool calls and streaming responses.
"""

from chatui.components import render_tool_call, render_streaming_response, render_unauthenticated_page

__all__ = ["render_tool_call", "render_streaming_response", "render_unauthenticated_page"]
