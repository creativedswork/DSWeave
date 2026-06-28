/**
 * Skill 加载器：扫描三级作用域目录，解析每个 skill 的 SKILL.md frontmatter，
 * 合并成一份「已发现 skill」清单（同 id 高优先级覆盖）。
 *
 * 一个 skill = 一个目录，内含 SKILL.md（frontmatter: name/description/…，正文: 怎么做）。
 * 目录名即 skill id（slug）。其余文件（skeleton/snippets/assets）按需被 agent 原生读取。
 *
 * 三级作用域（低→高优先级，仿 Claude/Gemini）：
 *   内置（packages/host/skills/） < 用户级（~/.dsweave/skills/） < 项目级（<workingDir>/.dsweave/skills/）
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type SkillScope = 'builtin' | 'user' | 'project';

/** 已发现的 skill 元数据（catalog 用，正文不入内存）。 */
export interface DiscoveredSkill {
  /** 目录名（slug），全局唯一标识。 */
  id: string;
  /** frontmatter.name，缺省回退到 id。 */
  name: string;
  /** frontmatter.description（LLM 据此自主触发的关键字段）。 */
  description: string;
  /** frontmatter.outputTypes（与 output-types 对齐，可空）。 */
  outputTypes: string[];
  /** 命中的最高优先级作用域。 */
  scope: SkillScope;
  /** 该 skill 目录的绝对路径（物化时据此整目录拷贝）。 */
  dir: string;
  /** 安装来源记录（可空：内置/手动放置无来源）。 */
  source?: SkillSourceRef;
}

/** 安装来源（供「检查更新」与展示）。 */
export interface SkillSourceRef {
  kind: 'folder' | 'zip' | 'git' | 'registry' | 'promote';
  /** git URL / registry id / 原始文件夹名等。 */
  ref?: string;
  /** git ref（分支/tag/commit）。 */
  gitRef?: string;
  /** git 子目录。 */
  subdir?: string;
  installedAt?: string;
}

interface Frontmatter {
  name?: string;
  description?: string;
  outputTypes?: string[];
}

/** 解析 SKILL.md 顶部 `---` 包裹的 YAML 子集（key: value 单行）。 */
export function parseFrontmatter(md: string): Frontmatter {
  const m = md.match(/^\uFEFF?---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const body = m[1] ?? '';
  const fm: Frontmatter = {};
  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1]!.toLowerCase();
    let value = kv[2]!.trim();
    // 去掉成对引号
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === 'name') fm.name = value;
    else if (key === 'description') fm.description = value;
    else if (key === 'outputtypes' || key === 'output_types') {
      fm.outputTypes = parseList(value);
    }
  }
  return fm;
}

function parseList(value: string): string[] {
  const inner = value.replace(/^\[/, '').replace(/\]$/, '');
  return inner
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

/** 读取单个 skill 目录（须含 SKILL.md），失败返回 undefined。 */
export function readSkillDir(dir: string, scope: SkillScope): DiscoveredSkill | undefined {
  const skillMd = join(dir, 'SKILL.md');
  if (!existsSync(skillMd)) return undefined;
  let fm: Frontmatter = {};
  try {
    fm = parseFrontmatter(readFileSync(skillMd, 'utf-8'));
  } catch {
    return undefined;
  }
  const id = dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;
  let source: SkillSourceRef | undefined;
  const metaPath = join(dir, '.dsweave-source.json');
  if (existsSync(metaPath)) {
    try {
      source = JSON.parse(readFileSync(metaPath, 'utf-8')) as SkillSourceRef;
    } catch {
      source = undefined;
    }
  }
  return {
    id,
    name: fm.name?.trim() || id,
    description: fm.description?.trim() || '',
    outputTypes: fm.outputTypes ?? [],
    scope,
    dir,
    source,
  };
}

/** 扫描一个作用域根目录下的所有 skill 子目录。 */
export function scanScope(root: string, scope: SkillScope): DiscoveredSkill[] {
  if (!existsSync(root)) return [];
  const out: DiscoveredSkill[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const dir = join(root, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const skill = readSkillDir(dir, scope);
    if (skill) out.push(skill);
  }
  return out;
}

/** 三级作用域根目录。 */
export interface SkillRoots {
  builtin: string;
  user: string;
  project: string;
}

/** 扫描三级作用域并按 id 合并（项目级 > 用户级 > 内置）。 */
export function discoverSkills(roots: SkillRoots): DiscoveredSkill[] {
  const merged = new Map<string, DiscoveredSkill>();
  // 低优先级先写，高优先级覆盖。
  for (const s of scanScope(roots.builtin, 'builtin')) merged.set(s.id, s);
  for (const s of scanScope(roots.user, 'user')) merged.set(s.id, s);
  for (const s of scanScope(roots.project, 'project')) merged.set(s.id, s);
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
}
