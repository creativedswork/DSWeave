import { useEffect, useRef, useState } from 'react';
import type { SkillInfo, SkillScope } from '@dsweave/protocol';
import { useDSWeaveStore } from '../store/useDSWeaveStore';

const SCOPE_BADGE: Record<SkillScope, { label: string; cls: string }> = {
  builtin: { label: '内置', cls: 'bg-neutral-700 text-neutral-300' },
  user: { label: '用户级', cls: 'bg-sky-900/50 text-sky-300' },
  project: { label: '项目级', cls: 'bg-emerald-900/40 text-emerald-300' },
};

const SOURCE_BADGE: Record<string, string> = {
  git: 'git',
  zip: 'zip',
  folder: '文件夹',
  promote: '提升',
  registry: '精选',
};

/** 读取 File → base64（去掉 data: 前缀）。 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.onerror = () => reject(r.error ?? new Error('读取失败'));
    r.readAsDataURL(file);
  });
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`relative ml-auto h-[19px] w-[34px] shrink-0 rounded-full transition-colors ${
        on ? 'bg-emerald-500' : 'bg-neutral-600'
      }`}
    >
      <span
        className={`absolute top-0.5 h-[15px] w-[15px] rounded-full bg-white transition-all ${
          on ? 'left-[17px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}

function SkillCard({ skill }: { skill: SkillInfo }) {
  const toggleSkill = useDSWeaveStore((s) => s.toggleSkill);
  const removeSkillById = useDSWeaveStore((s) => s.removeSkillById);
  const badge = SCOPE_BADGE[skill.scope];
  const srcLabel = skill.source ? SOURCE_BADGE[skill.source.kind] : undefined;
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
      <div className="flex items-center gap-2">
        <span className="truncate text-[13px] font-semibold text-neutral-100">{skill.name}</span>
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${badge.cls}`}>
          {badge.label}
        </span>
        <Toggle on={skill.active} onClick={() => void toggleSkill(skill.id, !skill.active)} />
      </div>
      <p className="mt-1.5 line-clamp-3 text-[11px] leading-relaxed text-neutral-500">
        {skill.description || '（无描述）'}
      </p>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-neutral-600">
        <span className="font-mono">{skill.id}</span>
        {srcLabel && (
          <>
            <span>·</span>
            <span>{srcLabel}</span>
          </>
        )}
        {skill.source?.ref && (
          <>
            <span>·</span>
            <span className="max-w-[140px] truncate" title={skill.source.ref}>
              {skill.source.ref}
            </span>
          </>
        )}
        {!skill.builtin && (
          <button
            type="button"
            onClick={() => {
              if (confirm(`删除 skill「${skill.name}」？`)) void removeSkillById(skill.id);
            }}
            className="ml-auto text-rose-400/80 hover:text-rose-300"
          >
            删除
          </button>
        )}
      </div>
    </div>
  );
}

function GitInstallModal({ onClose }: { onClose: () => void }) {
  const installSkill = useDSWeaveStore((s) => s.installSkill);
  const [repo, setRepo] = useState('');
  const [gitRef, setGitRef] = useState('');
  const [subdir, setSubdir] = useState('');
  const [scope, setScope] = useState<'project' | 'user'>('project');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!repo.trim()) {
      setErr('请填写 Git URL');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await installSkill({
        source: 'git',
        scope,
        repo: repo.trim(),
        gitRef: gitRef.trim() || undefined,
        subdir: subdir.trim() || undefined,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const field =
    'w-full rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-2 text-xs text-neutral-100 outline-none focus:border-violet-500';
  const lbl = 'mb-1 block text-[10px] uppercase tracking-wide text-neutral-500';

  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="w-[min(520px,92%)] overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-neutral-800 px-5 py-4">
          <h3 className="text-sm font-semibold text-neutral-100">从 Git 安装 Skill · 信任确认</h3>
          <p className="mt-1 text-[11px] text-neutral-500">
            把 skill 当依赖：安装前确认来源可信；脚本仅在 Agent 主动调用且经审批后才运行。
          </p>
        </div>
        <div className="flex flex-col gap-3.5 px-5 py-4">
          <div>
            <label className={lbl}>Git URL</label>
            <input
              className={field}
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="https://github.com/org/skills.git"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className={lbl}>分支 / Tag（可选）</label>
              <input className={field} value={gitRef} onChange={(e) => setGitRef(e.target.value)} placeholder="main" />
            </div>
            <div className="flex-1">
              <label className={lbl}>子目录（可选）</label>
              <input className={field} value={subdir} onChange={(e) => setSubdir(e.target.value)} placeholder="skills/my-skill" />
            </div>
          </div>
          <div>
            <label className={lbl}>安装作用域</label>
            <div className="flex gap-2">
              {(['project', 'user'] as const).map((sc) => (
                <button
                  key={sc}
                  type="button"
                  onClick={() => setScope(sc)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-left text-[11px] ${
                    scope === sc
                      ? 'border-violet-500/60 bg-violet-500/10 text-violet-200'
                      : 'border-neutral-700 text-neutral-400'
                  }`}
                >
                  {sc === 'project' ? '项目级' : '用户级'}
                  <small className="mt-0.5 block text-[10px] text-neutral-600">
                    {sc === 'project' ? '.dsweave/skills · 随仓库' : '~/.dsweave/skills · 跨项目'}
                  </small>
                </button>
              ))}
            </div>
          </div>
          {err && <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">{err}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-neutral-800 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800">
            取消
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {busy ? '安装中…' : '信任并安装'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SkillsDrawer() {
  const open = useDSWeaveStore((s) => s.skillsOpen);
  const close = useDSWeaveStore((s) => s.closeSkills);
  const skills = useDSWeaveStore((s) => s.skills);
  const loading = useDSWeaveStore((s) => s.skillsLoading);
  const error = useDSWeaveStore((s) => s.skillsError);
  const scope = useDSWeaveStore((s) => s.skillScope);
  const setScope = useDSWeaveStore((s) => s.setSkillScope);
  const installSkill = useDSWeaveStore((s) => s.installSkill);

  const [menuOpen, setMenuOpen] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);
  const dirInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setMenuOpen(false);
      setGitOpen(false);
    }
  }, [open]);

  const handleFolder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    e.target.value = '';
    setMenuOpen(false);
    if (!list || list.length === 0) return;
    const files = await Promise.all(
      [...list].map(async (f) => ({
        path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
        content: await fileToBase64(f),
      })),
    );
    try {
      await installSkill({ source: 'folder', scope: 'project', files });
    } catch (err) {
      alert(`安装失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="absolute inset-0 z-30 bg-black/50 backdrop-blur-[1px]" onClick={close} />
      <aside className="absolute right-0 top-0 z-40 flex h-full w-[384px] flex-col border-l border-neutral-800 bg-neutral-950/95 shadow-[-20px_0_50px_#000a] backdrop-blur">
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3.5">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
              <span className="text-violet-300">✦</span> Skills 库
            </h2>
            <p className="mt-0.5 text-[10px] text-neutral-600">安装 + 激活的唯一控制点</p>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            ✕
          </button>
        </div>

        <div className="relative flex items-center gap-2 border-b border-neutral-800 px-4 py-3">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-md border border-violet-500/50 bg-violet-500/10 px-2.5 py-1.5 text-xs text-violet-200 hover:bg-violet-500/20"
          >
            + 添加 ▾
          </button>
          <label className="ml-auto flex items-center gap-1.5 text-[11px] text-neutral-400">
            激活范围
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as 'global' | 'flow')}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-200 outline-none focus:border-violet-500"
            >
              <option value="global">全局</option>
              <option value="flow">当前 flow</option>
            </select>
          </label>
          {menuOpen && (
            <div className="absolute left-4 top-[46px] z-50 w-56 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl">
              <button
                type="button"
                onClick={() => dirInputRef.current?.click()}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs text-neutral-200 hover:bg-neutral-800"
              >
                <span className="w-4 text-center opacity-80">📁</span>导入本地文件夹
                <span className="ml-auto text-[10px] text-neutral-600">最常用</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setGitOpen(true);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs text-neutral-200 hover:bg-neutral-800"
              >
                <span className="w-4 text-center opacity-80">🔗</span>Git URL…
                <span className="ml-auto text-[10px] text-neutral-600">可更新</span>
              </button>
              <button
                type="button"
                disabled
                title="后置"
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs text-neutral-600"
              >
                <span className="w-4 text-center opacity-50">🗜️</span>上传 .zip 包
                <span className="ml-auto text-[10px] text-neutral-700">后置</span>
              </button>
            </div>
          )}
        </div>

        <div className="border-b border-neutral-800 px-4 py-2.5">
          <p className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-[10.5px] leading-relaxed text-violet-200">
            激活的 Skill 会装配进 Agent 的 catalog（仅 name+description），由 LLM 按需读取全文并自动调用——渐进式披露，无需逐个工作流手选。
          </p>
        </div>

        <div className="flex-1 overflow-auto px-4 py-3">
          {error && (
            <div className="mb-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">
              {error}
            </div>
          )}
          {loading && skills.length === 0 ? (
            <p className="py-8 text-center text-xs text-neutral-600">加载中…</p>
          ) : skills.length === 0 ? (
            <p className="py-8 text-center text-xs text-neutral-600">
              暂无 skill。用「+ 添加」从文件夹或 Git 安装。
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {skills.map((s) => (
                <SkillCard key={s.id} skill={s} />
              ))}
            </div>
          )}
        </div>
      </aside>

      {gitOpen && <GitInstallModal onClose={() => setGitOpen(false)} />}

      <input
        ref={dirInputRef}
        type="file"
        className="hidden"
        onChange={handleFolder}
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
      />
    </>
  );
}
