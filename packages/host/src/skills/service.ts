/**
 * SkillsService：Skills 库管理 + 激活集解析 + 物化（Host 侧唯一控制点）。
 *
 * - 发现：扫三级作用域（内置/用户级/项目级），见 loader.ts。
 * - 激活：全局激活集存用户级偏好文件；可被 per-flow 覆盖（重度用户精确控制）。
 *   激活 = 该 skill 进入「物化清单」→ 运行时拷进 Agent cwd → 编码 agent 原生发现 + 渐进披露。
 * - 安装：folder（文件载荷）/ git（clone）/ promote（产物提升）；zip/registry 后置。
 * - 物化：把激活集里每个 skill 目录整体拷进 `cwd/<skillsDir>/<id>/`（由 acp-agent 调用）。
 *
 * 设计要点：激活 ≠ 把正文塞进 prompt。catalog 只含 frontmatter，正文走 cwd 按需读（防 token 膨胀）。
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, homedir } from 'node:os';
import type {
  InstallSkillParams,
  ListSkillsResult,
  PromptSkill,
  RemoveSkillParams,
  SetActiveSkillParams,
  SkillInfo,
  SkillScope,
  SkillSourceRef,
} from '@dsweave/protocol';
import { spawnCrossSync } from '../util/spawn.js';
import { discoverSkills, type DiscoveredSkill, type SkillRoots } from './loader.js';

export interface SkillsServiceOptions {
  /** 项目级作用域根（默认 <workingDir>/.dsweave/skills）。 */
  workingDir?: string;
  /** 内置作用域根（默认随包 packages/host/skills）。 */
  builtinDir?: string;
  /** 用户级作用域根（默认 ~/.dsweave/skills）。 */
  userDir?: string;
  /** 全局激活偏好文件（默认 <userDir>/../skills-active.json）。 */
  activeFile?: string;
}

interface ActivePrefs {
  /** 全局激活集（id 列表）。 */
  active: string[];
  /** 是否已初始化（避免每次都把内置全置为激活）。 */
  initialized?: boolean;
}

/** 默认内置 skills 目录：编译产物在 dist/skills/service.js，源 skills 在 ../../skills。 */
function defaultBuiltinDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/skills/service.js → 仓库内 packages/host/skills
  return join(here, '..', '..', 'skills');
}

function sanitizeId(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '') || 'skill'
  );
}

export class SkillsService {
  private readonly roots: SkillRoots;
  private readonly activeFile: string;
  /** per-flow 覆盖：flowId → (id → active)。 */
  private readonly flowOverrides = new Map<string, Map<string, boolean>>();

  constructor(options: SkillsServiceOptions = {}) {
    const workingDir = options.workingDir ?? process.cwd();
    const userBase = join(homedir(), '.dsweave');
    this.roots = {
      builtin: options.builtinDir ?? defaultBuiltinDir(),
      user: options.userDir ?? join(userBase, 'skills'),
      project: join(workingDir, '.dsweave', 'skills'),
    };
    this.activeFile = options.activeFile ?? join(userBase, 'skills-active.json');
  }

  /** 当前已发现的 skill（合并三级作用域）。 */
  discover(): DiscoveredSkill[] {
    return discoverSkills(this.roots);
  }

  // ---------- 激活集 ----------

  private loadPrefs(): ActivePrefs {
    if (existsSync(this.activeFile)) {
      try {
        const p = JSON.parse(readFileSync(this.activeFile, 'utf-8')) as ActivePrefs;
        if (Array.isArray(p.active)) return { active: p.active, initialized: p.initialized };
      } catch {
        // 损坏则重建
      }
    }
    // 首次：默认把所有内置 skill 置为激活（开箱即用）。
    const builtinIds = this.discover()
      .filter((s) => s.scope === 'builtin')
      .map((s) => s.id);
    const prefs: ActivePrefs = { active: builtinIds, initialized: true };
    this.savePrefs(prefs);
    return prefs;
  }

  private savePrefs(prefs: ActivePrefs): void {
    try {
      mkdirSync(dirname(this.activeFile), { recursive: true });
      writeFileSync(this.activeFile, JSON.stringify(prefs, null, 2), 'utf-8');
    } catch {
      // 偏好写入失败不致命（本次运行仍按内存激活集）
    }
  }

  private globalActiveSet(): Set<string> {
    return new Set(this.loadPrefs().active);
  }

