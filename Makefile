.PHONY: help doctor install deploy ingest-kb chat docker-run logs ui enable-cicd destroy
.DEFAULT_GOAL := help

# Default agent to use for local dev commands (override with: make chat AGENT=my-agent)
AGENT ?= customer-support
# Optional: target a specific knowledge base (override with: make ingest-kb KB=it-docs)
KB ?=
# Optional: extra flags passed through to scripts/chat.sh (e.g. CHAT_ARGS=--local)
CHAT_ARGS ?=

help:                 ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n",$$1,$$2}'

doctor:               ## Check prerequisites before deploying
	./scripts/doctor.sh

install:              ## Install infra (CDK) npm dependencies
	cd infra && npm install

deploy: install       ## Deploy the AgentCoreStack from config.yaml
	cd infra && npx cdk deploy --all --require-approval never --outputs-file /tmp/cdk-outputs.json
	./scripts/write_outputs.sh

ingest-kb:            ## Upload KB documents to S3 and start ingestion. Use KB=name for one KB.
	./scripts/ingest-kb-assets.sh $(KB)

chat:                 ## Chat with the deployed agent (streaming). Use AGENT=name to pick agent.
	./scripts/chat.sh $(AGENT) --stream $(CHAT_ARGS)

docker-run:           ## Build and run an agent container locally. Use AGENT=name to pick agent.
	./scripts/docker-run.sh $(AGENT) --build

logs:                 ## Tail the deployed agent runtime logs
	./scripts/logs.sh

ui:                   ## Run the Streamlit frontend locally against the deployed agent
	./frontend/local/run_local.sh

enable-cicd:          ## Graduation step: set up CodeCommit + pipelines (opt-in)
	./scripts/enable_cicd.sh

destroy:              ## Tear down the deployed stack and all resources
	cd infra && npx cdk destroy --all --force
	@echo ""
	@echo "  ⚠️  Some resources may require manual cleanup:"
	@echo "    • AgentCore Runtimes (agent + MCP server)"
	@echo "    • AgentCore Memory stores"
	@echo "    • CodeCommit repository"
	@echo ""
	@echo "  Check the AWS Console if you want a fully clean account."
