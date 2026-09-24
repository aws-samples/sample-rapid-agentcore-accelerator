// ============================================================================
// SAMPLE CODE - NOT FOR PRODUCTION USE
// This is sample code intended for demonstration and prototyping purposes only.
// It should be reviewed, tested, and validated before any production deployment.
// ============================================================================

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { loadAcceleratorConfig } from '../lib/config';

// Mock the fs module to control config file content in tests
jest.mock('fs');
const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;

/**
 * The valid base configuration every fixture starts from.
 *
 * `agents` and `mcpServers` are required keys, so they belong to the base object:
 * a fixture that omits either one is testing the required-key error path, not the
 * happy path.
 */
function baseConfigObject(): Record<string, unknown> {
  return {
    region: 'us-west-2',
    deploymentPrefix: 'testprefix',
    modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
    deploymentMode: 'local',
    frontendMode: 'none',
    agents: [{ name: 'customer-support' }],
    mcpServers: [{ name: 'support-tools' }],
  };
}

/**
 * Serializes the base configuration with `overrides` applied and `omitKeys` removed.
 *
 * `omitKeys` exists because setting a key to `undefined` is not the same as omitting
 * it: js-yaml would either drop or reject the value, and the loader distinguishes
 * "key absent" from "key present with an invalid value".
 */
function makeConfigYaml(
  overrides: Record<string, unknown> = {},
  omitKeys: string[] = []
): string {
  const base: Record<string, unknown> = { ...baseConfigObject(), ...overrides };
  for (const key of omitKeys) {
    delete base[key];
  }
  return yaml.dump(base);
}

/**
 * `jest.mock('fs')` makes every fs export a mock, so `existsSync` returns `undefined`
 * — which is falsy, and would fail the loader's sourceDir existence checks for reasons
 * unrelated to what any of these tests assert. Every fixture therefore reports its
 * source directories as present.
 */
function mockFsWithConfig(configYaml: string): void {
  mockReadFileSync.mockReturnValue(configYaml);
  mockExistsSync.mockReturnValue(true);
}

describe('loadAcceleratorConfig - cloudfront mode', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('accepts frontendMode: cloudfront without error', () => {
    mockFsWithConfig(makeConfigYaml({ frontendMode: 'cloudfront' }));

    const config = loadAcceleratorConfig('/fake/repo');

    expect(config.frontendMode).toBe('cloudfront');
  });

  test('cloudfront mode with no domainName returns domainName: null and hostedZoneName: null', () => {
    mockFsWithConfig(makeConfigYaml({ frontendMode: 'cloudfront' }));

    const config = loadAcceleratorConfig('/fake/repo');

    expect(config.domainName).toBeNull();
    expect(config.hostedZoneName).toBeNull();
  });

  test('cloudfront mode with domainName derives hostedZoneName from last two labels', () => {
    mockFsWithConfig(
      makeConfigYaml({ frontendMode: 'cloudfront', domainName: 'agent.example.com' })
    );

    const config = loadAcceleratorConfig('/fake/repo');

    expect(config.domainName).toBe('agent.example.com');
    expect(config.hostedZoneName).toBe('example.com');
  });

  test('explicit hostedZoneName overrides derived value', () => {
    mockFsWithConfig(
      makeConfigYaml({
        frontendMode: 'public',
        domainName: 'agent.eu.example.com',
        hostedZoneName: 'eu.example.com',
      })
    );

    const config = loadAcceleratorConfig('/fake/repo');

    expect(config.domainName).toBe('agent.eu.example.com');
    expect(config.hostedZoneName).toBe('eu.example.com');
  });

  test('invalid frontendMode throws error listing all valid options including cloudfront', () => {
    mockFsWithConfig(makeConfigYaml({ frontendMode: 'invalid-mode' }));

    expect(() => loadAcceleratorConfig('/fake/repo')).toThrow(
      /must be one of: none, internal, public, cloudfront/
    );
  });
});

describe('loadAcceleratorConfig - required keys', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('the base fixture loads, so the required-key cases below fail for the right reason', () => {
    mockFsWithConfig(makeConfigYaml());

    const config = loadAcceleratorConfig('/fake/repo');

    expect(config.agents).toEqual([
      {
        name: 'customer-support',
        sourceDir: 'agent/customer-support/src',
        modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      },
    ]);
    expect(config.mcpServers).toEqual([
      { name: 'support-tools', sourceDir: 'mcp/support-tools/src' },
    ]);
  });

  test('omitting agents throws an error naming the agents key', () => {
    mockFsWithConfig(makeConfigYaml({}, ['agents']));

    expect(() => loadAcceleratorConfig('/fake/repo')).toThrow(/"agents" is required/);
  });

  test('omitting agents names the agent/{name}/src resolution rule rather than falling back', () => {
    mockFsWithConfig(makeConfigYaml({}, ['agents']));

    expect(() => loadAcceleratorConfig('/fake/repo')).toThrow(/agent\/\{name\}\/src/);
  });

  test('omitting mcpServers throws an error naming the mcpServers key', () => {
    mockFsWithConfig(makeConfigYaml({}, ['mcpServers']));

    expect(() => loadAcceleratorConfig('/fake/repo')).toThrow(/"mcpServers" is required/);
  });

  test('omitting mcpServers names the mcp/{name}/src resolution rule rather than falling back', () => {
    mockFsWithConfig(makeConfigYaml({}, ['mcpServers']));

    expect(() => loadAcceleratorConfig('/fake/repo')).toThrow(/mcp\/\{name\}\/src/);
  });
});
