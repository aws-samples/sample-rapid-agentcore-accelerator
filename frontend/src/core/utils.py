# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""
Utility functions for the Streamlit frontend.
"""

import logging
import os
from typing import Optional, Dict, Any
import streamlit as st
import jwt

logger = logging.getLogger(__name__)

# Header name that ALB uses to pass the pre-verified OIDC JWT
_ALB_OIDC_DATA_HEADER = "x-amzn-oidc-data"


def _decode_alb_verified_token(token: str, *, source_header: str) -> dict:
    """Decode a JWT token that has already been signature-verified by the ALB.

    This function skips cryptographic signature verification because the ALB has
    already validated the token before forwarding it. To prevent misuse, the
    caller MUST specify the header name the token was read from. If the header is
    not the ALB OIDC data header, this function raises ValueError.

    Args:
        token: The pre-authenticated JWT from the ALB.
        source_header: The HTTP header name from which the token was extracted.
            Must be 'x-amzn-oidc-data' (case-insensitive).

    Returns:
        Decoded JWT claims as a dictionary.

    Raises:
        ValueError: If source_header is not the expected ALB OIDC header.
        jwt.DecodeError: If the token is malformed.
    """
    if source_header.lower() != _ALB_OIDC_DATA_HEADER:
        raise ValueError(
            f"Signature-less JWT decoding is only permitted for tokens from the "
            f"'{_ALB_OIDC_DATA_HEADER}' header. Received token from "
            f"'{source_header}'. Use decode_token_with_verification() for "
            f"tokens from untrusted sources."
        )

    return jwt.decode(token, options={"verify_signature": False})


def decode_token_with_verification(
    token: str,
    *,
    public_key: str,
    algorithms: Optional[list] = None,
    audience: Optional[str] = None,
    issuer: Optional[str] = None,
) -> dict:
    """Decode and cryptographically verify a JWT token.

    Use this function for any token NOT sourced from the ALB pre-verified header
    (e.g., tokens from query parameters, client-submitted headers, or direct API
    calls).

    Args:
        token: The raw JWT string to decode and verify.
        public_key: PEM-encoded public key or JWKS key for signature verification.
        algorithms: Allowed signing algorithms (default: ['RS256']).
        audience: Expected 'aud' claim value (optional but recommended).
        issuer: Expected 'iss' claim value (optional but recommended).

    Returns:
        Decoded and verified JWT claims as a dictionary.

    Raises:
        jwt.InvalidSignatureError: If signature verification fails.
        jwt.ExpiredSignatureError: If the token has expired.
        jwt.InvalidTokenError: For other validation failures.
    """
    if algorithms is None:
        algorithms = ["RS256"]

    decode_options: Dict[str, Any] = {}
    kwargs: Dict[str, Any] = {
        "algorithms": algorithms,
        "options": decode_options,
    }
    if audience:
        kwargs["audience"] = audience
    if issuer:
        kwargs["issuer"] = issuer

    return jwt.decode(token, key=public_key, **kwargs)


def get_user_info_from_headers(
    cognito_auth_enabled: bool
) -> Optional[Dict[str, Any]]:
    """Extract user information based on deployment configuration.
    
    Handles three scenarios (checked in order):
    1. LOCAL_AGENT_URL set: Returns a default local user (no auth required)
    2. cognito_auth_enabled=False: Returns an anonymous internal user (IAM access)
    3. cognito_auth_enabled=True: Extracts user from ALB Cognito OIDC headers
    
    Args:
        cognito_auth_enabled: Whether Cognito authentication is configured on the ALB
        
    Returns:
        User info dict with keys (access_token, identity, user_claims, email,
        username, auth_type), or None if Cognito auth is enabled but headers
        are missing/invalid.
    """
    # Check if we're in local agent mode (no auth required)
    local_agent_url = os.environ.get("LOCAL_AGENT_URL", "")
    if local_agent_url:
        return {
            'access_token': None,
            'identity': 'local-user',
            'user_claims': {'email': 'local@example.com', 'cognito:username': 'local-user'},
            'email': 'local@example.com',
            'username': 'local-user',
            'auth_type': 'none'
        }
    
    # Internal deployment without Cognito - allow anonymous access
    if not cognito_auth_enabled:
        return {
            'access_token': None,
            'identity': 'internal-user',
            'user_claims': {},
            'email': None,
            'username': 'internal-user',
            'auth_type': 'iam'
        }
    
    # Cognito authentication enabled - extract from ALB headers
    headers = st.context.headers if hasattr(st.context, 'headers') else {}
    
    access_token = headers.get('x-amzn-oidc-accesstoken')
    identity = headers.get('x-amzn-oidc-identity')
    data_token = headers.get('x-amzn-oidc-data')
    
    if not access_token or not data_token:
        return None
    
    try:
        decoded_data = _decode_alb_verified_token(
            data_token, source_header=_ALB_OIDC_DATA_HEADER
        )
        return {
            'access_token': access_token,
            'identity': identity,
            'user_claims': decoded_data,
            'email': decoded_data.get('email'),
            'username': decoded_data.get('cognito:username'),
            'auth_type': 'oauth'
        }
    except Exception as e:
        st.error(f"Failed to decode user information: {e}")
        return None


def parse_agent_response(result: dict) -> str:
    """Parse the agent response and extract the text content.
    
    Handles multiple response shapes:
    - Plain string → returned as-is
    - {"result": str} → returns the string
    - {"result": {"content": [{"text": ...}]}} → joins text items
    - {"result": {"content": str}} → returns the string
    - {"result": {"text": str}} → returns the text
    - Any other shape → str() fallback
    
    Args:
        result: Agent response dict (or string) from invocation
        
    Returns:
        Extracted text content as a string
    """
    if isinstance(result, str):
        return result
    
    if "result" in result:
        inner = result["result"]
        if isinstance(inner, str):
            return inner
        if isinstance(inner, dict):
            if "content" in inner:
                content = inner["content"]
                if isinstance(content, list) and len(content) > 0:
                    texts = [item.get("text", "") for item in content if isinstance(item, dict)]
                    return "\n".join(texts)
                elif isinstance(content, str):
                    return content
            if "text" in inner:
                return inner["text"]
        return str(inner)
    
    return str(result)


def get_runtime_user_id(user_info: Dict[str, Any], default: str = 'anonymous-user') -> str:
    """Extract the runtime user ID from user info.
    
    Checks fields in priority order: identity → username → email → default.
    Used as the X-Amzn-Bedrock-AgentCore-Runtime-User-Id header value.
    
    Args:
        user_info: User information dictionary from authentication
        default: Fallback ID when no user identity is available
        
    Returns:
        The best available user identifier string
    """
    return (
        user_info.get('identity') or 
        user_info.get('username') or 
        user_info.get('email') or 
        default
    )
