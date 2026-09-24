// ============================================================================
// SAMPLE CODE - NOT FOR PRODUCTION USE
// This is sample code intended for demonstration and prototyping purposes only.
// It should be reviewed, tested, and validated before any production deployment.
// ============================================================================
//
// Feature: oss-release-readiness
//
// Property 16: Invalid configuration is rejected with an actionable error.
//   For any mutation of a valid configuration object drawn from the mutation
//   space, loadAcceleratorConfig throws an error whose message names the
//   offending key, and throws before any construct is instantiated.
//   **Validates: Requirements 14.7, 6.5, 6.6**
//
// Property 17: Every frontend mode is either supported and documented, or
//   rejected. The loader accepts each of none, internal, public, cloudfront;
//   any other value is rejected with an error naming the accepted set.
//   **Validates: Requirements 5.6, 14.7**
//   (Only the loader half is checked here. That docs/frontend.md describes the
//   resources each mode provisions is a review responsibility.)
// ============================================================================

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as fc from 'fast-check';
import { loadAcceleratorConfig } from '../lib/config';

// The loader reads config.yaml from disk and probes sourceDir paths with
// existsSync. Both are mocked. NOTE: jest.mock('fs') auto-mocks existsSync to
// return undefined (falsy), which makes *every* sourceDir look missing — under
// that default, every mutation would "pass" for the wrong reason. existsSync is
// therefore given an explicit implementation that returns true for every path
// except ones deliberately marked as absent.
jest.mock('fs');
const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;

const REPO_ROOT = '/fake/repo';
const ABSENT_MARKER = 'does-not-exist';
const NUM_RUNS = 200;

const VALID_FRONTEND_MODES = ['none', 'internal', 'public', 'cloudfront'] as const;
const VALID_DEPLOYMENT_MODES = ['local', 'pipeline'] as const;
const REQUIRED_KEYS = ['region', 'deploymentPrefix', 'frontendMode', 'agents', 'mcpServers'] as const;

/** Keys whose value is a scalar in the valid base object and which the loader rejects on type. */
const TYPED_SCALAR_KEYS = ['region', 'deploymentPrefix', 'frontendMode', 'deploymentMode'] as const;

type ListKey = 'agents' | 'mcpServers' | 'knowledgeBases';
const LIST_KEYS: readonly ListKey[] = ['agents', 'mcpServers', 'knowledgeBases'];

/** Default sourceDir root per list key, mirroring the loader's resolution rule. */
const SOURCE_DIR_ROOT: Record<ListKey, string> = {
  agents: 'agent',
  mcpServers: 'mcp',
  knowledgeBases: 'knowledge-bases',
};

type ConfigObject = Record<string, unknown>;
type Entry = Record<string, unknown>;

/**
 * The valid base object. Mirrors the base used by makeConfigYaml in
 * config.test.ts, extended with the now-required agents and mcpServers lists
 * plus a knowledge base so that cross-reference mutations have a target.
 */
function baseConfig(): ConfigObject {
  return {
    region: 'us-west-2',
    deploymentPrefix: 'testprefix',
    modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
    deploymentMode: 'local',
    frontendMode: 'none',
    agents: [
      { name: 'customer-support', mcpServers: ['support-tools'], knowledgeBase: 'support-docs' },
      { name: 'it-helpdesk' },
    ],
    mcpServers: [{ name: 'support-tools' }],
    knowledgeBases: [{ name: 'support-docs' }],
  };
}

function clone(config: ConfigObject): ConfigObject {
  return JSON.parse(JSON.stringify(config)) as ConfigObject;
}

function listOf(config: ConfigObject, key: ListKey): Entry[] {
  return config[key] as Entry[];
}

function installMocks(yamlText: string): void {
  mockReadFileSync.mockReturnValue(yamlText);
  mockExistsSync.mockImplementation((p) => !String(p).includes(ABSENT_MARKER));
}

/** A syntactically valid kebab-case name that collides with no name in the base object. */
const freshName = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
    minLength: 1,
    maxLength: 8,
  })
  .map((chars) => `x${chars.join('')}`);