  /** 解析某 flow 的有效激活集（全局 ∘ flow 覆盖）。 */
  private effectiveActiveSet(flowId?: string): Set<string> {
    const set = this.globalActiveSet();
    if (flowId) {
      const ov = this.flowOverrides.get(flowId);
      if (ov) {
        for (const [id, active] of ov) {
          if (active) set.add(id);
          else set.delete(id);
        }
      }
    }
    return set;
  }

  // ---------- 对外 API（bridge 调用） ----------

  list(flowId?: string): ListSkillsResult {
    const active = this.effectiveActiveSet(flowId);
    const skills: SkillInfo[] = this.discover().map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      outputTypes: s.outputTypes,
      scope: s.scope,
      source: s.source,
      active: active.has(s.id),
      builtin: s.scope === 'builtin',
    }));
    return { skills, activeCount: skills.filter((s) => s.active).length };
  }

  setActive(params: SetActiveSkillParams): { activeCount: number } {
    const scope = params.scope ?? 'global';
    if (scope === 'flow') {
      if (!params.flowId) throw new Error('flow 作用域需提供 flowId');
      const ov = this.flowOverrides.get(params.flowId) ?? new Map<string, boolean>();
      ov.set(params.id, params.active);
      this.flowOverrides.set(params.flowId, ov);
    } else {
      const prefs = this.loadPrefs();
      const set = new Set(prefs.active);
      if (params.active) set.add(params.id);
      else set.delete(params.id);
      this.savePrefs({ active: [...set], initialized: true });
    }
    return { activeCount: this.effectiveActiveSet(params.flowId).size };
  }

  remove(params: RemoveSkillParams): { removed: boolean } {
    const skill = this.discover().find((s) => s.id === params.id);
    if (!skill) return { removed: false };
    if (skill.scope === 'builtin') throw new Error('内置 skill 不可删除');
    rmSync(skill.dir, { recursive: true, force: true });
    // 同步从全局激活集移除
    const prefs = this.loadPrefs();
    const set = new Set(prefs.active);
    if (set.delete(params.id)) this.savePrefs({ active: [...set], initialized: true });
    return { removed: true };
  }

  install(params: InstallSkillParams): { skill: SkillInfo } {
    const scope: Exclude<SkillScope, 'builtin'> = params.scope ?? 'project';
    const scopeRoot = scope === 'user' ? this.roots.user : this.roots.project;
    let id: string;
    let source: SkillSourceRef;

    switch (params.source) {
      case 'folder':
        ({ id } = this.installFromFiles(scopeRoot, params));
        source = { kind: 'folder', ref: params.id, installedAt: new Date().toISOString() };
        break;
      case 'git':
        ({ id } = this.installFromGit(scopeRoot, params));
        source = {
          kind: 'git',
          ref: params.repo,
          gitRef: params.gitRef,
          subdir: params.subdir,
          installedAt: new Date().toISOString(),
        };
        break;
      case 'promote':
        ({ id } = this.installFromPromote(scopeRoot, params));
        source = { kind: 'promote', ref: params.id ?? params.name, installedAt: new Date().toISOString() };
        break;
      case 'zip':
      case 'registry':
        throw new Error(`暂未支持的安装来源：${params.source}（后置）`);
      default:
        throw new Error(`未知安装来源：${String(params.source)}`);
    }

    const dir = join(scopeRoot, id);
    // 记录来源，供「检查更新」与展示
    try {
      writeFileSync(join(dir, '.dsweave-source.json'), JSON.stringify(source, null, 2), 'utf-8');
    } catch {
      // 忽略
    }

    const info = this.list().skills.find((s) => s.id === id);
    if (!info) throw new Error(`安装后未发现 skill：${id}（缺少 SKILL.md？）`);
    return { skill: info };
  }

  /** 解析激活集（不物化），供 bridge 注入 prompt（acp-agent 自行物化）。 */
  resolveActive(flowId?: string): PromptSkill[] {
    const active = this.effectiveActiveSet(flowId);
    return this.discover()
      .filter((s) => active.has(s.id))
      .map((s) => ({ id: s.id, name: s.name, description: s.description, dir: s.dir }));
  }

  // ---------- 安装实现 ----------

  private installFromFiles(
    scopeRoot: string,
    params: InstallSkillParams,
  ): { id: string } {
    const files = (params.files ?? [])
      .map((f) => ({ path: normalizeRel(f.path), content: f.content }))
      .filter((f) => f.path);
    if (files.length === 0) throw new Error('folder 安装需要文件载荷');

    // 若所有文件共享单一顶层目录（webkitdirectory 选目录时常见），剥离之并用作 id 候选。
    const wrapper = singleTopDir(files.map((f) => f.path));
    const stripped = files.map((f) => ({
      path: wrapper ? f.path.slice(wrapper.length + 1) : f.path,
      content: f.content,
    }));
    if (!stripped.some((f) => /^SKILL\.md$/i.test(f.path))) {
      throw new Error('缺少 SKILL.md：文件夹根必须包含 skill 清单');
    }

    const id = sanitizeId(params.id ?? wrapper ?? 'skill');
    const dir = join(scopeRoot, id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const f of stripped) {
      if (!f.path) continue;
      const abs = join(dir, f.path);
      if (!abs.startsWith(dir)) throw new Error(`非法路径：${f.path}`);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, Buffer.from(f.content, 'base64'));
    }
    return { id };
  }

  private installFromGit(scopeRoot: string, params: InstallSkillParams): { id: string } {
    if (!params.repo) throw new Error('git 安装需要 repo URL');
    const tmp = mkdtempSync(join(tmpdir(), 'dsweave-skill-git-'));
    try {
      const args = ['clone', '--depth', '1'];
      if (params.gitRef) args.push('--branch', params.gitRef);
      args.push(params.repo, tmp);
      const res = spawnCrossSync('git', args, { stdio: 'inherit' });
      if (res.error) throw new Error(`git clone 失败：${res.error.message}`);
      if (res.status !== 0) throw new Error(`git clone 失败（code=${res.status}）`);
      const srcDir = params.subdir ? join(tmp, params.subdir) : tmp;
      if (!existsSync(join(srcDir, 'SKILL.md'))) {
        throw new Error('clone 结果缺少 SKILL.md（检查 subdir）');
      }
      const id = sanitizeId(params.id ?? (params.subdir?.split('/').pop() ?? repoName(params.repo)));
      const dir = join(scopeRoot, id);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dirname(dir), { recursive: true });
      cpSync(srcDir, dir, { recursive: true });
      rmSync(join(dir, '.git'), { recursive: true, force: true });
      return { id };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  private installFromPromote(scopeRoot: string, params: InstallSkillParams): { id: string } {
    if (!params.html) throw new Error('promote 安装需要产物 html');
    const id = sanitizeId(params.id ?? params.name ?? 'promoted-skill');
    const name = params.name ?? id;
    const description =
      params.description ?? `从产物提升的 skill：复用「${name}」这次产出的排版/结构作为参考骨架。`;
    const dir = join(scopeRoot, id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const md = `---\nname: ${name}\ndescription: ${description.replace(/\n/g, ' ')}\noutputTypes: [scene.html]\n---\n# ${name}\n\n复用本 skill 时，参考 \`skeleton.html\` 的整体结构与排版，再按当前任务的上下文填充真实内容。\n\n- 保持自包含单文件（内联 CSS/JS，无外链）。\n- 用 asset://{nodeId} 引用模型/图片，由 Host 内联。\n`;
    writeFileSync(join(dir, 'SKILL.md'), md, 'utf-8');
    writeFileSync(join(dir, 'skeleton.html'), params.html, 'utf-8');
    return { id };
  }
}

/** 若所有文件共享单一顶层目录（且非裸文件），返回该目录名；否则 undefined。 */
function singleTopDir(paths: string[]): string | undefined {
  const tops = new Set<string>();
  for (const p of paths) {
    if (!p) continue;
    const parts = p.split('/');
    // 顶层是文件（无 /）说明没有包裹目录
    if (parts.length < 2) return undefined;
    tops.add(parts[0]!);
  }
  if (tops.size !== 1) return undefined;
  const only = [...tops][0]!;
  return only && only.toLowerCase() !== 'skill.md' ? only : undefined;
}

/** 规整相对路径：去掉前导 ./、统一分隔符；若有单一顶层包裹目录则剥离。 */
function normalizeRel(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\.\.(\/|$)/g, '');
}

function repoName(repo: string): string {
  return repo.replace(/\.git$/, '').split(/[\\/]/).pop() ?? 'skill';
}
