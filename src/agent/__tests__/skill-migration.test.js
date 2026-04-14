import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

describe('agent-design-guide skill migration', () => {
  it('is available in both .codex and .cursor skill directories', () => {
    const targets = [
      '.codex/skills/agent-design-guide/SKILL.md',
      '.cursor/skills/agent-design-guide/SKILL.md',
      '.codex/skills/agent-design-guide/references/pattern-catalog.md',
      '.cursor/skills/agent-design-guide/references/pattern-catalog.md',
    ];

    for (const file of targets) {
      expect(fs.existsSync(path.join(root, file)), `${file} should exist`).toBe(true);
    }
  });

  it('keeps the core trigger description consistent across copied skills', () => {
    const codexSkill = read('.codex/skills/agent-design-guide/SKILL.md');
    const cursorSkill = read('.cursor/skills/agent-design-guide/SKILL.md');

    expect(codexSkill).toContain('name: agent-design-guide');
    expect(cursorSkill).toContain('Agent Design Guide');
    expect(codexSkill).toContain('prompt chaining');
    expect(cursorSkill).toContain('提示词链');
  });
});