interface MutationCase {
  /** The serialized, mutated YAML document. */
  yamlText: string;
  /** The configuration key the mutation invalidated; must appear in the error message. */
  mutatedKey: string;
  /** Mutation kind, tracked only to prove the generator covers the whole space. */
  kind: string;
}

function mutationCase(kind: string, mutatedKey: string, config: ConfigObject): MutationCase {
  return { kind, mutatedKey, yamlText: yaml.dump(config) };
}

/**
 * The enumerated mutation space. Each arbitrary applies exactly one mutation to
 * a fresh copy of the valid base object.
 */
function configMutationArb(): fc.Arbitrary<MutationCase> {
  // 1. A required key is missing.
  const missingRequiredKey = fc.constantFrom(...REQUIRED_KEYS).map((key) => {
    const config = clone(baseConfig());
    delete config[key];
    return mutationCase('missing-required-key', key, config);
  });

  // 2. A scalar key holds a value of the wrong type (a mapping), or a list key
  //    holds a scalar. Note that the loader parses with yaml.FAILSAFE_SCHEMA, so
  //    numbers and booleans arrive as strings and are *not* type errors.
  const wrongScalarType = fc.oneof(
    fc.constantFrom(...TYPED_SCALAR_KEYS).map((key) => {
      const config = clone(baseConfig());
      config[key] = { unexpected: 'mapping' };
      return mutationCase('wrong-scalar-type', key, config);
    }),
    fc.constantFrom<'agents' | 'mcpServers'>('agents', 'mcpServers').map((key) => {
      const config = clone(baseConfig());
      config[key] = 'not-a-list';
      return mutationCase('wrong-scalar-type', key, config);
    })
  );

  // 3. A scalar key is replaced by a list.
  const scalarReplacedByList = fc.constantFrom(...TYPED_SCALAR_KEYS).map((key) => {
    const config = clone(baseConfig());
    config[key] = ['first', 'second'];
    return mutationCase('scalar-replaced-by-list', key, config);
  });

  // 4. An agent references an MCP server that is not defined.
  const danglingMcpReference = freshName.map((name) => {
    const config = clone(baseConfig());
    listOf(config, 'agents')[0]['mcpServers'] = [name];
    return mutationCase('dangling-mcp-reference', 'mcpServers', config);
  });

  // 5. An agent references a knowledge base that is not defined.
  const danglingKnowledgeBaseReference = freshName.map((name) => {
    const config = clone(baseConfig());
    listOf(config, 'agents')[0]['knowledgeBase'] = name;
    return mutationCase('dangling-knowledge-base-reference', 'knowledgeBases', config);
  });

  // 6. A name is duplicated within a list.
  const duplicateName = fc.constantFrom(...LIST_KEYS).map((key) => {
    const config = clone(baseConfig());
    const entries = listOf(config, key);
    entries.push({ name: entries[0]['name'] });
    return mutationCase('duplicate-name', key, config);
  });

  // 7. A sourceDir points at a path that does not exist.
  const nonExistentSourceDir = fc
    .tuple(fc.constantFrom(...LIST_KEYS), fc.nat())
    .map(([key, offset]) => {
      const config = clone(baseConfig());
      const entries = listOf(config, key);
      const target = entries[offset % entries.length];
      target['sourceDir'] = `${SOURCE_DIR_ROOT[key]}/${ABSENT_MARKER}/${target['name']}`;
      return mutationCase('non-existent-source-dir', 'sourceDir', config);
    });

  // 8. deploymentPrefix violates the documented format.
  const deploymentPrefixFormat = fc
    .constantFrom(
      'Test-Prefix', // uppercase
      'test_prefix', // underscore
      '-testprefix', // leading hyphen
      'testprefix-', // trailing hyphen
      'test prefix', // space
      'a'.repeat(21), // longer than 20 characters
      '9'.repeat(30) // longer than 20 characters, numeric
    )
    .map((prefix) => {
      const config = clone(baseConfig());
      config['deploymentPrefix'] = prefix;
      return mutationCase('deployment-prefix-format', 'deploymentPrefix', config);
    });

  // 9. An enum key holds a value outside its accepted set.
  const outOfSetEnumValue = fc.oneof(
    freshName
      .filter((v) => !(VALID_FRONTEND_MODES as readonly string[]).includes(v))
      .map((value) => {
        const config = clone(baseConfig());
        config['frontendMode'] = value;
        return mutationCase('out-of-set-enum-value', 'frontendMode', config);
      }),
    freshName
      .filter((v) => !(VALID_DEPLOYMENT_MODES as readonly string[]).includes(v))
      .map((value) => {
        const config = clone(baseConfig());
        config['deploymentMode'] = value;
        return mutationCase('out-of-set-enum-value', 'deploymentMode', config);
      })
  );

  return fc.oneof(
    missingRequiredKey,
    wrongScalarType,
    scalarReplacedByList,
    danglingMcpReference,
    danglingKnowledgeBaseReference,
    duplicateName,
    nonExistentSourceDir,
    deploymentPrefixFormat,
    outOfSetEnumValue
  );
}

