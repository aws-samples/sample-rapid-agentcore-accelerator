# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""
Evaluation tests for the customer support agent via AgentCore Runtime.

Invokes the agent via the InvokeAgentRuntime API and evaluates responses
for order lookups, product info, and support ticket creation.
"""

import json
import os
import sys
import uuid
from pathlib import Path

# Add agent src to sys.path so we can import the shared outputs reader.
_AGENT_SRC = str(Path(__file__).resolve().parent.parent / "src")
if _AGENT_SRC not in sys.path:
    sys.path.insert(0, _AGENT_SRC)

import boto3
from strands_evals import Case, Experiment
from utils.outputs import require_agent_runtime_arn

# Configuration: env var takes priority, then outputs file, then error.
AGENT_RUNTIME_ARN = os.environ.get("AGENT_RUNTIME_ARN") or require_agent_runtime_arn()
AWS_REGION = os.environ.get("AWS_DEFAULT_REGION", "us-west-2")
DEBUG = os.environ.get("DEBUG", "false").lower() == "true"
EXPERIMENT_FILE = Path(__file__).parent / "test_cases.json"


def extract_text_from_result(result: dict) -> str:
    """
    Extract text from the agent response structure.

    The response format is:
    {"result": {"role": "assistant", "content": [{"text": "..."}]}}
    """
    if isinstance(result, str):
        return result

    inner = result.get("result", result)

    if isinstance(inner, str):
        return inner

    if isinstance(inner, dict):
        content = inner.get("content", [])
        if isinstance(content, list):
            texts = []
            for item in content:
                if isinstance(item, dict) and "text" in item:
                    texts.append(item["text"])
            if texts:
                return "\n".join(texts)

        if "message" in inner:
            return str(inner["message"])

    return str(result)


def invoke_agent(prompt: str, session_id: str = None) -> str:
    """
    Invoke the deployed agent via InvokeAgentRuntime API.

    Args:
        prompt: The user prompt to send to the agent.
        session_id: Optional session ID for conversation context.

    Returns:
        The agent's response as a string.
    """
    if not AGENT_RUNTIME_ARN:
        raise ValueError("AGENT_RUNTIME_ARN environment variable is required")

    client = boto3.client("bedrock-agentcore", region_name=AWS_REGION)

    payload = json.dumps({"prompt": prompt}).encode()
    session_id = session_id or str(uuid.uuid4())

    try:
        response = client.invoke_agent_runtime(
            agentRuntimeArn=AGENT_RUNTIME_ARN,
            runtimeSessionId=session_id,
            payload=payload,
        )
    except Exception as e:
        print(f"[ERROR] Failed to invoke agent: {e}")
        raise

    if DEBUG:
        print(f"[DEBUG] Response keys: {response.keys()}")
        print(f"[DEBUG] Content-Type: {response.get('contentType', 'N/A')}")

    content_type = response.get("contentType", "")

    if "text/event-stream" in content_type:
        content = []
        for line in response["response"].iter_lines(chunk_size=10):
            if line:
                line = line.decode("utf-8")
                if line.startswith("data: "):
                    content.append(line[6:])
        result = "".join(content)
        if DEBUG:
            print(f"[DEBUG] Streaming result length: {len(result)} chars")
        return result

    elif content_type == "application/json":
        content = []
        for chunk in response.get("response", []):
            chunk_str = chunk.decode("utf-8")
            content.append(chunk_str)
        raw_content = "".join(content)
        if DEBUG:
            print(f"[DEBUG] JSON response length: {len(raw_content)} chars")
        result = json.loads(raw_content)
        final_result = extract_text_from_result(result)
        if DEBUG:
            print(f"[DEBUG] Parsed result type: {type(final_result)}, length: {len(str(final_result))} chars")
        return final_result

    else:
        if DEBUG:
            print(f"[DEBUG] Unknown content type: {content_type}")
        return str(response)


def get_response(case: Case) -> str:
    """Task function for evaluation - invokes the deployed agent."""
    try:
        result = invoke_agent(case.input)
        if DEBUG:
            print(f"[DEBUG] get_response returning: {type(result)}, length: {len(str(result))} chars")
        if result is None:
            return "Error: Agent returned None"
        return str(result)
    except Exception as e:
        print(f"[ERROR] get_response failed for case '{case.name}': {type(e).__name__}")
        return f"Error: {type(e).__name__}"


def run_evaluation():
    """Run the agent evaluation."""
    print("=== Agent Evaluation ===\n")
    print(f"Agent ARN: {AGENT_RUNTIME_ARN}\n")

    # Load experiment from shared file
    experiment = Experiment[str, str].from_file(str(EXPERIMENT_FILE))
    print(f"Loaded {len(experiment.cases)} test cases from {EXPERIMENT_FILE.name}\n")

    reports = experiment.run_evaluations(get_response)
    reports[0].run_display()

    return reports


if __name__ == "__main__":
    if not EXPERIMENT_FILE.exists():
        print(f"Error: {EXPERIMENT_FILE} not found.")
        print("Run 'uv run python create_experiment.py' first to create it.")
        exit(1)

    run_evaluation()
