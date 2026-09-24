# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""Application-level Cognito OAuth authentication.

Handles the OAuth 2.0 Authorization Code flow with Cognito Hosted UI
directly in the Streamlit application. This avoids the requirement for
HTTPS on the ALB (which is needed for ALB-level Cognito auth actions).

Flow:
1. User visits the app → no token in session → redirect to Cognito login
2. Cognito redirects back with ?code=... → app exchanges code for tokens
3. Tokens stored in session state → user is authenticated

Environment variables (set by CDK):
- COGNITO_USER_POOL_ID: Cognito User Pool ID
- COGNITO_CLIENT_ID: App client ID
- COGNITO_CLIENT_SECRET: App client secret
- COGNITO_DOMAIN: Cognito hosted UI domain (e.g., agent-auth-123456789.auth.us-east-1.amazoncognito.com)
- COGNITO_REDIRECT_URI: OAuth callback URL (the CloudFront distribution URL)
"""

from __future__ import annotations

import base64
import logging
import os
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt
from jwt import PyJWKClient
import streamlit as st

logger = logging.getLogger(__name__)

# Cache the JWKS client per user pool to avoid re-fetching keys on every request.
# Keys are cached in-memory for the lifetime of the Streamlit process.
_jwks_clients: dict[str, PyJWKClient] = {}


def _get_jwks_client(region: str, user_pool_id: str) -> PyJWKClient:
    """Get or create a cached JWKS client for the given Cognito User Pool.
    
    The JWKS endpoint provides the public keys used to verify JWT signatures
    issued by this Cognito User Pool.
    """
    cache_key = f"{region}:{user_pool_id}"
    if cache_key not in _jwks_clients:
        jwks_url = f"https://cognito-idp.{region}.amazonaws.com/{user_pool_id}/.well-known/jwks.json"
        _jwks_clients[cache_key] = PyJWKClient(jwks_url, cache_keys=True)
    return _jwks_clients[cache_key]


@dataclass
class CognitoConfig:
    """Cognito OAuth configuration loaded from environment variables."""
    user_pool_id: str
    client_id: str
    client_secret: str
    domain: str
    redirect_uri: str
    region: str

    @classmethod
    def from_env(cls) -> "CognitoConfig | None":
        """Load Cognito config from environment. Returns None if not configured."""
        client_id = os.environ.get("COGNITO_CLIENT_ID", "")
        if not client_id:
            return None

        region = os.environ.get("AWS_REGION", "us-east-1")
        return cls(
            user_pool_id=os.environ.get("COGNITO_USER_POOL_ID", ""),
            client_id=client_id,
            client_secret=os.environ.get("COGNITO_CLIENT_SECRET", ""),
            domain=os.environ.get("COGNITO_DOMAIN", ""),
            redirect_uri=os.environ.get("COGNITO_REDIRECT_URI", ""),
            region=region,
        )

    @property
    def token_endpoint(self) -> str:
        return f"https://{self.domain}/oauth2/token"

    @property
    def authorize_endpoint(self) -> str:
        return f"https://{self.domain}/oauth2/authorize"

    @property
    def logout_endpoint(self) -> str:
        return f"https://{self.domain}/logout"


def _get_basic_auth_header(client_id: str, client_secret: str) -> str:
    """Create Basic auth header for token exchange."""
    credentials = f"{client_id}:{client_secret}"
    encoded = base64.b64encode(credentials.encode()).decode()
    return f"Basic {encoded}"


def _exchange_code_for_tokens(code: str, config: CognitoConfig) -> dict[str, Any] | None:
    """Exchange authorization code for tokens with Cognito token endpoint.

    Supports both confidential clients (with secret) and public clients (without secret).
    When client_secret is set, uses Basic auth header. Otherwise, sends client_id in the body only.
    """
    try:
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": config.redirect_uri,
            "client_id": config.client_id,
        }
        headers: dict[str, str] = {
            "Content-Type": "application/x-www-form-urlencoded",
        }

        # Confidential client: use Basic auth with client_id:client_secret
        # Public client (no secret): just send client_id in the body (already included above)
        if config.client_secret:
            headers["Authorization"] = _get_basic_auth_header(config.client_id, config.client_secret)

        response = httpx.post(
            config.token_endpoint,
            data=data,
            headers=headers,
            timeout=10.0,
        )
        if response.status_code == 200:
            return response.json()
        else:
            logger.error(f"Token exchange failed: {response.status_code} - {response.text}")
            return None
    except Exception as e:
        logger.error(f"Token exchange error: {e}")
        return None


def _decode_id_token(id_token: str, config: CognitoConfig) -> dict[str, Any] | None:
    """Decode and verify the ID token using Cognito's public keys (JWKS).
    
    Validates:
    - Signature (RS256) against Cognito's published JWKS
    - Expiration (exp claim)
    - Audience (aud claim matches our client_id)
    - Issuer (iss claim matches our user pool)
    
    Returns None (fails closed) if verification cannot be completed for any reason.
    """
    issuer = f"https://cognito-idp.{config.region}.amazonaws.com/{config.user_pool_id}"
    
    try:
        jwks_client = _get_jwks_client(config.region, config.user_pool_id)
        signing_key = jwks_client.get_signing_key_from_jwt(id_token)
        
        return jwt.decode(
            id_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=config.client_id,
            issuer=issuer,
        )
    except jwt.exceptions.InvalidSignatureError:
        logger.error("ID token signature verification failed — possible token forgery")
        return None
    except jwt.exceptions.ExpiredSignatureError:
        logger.warning("ID token has expired")
        return None
    except jwt.exceptions.InvalidAudienceError:
        logger.error("ID token audience does not match client_id")
        return None
    except jwt.exceptions.InvalidIssuerError:
        logger.error("ID token issuer does not match user pool")
        return None
    except (jwt.exceptions.PyJWKClientError, Exception) as e:
        # JWKS fetch failed — fail closed to prevent accepting forged tokens.
        # This can happen if the network can't reach Cognito's JWKS endpoint.
        # In local development, auth is typically bypassed entirely (no Cognito config).
        logger.error(
            f"Could not verify ID token signature (JWKS fetch failed: {e}). "
            f"Rejecting token to prevent potential forgery."
        )
        return None


def get_login_url(config: CognitoConfig) -> str:
    """Build the Cognito Hosted UI login URL."""
    params = {
        "client_id": config.client_id,
        "response_type": "code",
        "scope": "email openid profile",
        "redirect_uri": config.redirect_uri,
    }
    return f"{config.authorize_endpoint}?{urlencode(params)}"


def get_logout_url(config: CognitoConfig) -> str:
    """Build the Cognito logout URL."""
    params = {
        "client_id": config.client_id,
        "logout_uri": config.redirect_uri,
    }
    return f"{config.logout_endpoint}?{urlencode(params)}"


def handle_oauth_callback(config: CognitoConfig) -> dict[str, Any] | None:
    """Handle the OAuth callback by exchanging the auth code for tokens.

    Checks query params for ?code=..., exchanges it, and returns user info.
    Returns None if no code is present or exchange fails.
    """
    query_params = st.query_params
    code = query_params.get("code")
    if not code:
        return None

    # Exchange code for tokens
    tokens = _exchange_code_for_tokens(code, config)
    if not tokens:
        st.error("Authentication failed. Please try again.")
        return None

    # Decode the ID token to get user claims (with signature verification)
    id_token = tokens.get("id_token", "")
    claims = _decode_id_token(id_token, config)
    if not claims:
        st.error("Failed to verify authentication token.")
        return None

    # Clear the code from URL to prevent re-use
    st.query_params.clear()

    # Build user info
    user_info = {
        "access_token": tokens.get("access_token"),
        "id_token": id_token,
        "refresh_token": tokens.get("refresh_token"),
        "identity": claims.get("sub"),
        "user_claims": claims,
        "email": claims.get("email"),
        "username": claims.get("cognito:username", claims.get("email")),
        "auth_type": "oauth",
    }

    return user_info


def require_auth(config: CognitoConfig) -> dict[str, Any] | None:
    """Main auth gate. Returns user info if authenticated, otherwise shows login.

    Call this at the top of your Streamlit app. If the user is not authenticated,
    it will either:
    - Process the OAuth callback (if ?code= is in the URL)
    - Show a login button/redirect to Cognito

    Returns user info dict if authenticated, None if login is shown (app should stop).
    """
    # Check if we already have a valid session
    if "cognito_user" in st.session_state and st.session_state.cognito_user:
        return st.session_state.cognito_user

    # Try to handle OAuth callback (user returning from Cognito login)
    user_info = handle_oauth_callback(config)
    if user_info:
        st.session_state.cognito_user = user_info
        st.rerun()  # Rerun to clear the code from URL and show the app

    # Not authenticated — show login page
    return None


def render_login_page(config: CognitoConfig) -> None:
    """Render the login page with a button that redirects to Cognito Hosted UI."""
    st.set_page_config(page_title="AI Agent Chat - Login", page_icon="🔐", layout="centered")
    st.title("🤖 AI Agent Chat")
    st.markdown("---")
    st.markdown("Please sign in to continue.")

    login_url = get_login_url(config)
    # Redirect to Cognito in the SAME tab. st.link_button always opens a new tab,
    # which leaves the user with two tabs after the Cognito round-trip (the original
    # login tab plus the redirected-back agent tab). Using a native button plus a
    # meta-refresh redirect keeps everything in one tab — the same pattern used for
    # logout in app.py.
    if st.button("🔑 Sign in with Cognito", use_container_width=True, type="primary"):
        st.markdown(
            f'<meta http-equiv="refresh" content="0;url={login_url}">',
            unsafe_allow_html=True,
        )
        st.stop()

    st.markdown("---")
    st.caption("Authentication is required to access this application.")