const ALL_MUTATION_KINDS = [
  'missing-required-key',
  'wrong-scalar-type',
  'scalar-replaced-by-list',
  'dangling-mcp-reference',
  'dangling-knowledge-base-reference',
  'duplicate-name',
  'non-existent-source-dir',
  'deployment-prefix-format',
  'out-of-set-enum-value',
];

beforeEach(() => {
  jest.resetAllMocks();
});

describe('oss-release-readiness / Property 16: invalid configuration is rejected with an actionable error', () => {
  // Guards the mock trap: if the valid base object did not load cleanly, every
  // mutation below would be "rejected" for a reason unrelated to the mutation.
  test('the valid base object loads without error (mock sanity check)', () => {
    installMocks(yaml.dump(baseConfig()));

    const config = loadAcceleratorConfig(REPO_ROOT);

    expect(config.agents.map((a) => a.name)).toEqual(['customer-support', 'it-helpdesk']);
    expect(config.mcpServers.map((m) => m.name)).toEqual(['support-tools']);
    expect(config.knowledgeBases.map((k) => k.name)).toEqual(['support-docs']);
    expect(mockExistsSync).toHaveBeenCalled();
  });

  test('any single mutation of a valid configuration throws an error naming the mutated key', () => {
    const kindsSeen = new Set<string>();
    let runs = 0;

    fc.assert(
      fc.property(configMutationArb(), ({ yamlText, mutatedKey, kind }) => {
        runs += 1;
        kindsSeen.add(kind);
        installMocks(yamlText);

        let thrown: Error | undefined;
        try {
          loadAcceleratorConfig(REPO_ROOT);
        } catch (e) {
          thrown = e as Error;
        }

        // Thrown by the loader itself, i.e. before the stack instantiates any construct.
        expect(thrown).toBeDefined();
        expect(thrown!.message).toContain(mutatedKey);
      }),
      { numRuns: NUM_RUNS }
    );

    expect(runs).toBe(NUM_RUNS);
    // The property is only as strong as the generator's coverage of the space.
    expect([...kindsSeen].sort()).toEqual([...ALL_MUTATION_KINDS].sort());
  });
});

describe('oss-release-readiness / Property 17: every frontend mode is either supported and documented, or rejected', () => {
  test.each(VALID_FRONTEND_MODES)('accepts frontendMode: %s', (mode) => {
    const config = baseConfig();
    config['frontendMode'] = mode;
    // "public" additionally requires domainName — an internet-facing load
    // balancer must be able to terminate HTTPS.
    if (mode === 'public') {
      config['domainName'] = 'agent.example.com';
    }
    installMocks(yaml.dump(config));

    expect(loadAcceleratorConfig(REPO_ROOT).frontendMode).toBe(mode);
  });

  test('rejects any value outside the accepted set with an error naming that set', () => {
    let runs = 0;

    fc.assert(
      fc.property(
        fc.string().filter((v) => !(VALID_FRONTEND_MODES as readonly string[]).includes(v.trim())),
        (mode) => {
          runs += 1;
          const config = baseConfig();
          config['frontendMode'] = mode;
          installMocks(yaml.dump(config));

          expect(() => loadAcceleratorConfig(REPO_ROOT)).toThrow(
            /"frontendMode".*must be one of: none, internal, public, cloudfront/
          );
        }
      ),
      { numRuns: NUM_RUNS }
    );

    expect(runs).toBe(NUM_RUNS);
  });
});
