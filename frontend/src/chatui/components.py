# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""UI rendering components for chat interface.

This module provides reusable functions for rendering tool calls and
streaming responses in the Streamlit chat interface.
"""

from __future__ import annotations

from typing import Any, Dict, Iterator

import streamlit as st

from core.config import AppConfig
from core.streaming import StreamEvent, TextDelta, ToolUse, ToolResult, StreamComplete, StreamError


def render_unauthenticated_page(config: AppConfig) -> None:
    """Render page for unauthenticated users (only shown when Cognito auth fails).
    
    Args:
        config: Application configuration for determining error messaging
    """
    st.title("🤖 AI Agent Chat")
    
    if config.local_agent_url:
        st.error("Local agent is configured but AWS credentials are not configured.")
        st.info("Please configure AWS credentials using one of these methods:")
        st.code("""
# Option 1: AWS CLI
aws configure

# Option 2: Environment variables
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_SESSION_TOKEN=your_session_token  # if using temporary credentials

# Option 3: IAM role (if running on EC2)
# No additional configuration needed

# Option 4: AWS Profile
export AWS_PROFILE=your_profile_name
        """)
    elif config.cognito_auth_enabled:
        st.error("Authentication required. Cognito authentication headers are missing.")
        st.info(
            "This application is configured with Cognito authentication. "
            "Please ensure you're accessing this application through the ALB URL "
            "and that you've completed the Cognito login flow."
        )
    else:
        st.error("Unexpected authentication state.")
        st.info("Please contact your administrator if this issue persists.")


def render_tool_call(tool_call: dict) -> None:
    """Render a persisted tool call from message history.
    
    Displays a tool call with its input and output in a collapsible status
    container. Handles both success and error states consistently.
    
    Args:
        tool_call: Dictionary containing tool call data with keys:
            - name: Tool name
            - input: Tool input parameters (dict)
            - output: Tool output (optional)
            - status: "success" or "error" (optional, defaults to "success")
    """
    state = "error" if tool_call.get("status") == "error" else "complete"
    with st.status(f"🔧 {tool_call['name']}", expanded=False, state=state):
        st.markdown("**Input:**")
        st.json(tool_call["input"])
        if tool_call.get("output"):
            st.markdown("**Output:**")
            if tool_call.get("status") == "error":
                st.error(tool_call["output"])
            else:
                output = tool_call["output"]
                st.text(output[:1000] if len(output) > 1000 else output)


def render_streaming_response(
    events: Iterator[StreamEvent],
    message_placeholder,
) -> tuple[str, list]:
    """Render streaming response events to the Streamlit UI.
    
    Iterates over StreamEvent objects and updates the UI incrementally:
    - TextDelta: Appends text to the response placeholder
    - ToolUse: Creates a status container showing tool execution in progress
    - ToolResult: Updates the status container with output and marks complete
    - StreamError: Displays error message
    - StreamComplete: Finalizes the response
    
    Args:
        events: Iterator of StreamEvent objects from invoke_agent_streaming()
        message_placeholder: Streamlit placeholder for the response text
        
    Returns:
        Tuple of (response_text, tool_calls) where tool_calls is a list of
        dicts with tool name, input, status, and output for persistence
    """
    response_text = ""
    tool_statuses: Dict[str, Any] = {}  # Map tool_id to status container info
    tool_calls: list = []  # Collect tool calls for persistence
    had_tool_result = False  # Track if we just had a tool result

    for event in events:
        if isinstance(event, TextDelta):
            # Add newline separator if text resumes after a tool result
            if had_tool_result and response_text and not response_text.endswith('\n'):
                response_text += "\n\n"
            had_tool_result = False
            
            # Append text delta to response
            response_text += event.text
            message_placeholder.markdown(response_text + "▌")
            
        elif isinstance(event, ToolUse):
            # Create status container for tool execution (starts in "running" state with spinner)
            status = st.status(f"🔧 {event.tool_name}", expanded=False, state="running")
            with status:
                st.markdown("**Input:**")
                st.json(event.tool_input)
            tool_statuses[event.tool_id] = {
                "status": status,
                "name": event.tool_name,
                "input": event.tool_input,
                "output": None,
                "result_status": None,
            }
            
        elif isinstance(event, ToolResult):
            # Update status container with result
            if event.tool_id in tool_statuses:
                tool_info = tool_statuses[event.tool_id]
                status = tool_info["status"]
                tool_info["output"] = event.output
                tool_info["result_status"] = event.status
                
                # Add output to the status container
                with status:
                    st.markdown("**Output:**")
                    if event.status == "error":
                        st.error(event.output)
                    else:
                        st.text(event.output[:1000] if len(event.output) > 1000 else event.output)
                
                # Update status label and state (keep tool emoji)
                if event.status == "error":
                    status.update(label=f"🔧 {tool_info['name']}", state="error", expanded=False)
                else:
                    status.update(label=f"🔧 {tool_info['name']}", state="complete", expanded=False)
            
            # Mark that we had a tool result - next text should have separator
            had_tool_result = True
            
        elif isinstance(event, StreamError):
            # Display error message
            st.error(f"Error: {event.error}")
            return f"Error: {event.error}", []
            
        elif isinstance(event, StreamComplete):
            # Finalize the response
            message_placeholder.markdown(response_text)
    
    # Ensure final response is displayed without cursor
    if response_text:
        message_placeholder.markdown(response_text)
    
    # Collect tool calls for persistence (without the st.status object)
    for tool_id, info in tool_statuses.items():
        tool_calls.append({
            "tool_id": tool_id,
            "name": info["name"],
            "input": info["input"],
            "output": info.get("output"),
            "status": info.get("result_status", "success"),
        })
    
    return response_text, tool_calls
