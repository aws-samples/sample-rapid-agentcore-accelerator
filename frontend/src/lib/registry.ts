import "server-only";

/** An agent the UI can talk to: a deployed runtime ARN, or the local agent URL. */
export interface AgentEntry {
  name: string;
  runtimeArn: string;
}

/**
 * Resolves the agents this frontend can invoke.
 *
 * CDK injects AGENT_REGISTRY (JSON map of name → runtime ARN) when config.yaml
 * declares several agents, and AGENTCORE_RUNTIME_ARN when it declares one.
 * With LOCAL_AGENT_URL set, a single "local" agent is returned.
 */
export function getAgents(): AgentEntry[] {
  if (process.env.LOCAL_AGENT_URL) {
    return [{ name: "local", runtimeArn: "" }];
  }

  const registry = process.env.AGENT_REGISTRY;
  if (registry) {
    try {
      const parsed = JSON.parse(registry) as Record<string, string>;
      const entries = Object.entries(parsed).map(([name, runtimeArn]) => ({ name, runtimeArn }));
      if (entries.length > 0) {
        return entries;
      }
    } catch {
      console.warn("AGENT_REGISTRY is not valid JSON; falling back to AGENTCORE_RUNTIME_ARN");
    }
  }

  const arn = process.env.AGENTCORE_RUNTIME_ARN;
  if (arn) {
    // The runtime name is the last ARN segment, e.g. runtime/rapid_v1_customer_support-AbC123
    const name = arn.split("/").pop()?.replace(/-[A-Za-z0-9]+$/, "") || "agent";
    return [{ name, runtimeArn: arn }];
  }

  return [];
}

export function findAgent(name: string | undefined): AgentEntry | undefined {
  const agents = getAgents();
  return agents.find((a) => a.name === name) ?? (agents.length === 1 ? agents[0] : undefined);
}
