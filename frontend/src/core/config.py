# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""Centralized configuration for the frontend application.

Provides AppConfig dataclass and OutboundAuth enum for managing
all environment variables and auth method detection in one place.
"""

import json
import logging
import os
import sys
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Resolve .rapid/outputs.json relative to the repo root.
# frontend/src/core/config.py → 4 parents up = repo root (local dev only).
# In Docker containers (/app/core/config.py), this path won't exist — that's fine,
# deployed containers get config via environment variables set by CDK.
try:
    _REPO_ROOT_OUTPUTS = Path(__file__).resolve().parents[3] / ".rapid" / "outputs.json"
except IndexError:
    _REPO_ROOT_OUTPUTS = Path("/nonexistent/outputs.json")


def _read_runtime_arn_from_outputs(path: Path = _REPO_ROOT_OUTPUTS) -> str:
    """Read the agent runtime ARN from the deploy outputs file.

    Returns the ARN string, or exits with a clear message if the file
    is absent/unreadable/unparseable or the ARN key is missing/empty.
    """
    try:
        content = path.read_text(encoding="utf-8")
    except (FileNotFoundError, OSError):
        print(
            "Outputs not found — run `make deploy` first.",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        outputs = json.loads(content)
    except json.JSONDecodeError:
        print(
            "Outputs file is malformed — run `make deploy` to regenerate.",
            file=sys.stderr,
        )
        sys.exit(1)

    arn = ""
    # New multi-agent format: agents.{name}.runtimeArn
    agents = outputs.get("agents", {})
    if isinstance(agents, dict) and agents:
        first_agent = next(iter(agents.values()), {})
        if isinstance(first_agent, dict):
            arn = first_agent.get("runtimeArn", "")
    
    # Legacy fallback
    if not arn:
        arn = outputs.get("agentRuntimeArn", "")

    if not arn or not isinstance(arn, str) or not arn.strip():
        print(
            "Missing agent runtime ARN in outputs — run `make deploy` first.",
            file=sys.stderr,
        )
        sys.exit(1)

    return arn


class OutboundAuth(str, Enum):
    """Authentication method for outbound agent invocations."""
    NONE = "none"    # Direct HTTP to local agent (no auth)
    IAM = "iam"      # IAM credentials for AgentCore Runtime
    OAUTH = "oauth"  # OAuth token from Cognito


@dataclass
class AppConfig:
    """Centralized application configuration.
    
    Loads all environment variables in a single location and provides
    helper methods for auth method detection and display text.
    """
    agentcore_runtime_arn: str
    aws_region: str
    local_agent_url: str
    cognito_auth_enabled: bool
    streaming_enabled: bool
    
    @classmethod
    def from_env(cls) -> "AppConfig":
        """Load configuration from environment variables with sensible defaults.

        Fallback order for the runtime ARN:
          1. AGENTCORE_RUNTIME_ARN env var (or .env)
          2. .rapid/outputs.json (auto-wired deploy outputs)
          3. Validation error (if LOCAL_AGENT_URL is also unset)
        """
        runtime_arn = os.environ.get("AGENTCORE_RUNTIME_ARN", "")
        local_agent_url = os.environ.get("LOCAL_AGENT_URL", "")

        # When neither env var is set, try the outputs file
        if not runtime_arn and not local_agent_url:
            runtime_arn = _read_runtime_arn_from_outputs()

        return cls(
            agentcore_runtime_arn=runtime_arn,
            aws_region=os.environ.get("AWS_REGION", "us-west-2"),
            local_agent_url=local_agent_url,
            cognito_auth_enabled=os.environ.get("COGNITO_AUTH_ENABLED", "false").lower() == "true",
            streaming_enabled=os.environ.get("STREAMING_ENABLED", "false").lower() == "true",
        )
    
    def validate(self) -> None:
        """Validate configuration and raise error if invalid.
        
        Raises:
            ValueError: If neither LOCAL_AGENT_URL nor AGENTCORE_RUNTIME_ARN is set
        """
        if not self.local_agent_url and not self.agentcore_runtime_arn:
            raise ValueError(
                "Configuration error: Either LOCAL_AGENT_URL or AGENTCORE_RUNTIME_ARN must be set"
            )
    
    def get_outbound_auth(self, user_info: dict[str, Any] | None = None) -> OutboundAuth:
        """Determine the outbound auth method based on config and user info.
        
        Args:
            user_info: User information dict, may contain 'access_token' for OAuth
            
        Returns:
            The OutboundAuth method to use for agent invocations
        """
        if self.local_agent_url:
            return OutboundAuth.NONE
        if self.cognito_auth_enabled and user_info and user_info.get('access_token'):
            return OutboundAuth.OAUTH
        return OutboundAuth.IAM
    
    def get_display_text(self, user_email: str | None = None) -> str:
        """Get display text for current connection (used in header).
        
        Args:
            user_email: User's email address (for OAuth mode display)
            
        Returns:
            Human-readable connection description for the UI header
        """
        streaming_suffix = " (streaming)" if self.streaming_enabled else ""
        
        if self.local_agent_url:
            return f"🔌 Connected to local agent: {self.local_agent_url}{streaming_suffix}"
        elif user_email:
            return f"Logged in as: {user_email} (OAuth){streaming_suffix}"
        else:
            return f"🔒 IAM Authentication{streaming_suffix}"
    
    def is_streaming_enabled(self) -> bool:
        """Check if streaming mode is enabled."""
        return self.streaming_enabled
