/**
 * McpToolsService unit tests — registerPromptsForScope (Task 17).
 *
 * What we test:
 *   - registerPromptsForScope calls server.registerPrompt once per skill that
 *     is both in the PROMPT_SKILL_HANDLES list AND has content in the registry.
 *   - The prompt callback returns a messages array with role:'user', type:'text',
 *     and non-empty text.
 *   - A skill whose content is null (missing file) is skipped silently — no throw.
 *
 * We do NOT spin up the full Nest DI graph. McpToolsService's constructor deps
 * (Navigate/Read/Blockchain/WriteToolsService) are mocked out entirely — this
 * test suite is only interested in the prompt-registration path.
 *
 * We stub getSkillContent() from the skill registry so the test never hits the
 * real filesystem and can inject the "missing skill" scenario cleanly.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as skillRegistry from '../../skills/skill-registry';
import { McpToolsService } from './mcp.tools';
import type { AuthSuccess } from './mcp-auth.helper';

// ---------------------------------------------------------------------------
// Auth fixture
// ---------------------------------------------------------------------------

const AUTH: AuthSuccess = {
  kind: 'oauth',
  user: { id: 'user-1', email: 'u@example.com' } as any,
  session: { id: 'sess-1', ownerUserId: 'user-1', organizationId: 'org-1' } as any,
  principal: {
    kind: 'mcp',
    userId: 'user-1',
    organizationId: 'org-1',
    sessionId: 'sess-1',
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a McpToolsService with all sub-services fully mocked. */
function buildService(): McpToolsService {
  const noopService = { registerAll: jest.fn() } as any;
  return new McpToolsService(noopService, noopService, noopService, noopService);
}

/**
 * Invoke a registered prompt callback by reaching into the SDK's internal
 * `_registeredPrompts` map, mirroring the tool harness in navigate-tools.spec.ts.
 */
async function callPrompt(
  server: McpServer,
  name: string,
): Promise<{ messages: { role: string; content: { type: string; text: string } }[] }> {
  const prompts = (server as any)._registeredPrompts as Record<
    string,
    { callback: (...args: unknown[]) => unknown }
  >;
  const prompt = prompts[name];
  if (!prompt) throw new Error(`Prompt not registered: ${name}`);
  return prompt.callback({}) as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('McpToolsService.registerPromptsForScope', () => {
  const BASE_URL = 'https://app.example.com';

  // Known skill handles that registerPromptsForScope must attempt to register.
  const EXPECTED_HANDLES = [
    'daubert-overview',
    'graph-mutations',
    'etherscan-apis',
    'tronscan-apis',
    'productions',
    'declarations',
    'redlining',
  ];

  describe('when all skill files are present', () => {
    let getSkillContent: jest.SpyInstance;
    let server: McpServer;

    beforeEach(() => {
      // Stub getSkillContent to return non-empty content for every handle.
      getSkillContent = jest
        .spyOn(skillRegistry, 'getSkillContent')
        .mockImplementation((name: string) => `# ${name} content`);

      server = new McpServer({ name: 'test-mcp', version: '0.0.1' });
      const service = buildService();
      service.registerPromptsForScope(server, AUTH, BASE_URL);
    });

    afterEach(() => {
      getSkillContent.mockRestore();
    });

    it('registers exactly one prompt per expected skill handle', () => {
      const registered = Object.keys((server as any)._registeredPrompts);
      for (const handle of EXPECTED_HANDLES) {
        expect(registered).toContain(handle);
      }
      // No unexpected extras beyond the known list.
      expect(registered.length).toBe(EXPECTED_HANDLES.length);
    });

    it('each prompt callback returns a user-role message with non-empty text content', async () => {
      for (const handle of EXPECTED_HANDLES) {
        const result = await callPrompt(server, handle);
        expect(result.messages).toHaveLength(1);
        const msg = result.messages[0];
        expect(msg.role).toBe('user');
        expect(msg.content.type).toBe('text');
        expect(msg.content.text.length).toBeGreaterThan(0);
      }
    });

    it('passes the skill content into the prompt text', async () => {
      const result = await callPrompt(server, 'daubert-overview');
      expect(result.messages[0].content.text).toContain('daubert-overview content');
    });
  });

  describe('when one skill file is missing (getSkillContent returns null)', () => {
    it('skips the missing skill without throwing', () => {
      const getSkillContent = jest
        .spyOn(skillRegistry, 'getSkillContent')
        .mockImplementation((name: string) => {
          if (name === 'daubert-overview') return null; // simulate missing file
          return `# ${name} content`;
        });

      const server = new McpServer({ name: 'test-mcp', version: '0.0.1' });
      const service = buildService();

      // Must not throw.
      expect(() =>
        service.registerPromptsForScope(server, AUTH, BASE_URL),
      ).not.toThrow();

      const registered = Object.keys((server as any)._registeredPrompts);
      // daubert-overview skipped; the others still registered.
      expect(registered).not.toContain('daubert-overview');
      expect(registered.length).toBe(EXPECTED_HANDLES.length - 1);

      getSkillContent.mockRestore();
    });
  });

  describe('when ALL skill files are missing', () => {
    it('registers zero prompts without throwing', () => {
      const getSkillContent = jest
        .spyOn(skillRegistry, 'getSkillContent')
        .mockReturnValue(null);

      const server = new McpServer({ name: 'test-mcp', version: '0.0.1' });
      const service = buildService();

      expect(() =>
        service.registerPromptsForScope(server, AUTH, BASE_URL),
      ).not.toThrow();

      const registered = Object.keys((server as any)._registeredPrompts);
      expect(registered.length).toBe(0);

      getSkillContent.mockRestore();
    });
  });
});
