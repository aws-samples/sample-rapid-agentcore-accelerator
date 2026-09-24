# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""Agent registry for multi-agent frontend support.

Parses AGENT_REGISTRY JSON env var to provide agent name → ARN mapping.
Falls back to AGENTCORE_RUNTIME_ARN for backwards compatibility.
"""

import json
import logging
import os
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class AgentRegistry:
    """Registry of available agents and their runtime ARNs.

    Supports both multi-agent mode (AGENT_REGISTRY env var) and
    single-agent backwards compatibility (AGENTCORE_RUNTIME_ARN env var).
    """

    agents: dict[str, str]  # name → runtime ARN

    @classmethod
    def from_env(cls) -> "AgentRegistry":
        """Parse AGENT_REGISTRY env var. Falls back to AGENTCORE_RUNTIME_ARN."""
        registry_json = os.environ.get("AGENT_REGISTRY", "")
        if registry_json:
            try:
                agents = json.loads(registry_json)
                if isinstance(agents, dict) and agents:
                    return cls(agents=agents)
            except (json.JSONDecodeError, TypeError):
                logger.warning("Invalid AGENT_REGISTRY JSON, falling back")

        # Backwards compatibility: single agent from legacy env var
        arn = os.environ.get("AGENTCORE_RUNTIME_ARN", "")
        if arn:
            return cls(agents={"agent": arn})

        return cls(agents={})

    @property
    def is_multi_agent(self) -> bool:
        """Whether multiple agents are available."""
        return len(self.agents) > 1

    @property
    def agent_names(self) -> list[str]:
        """List of available agent names."""
        return list(self.agents.keys())

    def get_arn(self, name: str) -> str:
        """Get the runtime ARN for a named agent."""
        return self.agents[name]

    @property
    def is_empty(self) -> bool:
        """Whether the registry has no agents configured."""
        return len(self.agents) == 0
