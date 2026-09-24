# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""Shared reader for .rapid/outputs.json deploy outputs."""

import json
import logging
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

REPO_ROOT_OUTPUTS = Path(__file__).resolve().parents[3] / ".rapid" / "outputs.json"


def load_outputs(path: Path = REPO_ROOT_OUTPUTS) -> dict:
    """Read and parse .rapid/outputs.json.

    Args:
        path: Path to the outputs JSON file. Defaults to the repo-root location.

    Returns:
        Parsed dict of deploy outputs.

    Raises:
        FileNotFoundError: If the file is absent or unreadable.
        ValueError: If the file contents are not valid JSON.
    """
    try:
        content = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        logger.debug("Outputs file not found at %s", path)
        raise FileNotFoundError(
            "Outputs not found \u2014 run `make deploy` first."
        )
    except OSError as exc:
        logger.debug("Cannot read outputs file at %s: %s", path, exc)
        raise FileNotFoundError(
            "Outputs not found \u2014 run `make deploy` first."
        )

    try:
        return json.loads(content)
    except json.JSONDecodeError as exc:
        logger.debug("Failed to parse outputs JSON at %s: %s", path, exc)
        raise ValueError(
            "Outputs file is malformed \u2014 run `make deploy` to regenerate."
        )


def require_agent_runtime_arn() -> str:
    """Return the agent runtime ARN from the outputs file.

    Exits with a clear message if the file is missing/unreadable/unparseable
    or the agentRuntimeArn key is absent/empty.

    Returns:
        The agent runtime ARN string.
    """
    try:
        outputs = load_outputs()
    except (FileNotFoundError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)

    arn = outputs.get("agentRuntimeArn", "")
    if not arn or not isinstance(arn, str) or not arn.strip():
        print(
            "Missing agent runtime ARN in outputs \u2014 run `make deploy` first.",
            file=sys.stderr,
        )
        sys.exit(1)

    return arn
