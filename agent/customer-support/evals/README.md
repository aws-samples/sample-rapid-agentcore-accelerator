# Agent Evaluations

Evaluation tests for the customer support agent using the Strands Evals SDK.

## Setup

```bash
cd agent/customer-support/evals
uv sync
```

## Running Evaluations

Set the agent runtime ARN:

```bash
export AGENT_RUNTIME_ARN="arn:aws:bedrock-agentcore:us-west-2:123456789:runtime/your-runtime-id"
export AWS_DEFAULT_REGION="us-west-2"
```

### Against Deployed Runtime

```bash
uv run python eval_agent_acruntime.py
```

### Against Local Server

First, start the agent server in one terminal:

```bash
cd agent/customer-support/src
uv sync
uv run python main.py
```

Then run the local evaluation in another terminal:

```bash
cd agent/customer-support/evals
uv run python eval_agent_local.py
```

You can override the agent URL with `AGENT_URL` environment variable if needed.

## Test Cases

- **order-lookup**: Check status of existing order (ORD-12345)
- **order-not-found**: Handle non-existent order gracefully
- **product-info**: Get product details (WH-1000)
- **product-availability**: Check stock status (LS-3000)
- **create-ticket**: Create support ticket for damaged item
- **general-help**: Handle general greeting/help request

## How It Works

The evaluation invokes the deployed agent via the `InvokeAgentRuntime` API (boto3) and uses the Strands Evals `OutputEvaluator` to assess response quality based on tool usage, accuracy, helpfulness, and tone.
