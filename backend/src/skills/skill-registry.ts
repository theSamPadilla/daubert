import * as fs from 'fs';
import * as path from 'path';

export interface SkillMeta {
  name: string;
  description: string;
  filePath: string;
}

const SKILLS_DIR = path.join(__dirname);

/**
 * Parse `name` and `description` from YAML frontmatter between `---` fences.
 * Intentionally minimal — avoids a full YAML parser dependency for two fields.
 */
function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const yaml = match[1];
  const name = yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = yaml.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  return { name, description };
}

/**
 * Scan the skills directory for `.md` files, parse frontmatter, and build the
 * registry. Runs once at import time — adding a new `.md` file with valid
 * frontmatter is all that's needed to register a new skill.
 */
function loadRegistry(): SkillMeta[] {
  const files = fs.readdirSync(SKILLS_DIR).filter((f) => f.endsWith('.md')).sort();
  const skills: SkillMeta[] = [];

  for (const file of files) {
    const filePath = path.join(SKILLS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const { name, description } = parseFrontmatter(content);
    if (!name || !description) {
      throw new Error(
        `Skill file "${file}" is missing required frontmatter (name, description).`,
      );
    }
    skills.push({ name, description, filePath });
  }

  return skills;
}

/** All registered skills, sorted alphabetically by filename. */
export const SKILL_REGISTRY: readonly SkillMeta[] = loadRegistry();

/** Skill name strings, used as the enum for the get_skill tool. */
export const SKILL_NAMES: readonly string[] = SKILL_REGISTRY.map((s) => s.name);

/**
 * Load a skill's markdown content (frontmatter stripped).
 * Returns `null` for unknown skill names.
 */
export function getSkillContent(name: string): string | null {
  const skill = SKILL_REGISTRY.find((s) => s.name === name);
  if (!skill) return null;
  const raw = fs.readFileSync(skill.filePath, 'utf-8');
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, '');
}
