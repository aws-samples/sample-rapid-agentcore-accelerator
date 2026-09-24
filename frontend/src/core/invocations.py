# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""
Agent invocation handlers for different deployment modes.

Supports:
- Local agent (direct HTTP to locally running agent)
- AgentCore Runtime with OAuth (Cognito auth)
- AgentCore Runtime with IAM (boto3)

Both synchronous and streaming invocations are supported.
"""

import json
import logging
import urllib.parse
from typing import Dict, Any, Iterator

import boto3
import httpx
import requests
from httpx_sse import connect_sse

from core.streaming import StreamEvent, StreamError, StreamComplete, TextDelta, parse_sse_line
from core.utils import parse_agent_response, get_runtime_user_id

logger = logging.getLogger(__name__)


def invoke_agent(
    prompt: str,
    user_info: Dict[str, Any],
    session_id: str,
    *,
    local_agent_url: str = "",
    agentcore_runtime_arn: str = "",
    aws_region: str = "us-west-2",
    cognito_auth_enabled: bool = False,
    runtime_auth_mode: str = "iam",
) -> str:
    """Invoke the agent with the user's prompt.
    
    Supports three modes:
    1. local_agent_url set: Connect to locally running agent
    2. runtime_auth_mode == "oauth": Use OAuth Bearer token via AgentCore Runtime
    3. Default: Use IAM auth via boto3 to AgentCore Runtime
    
    Note: cognito_auth_enabled refers to how the *user* authenticates to the
    frontend app, NOT how the frontend authenticates to AgentCore Runtime.
    """
    if local_agent_url:
        return invoke_local_agent(prompt, user_info, session_id, local_agent_url)
    
    if not agentcore_runtime_arn:
        return "Error: AgentCore Runtime ARN not configured (and no LOCAL_AGENT_URL set)"
    
    try:
        payload = {"prompt": prompt}
        
        # Route based on runtime auth mode (NOT user auth mode)
        if runtime_auth_mode == "oauth" and user_info.get('access_token'):
            return invoke_agent_with_oauth(
                payload, user_info, session_id, agentcore_runtime_arn, aws_region
            )
        else:
            return invoke_agent_with_iam(
                payload, user_info, session_id, agentcore_runtime_arn, aws_region
            )
            
    except Exception as e:
        return _format_error(str(e))


def invoke_local_agent(
    prompt: str,
    user_info: Dict[str, Any],
    session_id: str,
    local_agent_url: str,
) -> str:
    """Invoke a locally running agent via HTTP."""
    url = local_agent_url.rstrip('/')
    if not url.endswith('/invocations'):
        url = f"{url}/invocations"
    
    runtime_user_id = get_runtime_user_id(user_info, 'local-user')
    
    headers = {
        "Content-Type": "application/json",
        "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": session_id,
        "X-Amzn-Bedrock-AgentCore-Runtime-User-Id": runtime_user_id,
    }
    
    try:
        response = requests.post(
            url, headers=headers, json={"prompt": prompt}, timeout=120
        )
        
        if response.status_code == 200:
            try:
                return parse_agent_response(response.json())
            except json.JSONDecodeError:
                return response.text or "No response received"
        else:
            return _format_http_error(response)
            
    except requests.exceptions.ConnectionError:
        return f"Error: Cannot connect to local agent at {url}. Is the agent running?"
    except requests.exceptions.Timeout:
        return "Error: Request to local agent timed out."
    except Exception as e:
        return f"Error: Failed to invoke local agent: {str(e)}"


def invoke_agent_with_oauth(
    payload: dict,
    user_info: Dict[str, Any],
    session_id: str,
    agentcore_runtime_arn: str,
    aws_region: str,
) -> str:
    """Invoke the agent using OAuth Bearer token (for Cognito auth)."""
    escaped_arn = urllib.parse.quote(agentcore_runtime_arn, safe='')
    url = f"https://bedrock-agentcore.{aws_region}.amazonaws.com/runtimes/{escaped_arn}/invocations?qualifier=DEFAULT"
    
    runtime_user_id = get_runtime_user_id(user_info)
    
    headers = {
        "Authorization": f"Bearer {user_info['access_token']}",
        "Content-Type": "application/json",
        "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": session_id,
        "X-Amzn-Bedrock-AgentCore-Runtime-User-Id": runtime_user_id,
    }
    
    response = requests.post(url, headers=headers, json=payload, timeout=120)
    
    if response.status_code == 200:
        try:
            return parse_agent_response(response.json())
        except json.JSONDecodeError:
            return response.text or "No response received"
    elif response.status_code == 401:
        return "Error: Authentication failed. Your session may have expired. Please refresh the page."
    else:
        return _format_http_error(response)


def invoke_agent_with_iam(
    payload: dict,
    user_info: Dict[str, Any],
    session_id: str,
    agentcore_runtime_arn: str,
    aws_region: str,
) -> str:
    """Invoke the agent using IAM authentication via boto3."""
    client = boto3.client('bedrock-agentcore', region_name=aws_region)
    runtime_user_id = get_runtime_user_id(user_info)
    
    response = client.invoke_agent_runtime(
        agentRuntimeArn=agentcore_runtime_arn,
        runtimeSessionId=session_id,
        runtimeUserId=runtime_user_id,
        qualifier='DEFAULT',
        payload=json.dumps(payload).encode()
    )
    
    return _process_iam_response(response)


def _process_iam_response(response: dict) -> str:
    """Process the IAM invocation response."""
    content_type = response.get("contentType", "")
    response_body = response.get("response")
    
    # Handle StreamingBody object
    if hasattr(response_body, 'read'):
        body_content = response_body.read()
        if isinstance(body_content, bytes):
            body_content = body_content.decode('utf-8')
        
        try:
            return parse_agent_response(json.loads(body_content))
        except json.JSONDecodeError:
            return body_content or "No response received"
    
    # Handle streaming response
    if "text/event-stream" in content_type:
        content = []
        if isinstance(response_body, list):
            for chunk in response_body:
                if isinstance(chunk, bytes):
                    chunk_str = chunk.decode("utf-8")
                    if chunk_str.startswith("data: "):
                        chunk_str = chunk_str[6:]
                    content.append(chunk_str)
        return "\n".join(content) or "No response received"
    
    # Handle JSON response
    if content_type == "application/json":
        if isinstance(response_body, list):
            content = []
            for chunk in response_body:
                if isinstance(chunk, bytes):
                    content.append(chunk.decode('utf-8'))
                else:
                    content.append(str(chunk))
            
            if content:
                try:
                    return parse_agent_response(json.loads(''.join(content)))
                except json.JSONDecodeError:
                    return ''.join(content)
        else:
            return parse_agent_response(response_body)
    
    # Handle other response types
    if isinstance(response_body, bytes):
        return response_body.decode('utf-8')
    elif response_body is not None:
        return str(response_body)
    return "No response received"


def _extract_json_error_from_non_sse(
    url: str,
    headers: dict,
    payload: dict,
    service_name: str,
) -> str:
    """Re-issue the request without SSE expectations to capture the JSON error body.
    
    When httpx-sse raises because the response is application/json instead of
    text/event-stream, the actual error details are in the JSON body. This helper
    re-issues the same request as a plain POST to read that error.
    
    Args:
        url: The endpoint URL
        headers: Request headers (will be modified to remove Accept: text/event-stream)
        payload: JSON payload to send
        service_name: Human-readable name for error messages
        
    Returns:
        Formatted error message string
    """
    try:
        retry_headers = {k: v for k, v in headers.items() if k.lower() != "accept"}
        retry_headers["Accept"] = "application/json"
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(url, headers=retry_headers, json=payload)
            try:
                error_body = resp.json()
                # Common AgentCore error shape: {"message": "..."} or {"Message": "..."}
                msg = error_body.get("message") or error_body.get("Message") or json.dumps(error_body)
                return f"{service_name} returned an error ({resp.status_code}): {msg}"
            except (json.JSONDecodeError, ValueError):
                return f"{service_name} returned an error ({resp.status_code}): {resp.text[:500]}"
    except Exception:
        return (
            f"{service_name} returned a non-streaming response (application/json instead of "
            f"text/event-stream). This usually means the invocation failed before streaming "
            f"could start — check the agent runtime logs for details."
        )


def _format_error(error_msg: str) -> str:
    """Format error messages with more specific details."""
    if "AccessDenied" in error_msg or "UnauthorizedOperation" in error_msg:
        return "Error: Access denied. Please check your AWS credentials and permissions."
    elif "ResourceNotFound" in error_msg:
        return "Error: Agent runtime not found. Please verify the AgentCore Runtime ARN is correct."
    elif "401" in error_msg or "Unauthorized" in error_msg:
        return "Error: Authentication failed. Please try logging in again."
    return f"Error: Failed to invoke agent: {error_msg}"


def _format_http_error(response: requests.Response) -> str:
    """Format HTTP error response."""
    try:
        error_detail = json.dumps(response.json(), indent=2)
    except:
        error_detail = response.text
    return f"Error ({response.status_code}): {error_detail}"


# =============================================================================
# Streaming Invocation Handlers
# =============================================================================


def invoke_local_agent_streaming(
    prompt: str,
    user_info: Dict[str, Any],
    session_id: str,
    local_agent_url: str,
) -> Iterator[StreamEvent]:
    """Invoke a locally running agent via HTTP with streaming.
    
    Uses httpx with httpx-sse for streaming HTTP requests.
    Parses SSE events and yields StreamEvent objects.
    
    Args:
        prompt: User's prompt to send to the agent
        user_info: User information dictionary
        session_id: Session identifier for the conversation
        local_agent_url: URL of the locally running agent
        
    Yields:
        StreamEvent objects (TextDelta, ToolUse, ToolResult, StreamComplete, StreamError)
    """
    url = local_agent_url.rstrip('/')
    if not url.endswith('/invocations'):
        url = f"{url}/invocations"
    
    runtime_user_id = get_runtime_user_id(user_info, 'local-user')
    
    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": session_id,
        "X-Amzn-Bedrock-AgentCore-Runtime-User-Id": runtime_user_id,
    }
    
    try:
        with httpx.Client(timeout=120.0) as client:
            with connect_sse(client, "POST", url, headers=headers, json={"prompt": prompt}) as event_source:
                for sse in event_source.iter_sse():
                    if sse.data:
                        event = parse_sse_line(f"data: {sse.data}")
                        if event is not None:
                            yield event
                            
    except httpx.ConnectError:
        yield StreamError(error=f"Cannot connect to local agent at {url}. Is the agent running?")
    except httpx.TimeoutException:
        yield StreamError(error="Request to local agent timed out.")
    except Exception as e:
        error_msg = str(e)
        # httpx-sse raises when Content-Type is not text/event-stream (e.g. JSON error response)
        if "text/event-stream" in error_msg and "application/json" in error_msg:
            yield StreamError(error=_extract_json_error_from_non_sse(
                url, headers, {"prompt": prompt}, "local agent"
            ))
        else:
            yield StreamError(error=f"Failed to invoke local agent: {error_msg}")


def invoke_agent_streaming_oauth(
    prompt: str,
    user_info: Dict[str, Any],
    session_id: str,
    agentcore_runtime_arn: str,
    aws_region: str,
) -> Iterator[StreamEvent]:
    """Invoke the agent using OAuth Bearer token with streaming.
    
    Streams via OAuth Bearer token from AgentCore Runtime to Streamlit app.
    Uses the same SSE parsing as local agent.
    
    Args:
        prompt: User's prompt to send to the agent
        user_info: User information dictionary (must contain 'access_token')
        session_id: Session identifier for the conversation
        agentcore_runtime_arn: ARN of the AgentCore Runtime
        aws_region: AWS region for the AgentCore endpoint
        
    Yields:
        StreamEvent objects (TextDelta, ToolUse, ToolResult, StreamComplete, StreamError)
    """
    escaped_arn = urllib.parse.quote(agentcore_runtime_arn, safe='')
    url = f"https://bedrock-agentcore.{aws_region}.amazonaws.com/runtimes/{escaped_arn}/invocations?qualifier=DEFAULT"
    
    runtime_user_id = get_runtime_user_id(user_info)
    
    headers = {
        "Authorization": f"Bearer {user_info['access_token']}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": session_id,
        "X-Amzn-Bedrock-AgentCore-Runtime-User-Id": runtime_user_id,
    }
    
    try:
        with httpx.Client(timeout=120.0) as client:
            with connect_sse(client, "POST", url, headers=headers, json={"prompt": prompt}) as event_source:
                for sse in event_source.iter_sse():
                    if sse.data:
                        event = parse_sse_line(f"data: {sse.data}")
                        if event is not None:
                            yield event
                            
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            yield StreamError(error="Authentication failed. Your session may have expired. Please refresh the page.")
        else:
            yield StreamError(error=f"HTTP error ({e.response.status_code}): {e.response.text}")
    except httpx.ConnectError:
        yield StreamError(error=f"Cannot connect to AgentCore Runtime at {aws_region}")
    except httpx.TimeoutException:
        yield StreamError(error="Request to AgentCore Runtime timed out.")
    except Exception as e:
        error_msg = str(e)
        # httpx-sse raises when Content-Type is not text/event-stream (e.g. JSON error response)
        if "text/event-stream" in error_msg and "application/json" in error_msg:
            yield StreamError(error=_extract_json_error_from_non_sse(
                url, headers, {"prompt": prompt}, "AgentCore Runtime"
            ))
        else:
            yield StreamError(error=f"Failed to invoke agent: {error_msg}")


def invoke_agent_streaming_iam(
    prompt: str,
    user_info: Dict[str, Any],
    session_id: str,
    agentcore_runtime_arn: str,
    aws_region: str,
) -> Iterator[StreamEvent]:
    """Invoke the agent using IAM authentication with streaming.
    
    Streams via boto3 IAM auth from AgentCore Runtime to Streamlit app.
    Handles boto3 streaming response format.
    
    Args:
        prompt: User's prompt to send to the agent
        user_info: User information dictionary
        session_id: Session identifier for the conversation
        agentcore_runtime_arn: ARN of the AgentCore Runtime
        aws_region: AWS region for the AgentCore endpoint
        
    Yields:
        StreamEvent objects (TextDelta, ToolUse, ToolResult, StreamComplete, StreamError)
    """
    try:
        client = boto3.client('bedrock-agentcore', region_name=aws_region)
        runtime_user_id = get_runtime_user_id(user_info)

        payload = json.dumps({"prompt": prompt}).encode()

        response = client.invoke_agent_runtime(
            agentRuntimeArn=agentcore_runtime_arn,
            runtimeSessionId=session_id,
            runtimeUserId=runtime_user_id,
            qualifier='DEFAULT',
            payload=payload
        )
        
        content_type = response.get("contentType", "")
        response_body = response.get("response")

        # Handle streaming response (text/event-stream)
        if "text/event-stream" in content_type:
            yield from _parse_iam_streaming_response(response_body)
        else:
            # Non-streaming response - parse and yield as complete
            result = _process_iam_response(response)
            if result.startswith("Error"):
                yield StreamError(error=result)
            else:
                yield TextDelta(text=result)
                yield StreamComplete(final_message=None)
                
    except Exception as e:
        error_msg = str(e)
        logger.error("IAM streaming invocation failed: %s", error_msg)
        if "AccessDenied" in error_msg or "UnauthorizedOperation" in error_msg:
            yield StreamError(error="Access denied. Please check your AWS credentials and permissions.")
        elif "ResourceNotFound" in error_msg:
            yield StreamError(error="Agent runtime not found. Please verify the AgentCore Runtime ARN is correct.")
        else:
            yield StreamError(error=f"Failed to invoke agent: {error_msg}")


def _parse_iam_streaming_response(response_body) -> Iterator[StreamEvent]:
    """Parse streaming response from IAM invocation.
    
    Handles boto3 StreamingBody and list responses.
    
    Args:
        response_body: Response body from boto3 (StreamingBody or list)
        
    Yields:
        StreamEvent objects
    """
    # Handle StreamingBody object
    if hasattr(response_body, 'iter_lines'):
        for line in response_body.iter_lines():
            if isinstance(line, bytes):
                line = line.decode('utf-8')
            if line:
                event = parse_sse_line(line)
                if event is not None:
                    yield event
    elif hasattr(response_body, 'read'):
        # Read entire body and parse line by line
        body_content = response_body.read()
        if isinstance(body_content, bytes):
            body_content = body_content.decode('utf-8')
        for line in body_content.split('\n'):
            if line.strip():
                event = parse_sse_line(line)
                if event is not None:
                    yield event
    elif isinstance(response_body, list):
        # Handle list of chunks
        for chunk in response_body:
            if isinstance(chunk, bytes):
                chunk = chunk.decode('utf-8')
            for line in chunk.split('\n'):
                if line.strip():
                    event = parse_sse_line(line)
                    if event is not None:
                        yield event
    else:
        logger.error(f"_parse_iam_streaming_response: Unexpected response_body type: {type(response_body).__name__}")
        yield StreamError(error="Unexpected response format from IAM invocation")


def invoke_agent_streaming(
    prompt: str,
    user_info: Dict[str, Any],
    session_id: str,
    *,
    local_agent_url: str = "",
    agentcore_runtime_arn: str = "",
    aws_region: str = "us-west-2",
    cognito_auth_enabled: bool = False,
    runtime_auth_mode: str = "iam",
) -> Iterator[StreamEvent]:
    """Unified streaming invocation entry point.
    
    Routes to appropriate handler based on config:
    - local_agent_url set: Use local agent streaming
    - runtime_auth_mode == "oauth" AND user has access_token: Use OAuth streaming
    - Default: Use IAM streaming (boto3 SigV4)
    
    Note: cognito_auth_enabled refers to how the *user* authenticates to the
    frontend app, NOT how the frontend authenticates to AgentCore Runtime.
    The runtime_auth_mode controls the latter. Most deployments use IAM auth
    to invoke the runtime (the ECS task role has grantInvoke permissions).
    
    Args:
        prompt: User's prompt to send to the agent
        user_info: User information dictionary
        session_id: Session identifier for the conversation
        local_agent_url: URL of locally running agent (if any)
        agentcore_runtime_arn: ARN of the AgentCore Runtime
        aws_region: AWS region for the AgentCore endpoint
        cognito_auth_enabled: Whether Cognito OAuth is enabled for user auth
        runtime_auth_mode: How to authenticate to the runtime ("iam" or "oauth")
        
    Yields:
        StreamEvent objects (TextDelta, ToolUse, ToolResult, StreamComplete, StreamError)
    """
    # Route to local agent if URL is provided
    if local_agent_url:
        yield from invoke_local_agent_streaming(prompt, user_info, session_id, local_agent_url)
        return
    
    # Validate AgentCore Runtime ARN
    if not agentcore_runtime_arn:
        logger.error("invoke_agent_streaming: No runtime ARN configured")
        yield StreamError(error="AgentCore Runtime ARN not configured (and no LOCAL_AGENT_URL set)")
        return
    
    # Route based on runtime auth mode (NOT user auth mode)
    # OAuth is only used when the runtime itself has an OAuth authorizer configured
    if runtime_auth_mode == "oauth" and user_info.get('access_token'):
        yield from invoke_agent_streaming_oauth(
            prompt, user_info, session_id, agentcore_runtime_arn, aws_region
        )
    else:
        yield from invoke_agent_streaming_iam(
            prompt, user_info, session_id, agentcore_runtime_arn, aws_region
        )
