// ============================================================================
// SAMPLE CODE - NOT FOR PRODUCTION USE
// This is sample code intended for demonstration and prototyping purposes only.
// It should be reviewed, tested, and validated before any production deployment.
// ============================================================================

import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';

export type DeploymentMode = 'local' | 'pipeline';
export type FrontendMode = 'none' | 'internal' | 'public' | 'cloudfront';

export interface AgentDefinition {
  name: string;           // kebab-case, 1-63 chars
  sourceDir: string;      // resolved path relative to repo root
  modelId: string;        // inherited from top-level if not specified
  mcpServers?: string[];  // names referencing McpDefinition entries (max 10)
  knowledgeBase?: string; // name referencing a KnowledgeBaseDefinition
}

export interface McpDefinition {
  name: string;           // kebab-case, 1-63 chars
  sourceDir: string;      // resolved path relative to repo root
}

export interface KnowledgeBaseDefinition {
  name: string;           // kebab-case, 1-63 chars
  sourceDir: string;      // path to documents directory relative to repo root
}

export interface AcceleratorConfig {
  region: string;
  deploymentPrefix: string;
  modelId: string;                            // resolved default model (may come from config or hardcoded default)
  deploymentMode: DeploymentMode;
  frontendMode: FrontendMode;
  domainName: string | null;
  hostedZoneName: string | null;
  agents: AgentDefinition[];                  // always populated (required in config.yaml)
  mcpServers: McpDefinition[];                // always populated (required in config.yaml)
  knowledgeBases: KnowledgeBaseDefinition[];   // always populated (empty if no KBs defined)
}

const VALID_DEPLOYMENT_MODES: readonly string[] = ['local', 'pipeline'];
const VALID_FRONTEND_MODES: readonly string[] = ['none', 'internal', 'public', 'cloudfront'];

/**
 * Derives the hosted-zone lookup name from the registrable parent of a domain name.
 * E.g. "agent.example.com" → "example.com", "sub.deep.example.co.uk" → "deep.example.co.uk"
 *
 * For simplicity, takes the last two labels (or the full domain if it only has two labels).
 */
function deriveHostedZoneName(domainName: string): string {
  const parts = domainName.split('.');
  if (parts.length <= 2) {
    return domainName;
  }
  // Return the registrable parent: last two labels for standard TLDs
  return parts.slice(-2).join('.');
}

/**
 * Loads config.yaml from the repo root, parses YAML, applies defaults,
 * and validates. Throws a descriptive Error (halting synth before any
 * resource is provisioned) when a required value is missing or invalid.
 *
 * This loader reads ONLY the config file; it never calls node.tryGetContext.
 */
