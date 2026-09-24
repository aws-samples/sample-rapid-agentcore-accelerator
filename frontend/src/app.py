# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""
Streamlit Frontend for AgentCore Runtime

This application provides a chat interface for interacting with an AI agent
deployed on Amazon Bedrock AgentCore Runtime or a locally running agent.

Supported deployment configurations:
1. LOCAL_AGENT_URL: Connect to locally running agent (e.g., http://localhost:8080)
2. LOCAL_MODE=true: Local development with IAM authentication to AgentCore Runtime
3. COGNITO_AUTH_ENABLED=true: Application-level Cognito OAuth (redirect to Hosted UI)
4. COGNITO_AUTH_ENABLED=false: Internal ALB without Cognito (VPC-only access)

Environment variables:
- AGENTCORE_RUNTIME_ARN: ARN of the AgentCore Runtime to invoke
- AWS_REGION: AWS region for the AgentCore client
- LOCAL_MODE: Set to 'true' for local development
- LOCAL_AGENT_URL: URL of locally running agent (e.g., http://localhost:8080)
- COGNITO_AUTH_ENABLED: Set by CDK when Cognito is configured
- COGNITO_CLIENT_ID: Cognito app client ID (set by CDK)
- COGNITO_CLIENT_SECRET: Cognito app client secret (set by CDK)
- COGNITO_DOMAIN: Cognito hosted UI domain (set by CDK)
- COGNITO_REDIRECT_URI: OAuth callback URL - the CloudFront URL (set by CDK)
- COGNITO_USER_POOL_ID: Cognito User Pool ID (set by CDK)
- STREAMING_ENABLED: Set to 'true' to enable real-time streaming of agent responses
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Dict, Any

from dotenv import load_dotenv
import streamlit as st

# Load environment variables from .env file (for local development only)
# .env is in local/ directory, sibling to src/
env_path = Path(__file__).parent.parent / 'local' / '.env'
if env_path.exists():
    load_dotenv(dotenv_path=env_path)

# Import from new module structure
from core import AppConfig, AgentRegistry, get_user_info_from_headers, invoke_agent, invoke_agent_streaming
from core.auth import CognitoConfig, require_auth, render_login_page, get_logout_url
from chatui import render_tool_call, render_streaming_response, render_unauthenticated_page

# Load configuration from environment
config = AppConfig.from_env()

# Load agent registry (multi-agent or single-agent fallback)
registry = AgentRegistry.from_env()


def init_session_state():
    """Initialize session state variables."""
    if "messages" not in st.session_state:
        st.session_state.messages = []
    if "session_id" not in st.session_state:
        st.session_state.session_id = str(uuid.uuid4())


def render_chat_interface(user_info: Dict[str, Any]):
    """Render the chat interface for authenticated users."""
    # Sidebar with session controls and agent selector
    with st.sidebar:
        # Agent selector (only shown in multi-agent mode)
        if registry.is_multi_agent:
            selected_agent = st.selectbox(
                "Select Agent",
                options=registry.agent_names,
                key="selected_agent",
            )
            # On agent switch: reset session
            if "prev_agent" not in st.session_state:
                st.session_state.prev_agent = selected_agent
            if st.session_state.prev_agent != selected_agent:
                st.session_state.prev_agent = selected_agent
                st.session_state.session_id = str(uuid.uuid4())
                st.session_state.messages = []
                st.rerun()
        else:
            selected_agent = registry.agent_names[0] if registry.agent_names else "agent"

        st.caption(f"Session ID: {st.session_state.session_id[:8]}...")
        if st.button("New Session"):
            st.session_state.session_id = str(uuid.uuid4())
            st.session_state.messages = []
            st.rerun()

    # Resolve the ARN for the selected agent
    agent_arn = registry.get_arn(selected_agent)

    # Header with user info and selected agent name
    col1, col2 = st.columns([6, 1])
    with col1:
        if registry.is_multi_agent:
            st.title(f"💬 {selected_agent}")
        else:
            st.title("AI Agent Chat")
        st.caption(config.get_display_text(user_info.get('email')))
    with col2:
        cognito_config = CognitoConfig.from_env()
        if cognito_config and config.cognito_auth_enabled:
            if st.button("Logout", type="secondary"):
                st.session_state.pop("cognito_user", None)
                logout_url = get_logout_url(cognito_config)
                st.markdown(f'<meta http-equiv="refresh" content="0;url={logout_url}">', unsafe_allow_html=True)
                st.stop()
    
    # Chat container
    chat_container = st.container()
    
    # Display message history
    with chat_container:
        for message in st.session_state.messages:
            with st.chat_message(message["role"]):
                st.markdown(message["content"])
                # Render persisted tool calls for assistant messages
                if message["role"] == "assistant" and message.get("tool_calls"):
                    for tool_call in message["tool_calls"]:
                        render_tool_call(tool_call)
    
    # Chat input
    if prompt := st.chat_input("Type your message..."):
        st.session_state.messages.append({"role": "user", "content": prompt})
        
        with chat_container:
            with st.chat_message("user"):
                st.markdown(prompt)
        
        with chat_container:
            with st.chat_message("assistant"):
                message_placeholder = st.empty()
                
                if config.streaming_enabled:
                    # Use streaming mode
                    message_placeholder.markdown("▌")
                    events = invoke_agent_streaming(
                        prompt=prompt,
                        user_info=user_info,
                        session_id=st.session_state.session_id,
                        local_agent_url=config.local_agent_url,
                        agentcore_runtime_arn=agent_arn,
                        aws_region=config.aws_region,
                        cognito_auth_enabled=config.cognito_auth_enabled,
                    )
                    response, tool_calls = render_streaming_response(events, message_placeholder)
                else:
                    # Use non-streaming mode (existing behavior)
                    message_placeholder.markdown("Thinking...")
                    response = invoke_agent(
                        prompt=prompt,
                        user_info=user_info,
                        session_id=st.session_state.session_id,
                        local_agent_url=config.local_agent_url,
                        agentcore_runtime_arn=agent_arn,
                        aws_region=config.aws_region,
                        cognito_auth_enabled=config.cognito_auth_enabled,
                    )
                    message_placeholder.markdown(response)
                    tool_calls = []  # Non-streaming doesn't capture tool calls
        
        # Store message with tool calls
        st.session_state.messages.append({
            "role": "assistant",
            "content": response,
            "tool_calls": tool_calls,
        })


def main():
    """Main application entry point."""
    st.set_page_config(
        page_title="AI Agent Chat",
        page_icon="🤖",
        layout="centered",
    )
    
    # Validate configuration at startup
    try:
        config.validate()
    except ValueError as e:
        st.error(f"Configuration Error: {e}")
        st.info("Please check your environment variables and try again.")
        st.stop()
    
    # Validate agent registry
    if registry.is_empty:
        st.error("No agents configured. Set AGENT_REGISTRY or AGENTCORE_RUNTIME_ARN environment variable.")
        st.stop()
    
    init_session_state()
    
    # Determine authentication method
    cognito_config = CognitoConfig.from_env()
    
    if cognito_config and config.cognito_auth_enabled:
        # App-level Cognito OAuth flow (used with CloudFront + internal ALB)
        user_info = require_auth(cognito_config)
        if not user_info:
            render_login_page(cognito_config)
            st.stop()
        render_chat_interface(user_info)
    else:
        # Legacy: ALB headers or no-auth modes
        user_info = get_user_info_from_headers(config.cognito_auth_enabled)
        if user_info:
            render_chat_interface(user_info)
        else:
            render_unauthenticated_page(config)


if __name__ == "__main__":
    main()
