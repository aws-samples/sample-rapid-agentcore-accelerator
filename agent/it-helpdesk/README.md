# IT Helpdesk Agent

An internal IT support agent that helps employees with common technical issues.

## Use Case

This agent serves as a first-line IT helpdesk, handling:
- **System status checks** — Is VPN down? Is Jira having issues?
- **Password resets** — Verified identity-based password reset flow
- **VPN setup** — Step-by-step instructions for Windows, Mac, and Linux
- **IT ticket creation** — Escalation for issues needing hands-on support
- **Knowledge base lookup** — IT policies, troubleshooting guides, software docs

## Quick Start

```bash
# Install dependencies
cd src && uv sync

# Run locally
uv run python main.py

# Chat with the agent (from another terminal, at the repository root)
make chat AGENT=it-helpdesk CHAT_ARGS=--local
```

To run it as a container instead of `uv run python main.py`:

```bash
make docker-run AGENT=it-helpdesk
```

## Knowledge Base

The agent's knowledge base (`knowledge-bases/it-docs/`) contains:
- `software-catalog.md` — Approved software and installation guides
- `security-policies.md` — Password requirements, MFA, data handling
- `troubleshooting-guide.md` — Common issue resolution steps

## Tools

| Tool | Purpose |
|------|---------|
| `check_system_status` | Query status of internal systems (VPN, email, Jira, etc.) |
| `reset_password` | Initiate verified password reset for employees |
| `create_it_ticket` | Create tickets for hardware, software, network, or access issues |
| `get_vpn_config` | Provide OS-specific VPN setup instructions |
| `retrieve_from_knowledge_base` | Search IT documentation and policies |

## Configuration

Environment variables (set by CDK or local `.env`):

| Variable | Purpose |
|----------|---------|
| `MEMORY_ID` | AgentCore Memory ID for cross-session context |
| `KNOWLEDGE_BASE_ID` | Bedrock KB ID for IT documentation |
| `MODEL_ID` | Bedrock model to use |
| `AWS_DEFAULT_REGION` | AWS region |
