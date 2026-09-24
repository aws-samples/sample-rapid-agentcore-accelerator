# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""Context parsing utilities."""


def _get_headers(context) -> dict:
    """Extract headers from context.request.headers (Starlette Request)."""
    request = getattr(context, "request", None)
    if request and hasattr(request, "headers"):
        return dict(request.headers)
    return {}


def extract_session_context(context) -> tuple[str, str]:
    """Extract session_id and actor_id from AgentCore context.

    Args:
        context: AgentCore runtime context object

    Returns:
        Tuple of (session_id, actor_id)
    """
    headers = _get_headers(context)

    session_id = (
        getattr(context, "session_id", None)
        or headers.get("x-amzn-bedrock-agentcore-runtime-session-id")
        or "default-session"
    )

    actor_id = None

    if hasattr(context, "runtime_user_id"):
        actor_id = context.runtime_user_id
    elif hasattr(context, "user_id"):
        actor_id = context.user_id

    if not actor_id:
        actor_id = headers.get("x-amzn-bedrock-agentcore-runtime-user-id")

    if not actor_id:
        actor_id = "anonymous"

    return session_id, actor_id
