# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""
MCP (Model Context Protocol) Tools Integration

Simple integration with MCP servers running in AgentCore runtime.
"""

import os
import urllib.parse
from mcp_proxy_for_aws.client import aws_iam_streamablehttp_client
from strands.tools.mcp import MCPClient


def get_mcp_client_iam_auth(mcp_runtime_arn: str, region: str) -> MCPClient:
    """
    Instantiates a Strands MCPClient configured for IAM authentication with an AgentCore MCP runtime.
    
    Args:
        mcp_runtime_arn: The ARN of the AgentCore MCP runtime to connect to
        region: AWS region where the runtime is deployed
    
    Returns:
        MCPClient: Strands MCPClient instance (must be started/stopped by caller via context manager)
    """
    
    # Build MCP endpoint URL from runtime ARN
    encoded_arn = urllib.parse.quote(mcp_runtime_arn, safe='')
    mcp_url = f"https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{encoded_arn}/invocations?qualifier=DEFAULT"
    
    # Client Factory Integration
    mcp_client_factory = lambda: aws_iam_streamablehttp_client(
        endpoint=mcp_url,
        aws_region=region,
        aws_service="bedrock-agentcore"
    )
    
    # Return MCPClient object - needs to be started and stopped by caller
    return MCPClient(mcp_client_factory)