import { useDSWeaveStore } from '../store/useDSWeaveStore';
import { artifactUrl } from '../acp/connect';

/** 产物预览：3D HTML 以 iframe 呈现（可旋转/点热点），并支持下载 + 提升为来源节点。 */
export function ArtifactViewer() {
  const uri = useDSWeaveStore((s) => s.viewingArtifact);
  const close = useDSWeaveStore((s) => s.viewArtifact);
  const promote = useDSWeaveStore((s) => s.promoteArtifact);
  if (!uri) return null;

  const url = artifactUrl(uri);

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-neutral-950/95 backdrop-blur">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2.5">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-neutral-200">产物预览</h3>
          <p className="truncate text-[11px] text-neutral-500" title={uri}>
            {uri}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => promote(uri)}
            className="rounded-md border border-sky-500/40 px-2.5 py-1.5 text-[11px] text-sky-200 hover:bg-sky-500/10"
          >
            提升为来源节点
          </button>
          <a
            href={url}
            download
            className="rounded-md border border-emerald-500/40 px-2.5 py-1.5 text-[11px] text-emerald-200 hover:bg-emerald-500/10"
          >
            下载
          </a>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-neutral-700 px-2.5 py-1.5 text-[11px] text-neutral-300 hover:bg-neutral-800"
          >
            新标签打开
          </a>
          <button
            type="button"
            onClick={() => close(null)}
            className="rounded-md border border-neutral-700 px-2.5 py-1.5 text-[11px] text-neutral-300 hover:bg-neutral-800"
          >
            关闭
          </button>
        </div>
      </div>
      <iframe
        title="DSWeave Artifact"
        src={url}
        className="min-h-0 flex-1 border-0 bg-black"
        sandbox="allow-scripts allow-same-origin allow-downloads"
      />
    </div>
  );
}
