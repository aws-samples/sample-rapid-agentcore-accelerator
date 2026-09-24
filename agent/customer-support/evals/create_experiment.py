# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""
Creates and saves the base experiment with test cases.

Run this once to generate the experiment file that both eval scripts use:
    uv run python create_experiment.py
"""

from strands_evals import Case, Experiment
from strands_evals.evaluators import OutputEvaluator

JUDGE_MODEL_ID = "global.anthropic.claude-sonnet-4-5-20250929-v1:0"

# Test cases for customer support agent
TEST_CASES = [
    Case[str, str](
        name="order-lookup",
        input="Can you check the status of my order ORD-12345?",
        expected_output="shipped",
        metadata={"category": "order_status", "tool": "lookup_order"},
    ),
    Case[str, str](
        name="order-not-found",
        input="What's the status of order ORD-99999?",
        expected_output="not found",
        metadata={"category": "order_status", "tool": "lookup_order"},
    ),
    Case[str, str](
        name="product-info",
        input="Can you tell me about product WH-1000?",
        expected_output="Wireless Headphones",
        metadata={"category": "product_info", "tool": "get_product_info"},
    ),
    Case[str, str](
        name="product-availability",
        input="Is the laptop stand LS-3000 in stock?",
        expected_output="Out of Stock",
        metadata={"category": "product_info", "tool": "get_product_info"},
    ),
    Case[str, str](
        name="create-ticket",
        input="I need to report a problem with my order. My email is customer@example.com and my headphones arrived damaged.",
        expected_output=None,
        metadata={"category": "support_ticket", "tool": "create_support_ticket"},
    ),
    Case[str, str](
        name="general-help",
        input="Hi, I need help with a recent purchase.",
        expected_output="Gather more information",
        metadata={"category": "greeting"},
    ),
]

EVALUATOR = OutputEvaluator(
    rubric="""
    Evaluate the customer support agent's response based on:
    1. Tool Usage - Did the agent use the appropriate tool (lookup_order, get_product_info, create_support_ticket), or no tool if not needed?
    2. Accuracy - Is the information from the tool correctly conveyed?
    3. Helpfulness - Does the response address the customer's needs?
    4. Tone - Is the response friendly and professional?

    Score 1.0 if all criteria are met excellently.
    Score 0.7 if most criteria are met well.
    Score 0.5 if some criteria are partially met.
    Score 0.0 if the response is inadequate, incorrect, or unhelpful.
    """,
    include_inputs=True,
    model=JUDGE_MODEL_ID
)


def main():
    experiment = Experiment[str, str](cases=TEST_CASES, evaluators=[EVALUATOR])
    experiment.to_file("test_cases.json")
    print(f"Created test_cases.json with {len(TEST_CASES)} test cases and evaluator config")


if __name__ == "__main__":
    main()
