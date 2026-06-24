import { useDSWeaveStore } from '../store/useDSWeaveStore';

/** 危险操作审批弹窗：Agent 请求授权（如写入产物）时阻塞等待用户决定。 */
export function PermissionDialog() {
  const pending = useDSWeaveStore((s) => s.pendingPermission);
  const respond = useDSWeaveStore((s) => s.respondPermission);
  if (!pending) return null;

  const [allowLabel = '允许', denyLabel = '拒绝'] = pending.options;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[min(420px,90%)] rounded-xl border border-amber-500/30 bg-neutral-900 p-5 shadow-2xl">
        <div className="mb-1 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          <h3 className="text-sm font-semibold text-amber-200">授权请求</h3>
        </div>
        <p className="mb-4 text-[13px] leading-relaxed text-neutral-200">{pending.summary}</p>
        <p className="mb-4 text-[11px] text-neutral-500">
          Agent 请求执行一项受控操作。批准后 Host 才会写入产物（工作目录沙箱限定）。
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => respond(false)}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            {denyLabel}
          </button>
          <button
            type="button"
            onClick={() => respond(true)}
            className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-neutral-900 hover:bg-amber-400"
          >
            {allowLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
