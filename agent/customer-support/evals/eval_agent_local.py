# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""
Local evaluation tests for the customer support agent.

Makes POST requests to the locally running agent server at localhost:8080.
Start the agent first with: cd agent/src && uv run python main.py
"""

import os
from pathlib import Path

import requests
from strands_evals import Case, Experiment

DEBUG = os.environ.get("DEBUG", "false").lower() == "true"
AGENT_URL = os.environ.get("AGENT_URL", "http://localhost:8080/invocations")
EXPERIMENT_FILE = Path(__file__).parent / "test_cases.json"


def extract_text_from_result(result: dict) -> str:
    """Extract text from the agent response structure."""
    if isinstance(result, str):
        return result

    inner = result.get("result", result)

    if isinstance(inner, str):
        return inner

    if isinstance(inner, dict):
        content = inner.get("content", [])
        if isinstance(content, list):
            texts = [item["text"] for item in content if isinstance(item, dict) and "text" in item]
            if texts:
                return "\n".join(texts)
        if "message" in inner:
            return str(inner["message"])

    return str(result)


def get_response(case: Case) -> str:
    """Task function for evaluation - invokes the local agent via HTTP."""
    try:
        payload = {"prompt": case.input}

        if DEBUG:
            print(f"[DEBUG] POST {AGENT_URL}")
            print(f"[DEBUG] Payload length: {len(json.dumps(payload))} chars")

        response = requests.post(
            AGENT_URL,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=60,
        )
        response.raise_for_status()

        result = response.json()
        text = extract_text_from_result(result)

        if DEBUG:
            print(f"[DEBUG] Response length: {len(text)} chars")

        return text
    except requests.exceptions.ConnectionError:
        return "Error: Could not connect to agent. Is it running? Start with: cd agent/src && uv run python main.py"
    except Exception as e:
        print(f"[ERROR] get_response failed for case '{case.name}': {type(e).__name__}")
        return f"Error: {e}"


def run_evaluation():
    """Run the local agent evaluation."""
    print("=== Local Agent Evaluation ===\n")

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