export function loadAcceleratorConfig(repoRoot: string): AcceleratorConfig {
  const configPath = path.join(repoRoot, 'config.yaml');

  // Read the file
  let fileContent: string;
  try {
    fileContent = fs.readFileSync(configPath, 'utf-8');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to read config file at "${configPath}": ${message}`
    );
  }

  // Parse YAML
  let raw: unknown;
  try {
    raw = yaml.load(fileContent, { schema: yaml.FAILSAFE_SCHEMA });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to parse YAML in "${configPath}": ${message}`
    );
  }

  if (raw === null || raw === undefined || typeof raw !== 'object') {
    throw new Error(
      `Config file "${configPath}" is empty or does not contain a YAML mapping`
    );
  }

  const config = raw as Record<string, unknown>;

  // Validate region
  const region = config['region'];
  if (!region || typeof region !== 'string' || region.trim() === '') {
    throw new Error(
      `Invalid config: "region" has value "${String(region ?? '')}" but must be a non-empty string. ` +
      `Set it to the AWS region you deploy into (e.g. "us-west-2"). ` +
      `See docs/configuration.md for the full reference.`
    );
  }

  // Validate deploymentPrefix
  const rawPrefix = config['deploymentPrefix'];
  if (!rawPrefix || typeof rawPrefix !== 'string' || rawPrefix.trim() === '') {
    throw new Error(
      `Invalid config: "deploymentPrefix" has value "${String(rawPrefix ?? '')}" but must be a non-empty string. ` +
      `It makes all resource names unique so the stack can be deployed multiple times. ` +
      `Use lowercase letters, numbers, and hyphens (e.g. "my-first-agent"). ` +
      `See docs/configuration.md for the full reference.`
    );
  }
  const deploymentPrefix = rawPrefix.trim();
  // Validate format: must be lowercase alphanumeric + hyphens, start/end with alphanumeric, max 20 chars
  if (!/^[a-z0-9][a-z0-9-]{0,18}[a-z0-9]$/.test(deploymentPrefix) && !/^[a-z0-9]{1,2}$/.test(deploymentPrefix)) {
    throw new Error(
      `Invalid config: "deploymentPrefix" has value "${deploymentPrefix}" but must be 1-20 characters, ` +
      `lowercase letters/numbers/hyphens only, and must start and end with a letter or number. ` +
      `See docs/configuration.md for the full reference.`
    );
  }

  // Validate modelId (optional — defaults to Claude Haiku 4.5 if not specified)
  const DEFAULT_MODEL_ID = 'global.anthropic.claude-haiku-4-5-20251001-v1:0';
  const rawModelId = config['modelId'];
  const modelId = rawModelId && typeof rawModelId === 'string' && rawModelId.trim() !== ''
    ? rawModelId.trim()
    : DEFAULT_MODEL_ID;

  // Validate deploymentMode (default to 'local' when absent/null)
  let deploymentMode: DeploymentMode = 'local';
  const rawDeploymentMode = config['deploymentMode'];
  if (rawDeploymentMode !== undefined && rawDeploymentMode !== null) {
    if (
      typeof rawDeploymentMode !== 'string' ||
      !VALID_DEPLOYMENT_MODES.includes(rawDeploymentMode)
    ) {
      throw new Error(
        `Invalid config: "deploymentMode" has value "${String(rawDeploymentMode)}" but must be one of: ${VALID_DEPLOYMENT_MODES.join(', ')}`
      );
    }
    deploymentMode = rawDeploymentMode as DeploymentMode;
  }

  // Validate frontendMode (required, must be in set)
  const rawFrontendMode = config['frontendMode'];
  if (
    rawFrontendMode === undefined ||
    rawFrontendMode === null ||
    typeof rawFrontendMode !== 'string' ||
    !VALID_FRONTEND_MODES.includes(rawFrontendMode)
  ) {
    throw new Error(
      `Invalid config: "frontendMode" has value "${String(rawFrontendMode ?? '')}" but must be one of: ${VALID_FRONTEND_MODES.join(', ')}`
    );
  }
  const frontendMode = rawFrontendMode as FrontendMode;

  // Validate domainName when frontendMode is 'public'
  const rawDomainName = config['domainName'];
  const domainName =
    rawDomainName && typeof rawDomainName === 'string' && rawDomainName.trim() !== ''
      ? rawDomainName.trim()
      : null;

  // Security guard: "public" mode exposes an internet-facing load balancer, so it must
  // terminate HTTPS — which requires a custom domain. Reject the unsecured combination
  // at synth time, before any resource is provisioned.
  // (CloudFront mode is exempt: its ALB is private, restricted to the CloudFront managed
  // prefix list, so a plaintext HTTP listener behind CloudFront is an acceptable trade-off.)
  if (frontendMode === 'public' && !domainName) {
    throw new Error(
      `Invalid config: "frontendMode: public" requires "domainName" to be set. ` +
      `A public-facing load balancer without a domain would serve traffic over unencrypted HTTP, ` +
      `which is not allowed. Set "domainName" (and optionally "hostedZoneName") in config.yaml, ` +
      `or use "frontendMode: cloudfront" or "internal" instead.`
    );
  }

  // Derive hosted zone name from domainName (or use explicit override)
  const rawHostedZoneName = config['hostedZoneName'];
  const hostedZoneName =
    rawHostedZoneName && typeof rawHostedZoneName === 'string' && rawHostedZoneName.trim() !== ''
      ? rawHostedZoneName.trim()
      : domainName ? deriveHostedZoneName(domainName) : null;

  // Parse agents list (required)
  const topLevelModelId = modelId;
  let agents: AgentDefinition[];
  const rawAgents = config['agents'];
  if (rawAgents !== undefined && rawAgents !== null && Array.isArray(rawAgents)) {
    agents = rawAgents.map((entry: Record<string, unknown>) => {
      const name = entry['name'] as string;
      const sourceDir = entry['sourceDir']
        ? (entry['sourceDir'] as string)
        : `agent/${name}/src`;
      const agentModelId = entry['modelId']
        ? (entry['modelId'] as string).trim()
        : topLevelModelId;
      const mcpServers = entry['mcpServers'] as string[] | undefined;
      const knowledgeBase = entry['knowledgeBase'] as string | undefined;
      return { name, sourceDir, modelId: agentModelId, ...(mcpServers ? { mcpServers } : {}), ...(knowledgeBase ? { knowledgeBase } : {}) };
    });
  } else {
    throw new Error(
      `Invalid config: "agents" is required and must be a non-empty list. ` +
      `Each entry needs a "name"; its source is read from "agent/{name}/src" ` +
      `unless "sourceDir" is set. Example:\n` +
      `  agents:\n    - name: customer-support\n` +
      `See docs/configuration.md for the full reference.`
    );
  }

  // Parse mcpServers list (required)
  let mcpServers: McpDefinition[];
  const rawMcpServers = config['mcpServers'];
  if (rawMcpServers !== undefined && rawMcpServers !== null && Array.isArray(rawMcpServers)) {
    mcpServers = rawMcpServers.map((entry: Record<string, unknown>) => {
      const name = entry['name'] as string;
      const sourceDir = entry['sourceDir']
        ? (entry['sourceDir'] as string)
        : `mcp/${name}/src`;
      return { name, sourceDir };
    });
  } else {
    throw new Error(
      `Invalid config: "mcpServers" is required and must be a non-empty list. ` +
      `Each entry needs a "name"; its source is read from "mcp/{name}/src" ` +
      `unless "sourceDir" is set. Example:\n` +
      `  mcpServers:\n    - name: support-tools\n` +
      `See docs/configuration.md for the full reference.`
    );
  }

  // Parse knowledgeBases list (optional)
  let knowledgeBases: KnowledgeBaseDefinition[];
  const rawKnowledgeBases = config['knowledgeBases'];
  if (rawKnowledgeBases !== undefined && rawKnowledgeBases !== null && Array.isArray(rawKnowledgeBases)) {
    knowledgeBases = rawKnowledgeBases.map((entry: Record<string, unknown>) => {
      const name = entry['name'] as string;
      const sourceDir = entry['sourceDir']
        ? (entry['sourceDir'] as string)
        : `knowledge-bases/${name}`;
      return { name, sourceDir };
    });
  } else {
    knowledgeBases = [];
  }

  // --- Validation ---

  const NAME_REGEX = /^[a-z][a-z0-9-]{0,62}$/;

  // 1. Reject empty agents list (present but zero entries)
  if (agents.length === 0) {
    throw new Error(
      'agents list cannot be empty: at least one agent must be defined'
    );
  }

  // 2. Validate name format for all agents and MCP servers
  for (const agent of agents) {
    if (!NAME_REGEX.test(agent.name)) {
      throw new Error(
        `Invalid name "${agent.name}": must be kebab-case (lowercase letters, numbers, hyphens), start with a letter, 1-63 chars`
      );
    }
  }
  for (const mcp of mcpServers) {
    if (!NAME_REGEX.test(mcp.name)) {
      throw new Error(
        `Invalid name "${mcp.name}": must be kebab-case (lowercase letters, numbers, hyphens), start with a letter, 1-63 chars`
      );
    }
  }

  // 3. Detect duplicate agent names
  const agentNamesSeen = new Set<string>();
  for (const agent of agents) {
    if (agentNamesSeen.has(agent.name)) {
      throw new Error(
        `Duplicate agent name "${agent.name}" in agents list`
      );
    }
    agentNamesSeen.add(agent.name);
  }

  // 4. Detect duplicate MCP server names
  const mcpNamesSeen = new Set<string>();
  for (const mcp of mcpServers) {
    if (mcpNamesSeen.has(mcp.name)) {
      throw new Error(
        `Duplicate MCP server name "${mcp.name}" in mcpServers list`
      );
    }
    mcpNamesSeen.add(mcp.name);
  }

  // 5. Validate mcpServers references in agent definitions resolve to defined MCP servers
  const definedMcpNames = new Set(mcpServers.map(m => m.name));
  for (const agent of agents) {
    if (agent.mcpServers) {
      // 5a. Validate maximum 10 MCP server references per agent
      if (agent.mcpServers.length > 10) {
        throw new Error(
          `Agent "${agent.name}" references more than 10 MCP servers (maximum is 10)`
        );
      }
      for (const mcpName of agent.mcpServers) {
        if (!definedMcpNames.has(mcpName)) {
          throw new Error(
            `Agent "${agent.name}" references MCP server "${mcpName}" which is not defined in mcpServers`
          );
        }
      }
    }
  }

  // 5b. Validate knowledge base names and references
  for (const kb of knowledgeBases) {
    if (!NAME_REGEX.test(kb.name)) {
      throw new Error(
        `Invalid name "${kb.name}": must be kebab-case (lowercase letters, numbers, hyphens), start with a letter, 1-63 chars`
      );
    }
  }
  const kbNamesSeen = new Set<string>();
  for (const kb of knowledgeBases) {
    if (kbNamesSeen.has(kb.name)) {
      throw new Error(
        `Duplicate knowledge base name "${kb.name}" in knowledgeBases list`
      );
    }
    kbNamesSeen.add(kb.name);
  }
  const definedKbNames = new Set(knowledgeBases.map(kb => kb.name));
  for (const agent of agents) {
    if (agent.knowledgeBase && !definedKbNames.has(agent.knowledgeBase)) {
      throw new Error(
        `Agent "${agent.name}" references knowledge base "${agent.knowledgeBase}" which is not defined in knowledgeBases`
      );
    }
  }

  // 6. Validate sourceDir paths exist on disk for every agent, MCP server, and knowledge base
  for (const agent of agents) {
    const resolvedPath = path.join(repoRoot, agent.sourceDir);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(
        `Agent "${agent.name}" sourceDir "${agent.sourceDir}" does not exist`
      );
    }
  }
  for (const mcp of mcpServers) {
    const resolvedPath = path.join(repoRoot, mcp.sourceDir);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(
        `MCP server "${mcp.name}" sourceDir "${mcp.sourceDir}" does not exist`
      );
    }
  }
  for (const kb of knowledgeBases) {
    const resolvedPath = path.join(repoRoot, kb.sourceDir);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(
        `Knowledge base "${kb.name}" sourceDir "${kb.sourceDir}" does not exist`
      );
    }
  }

  return {
    region: region.trim(),
    deploymentPrefix,
    modelId: topLevelModelId,
    deploymentMode,
    frontendMode,
    domainName,
    hostedZoneName,
    agents,
    mcpServers,
    knowledgeBases,
  };
}
