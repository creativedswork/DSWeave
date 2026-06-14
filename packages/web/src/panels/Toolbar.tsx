import { useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useDSWeaveStore, parseFlowJson } from '../store/useDSWeaveStore';
import { collectFromFileList } from '../lib/files';

function btn(variant: 'default' | 'primary' = 'default') {
  const base =
    'rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40';
  return variant === 'primary'
    ? `${base} bg-sky-600 text-white hover:bg-sky-500`
    : `${base} border border-neutral-700 text-neutral-200 hover:bg-neutral-800`;
}

export function Toolbar() {
  const rf = useReactFlow();
  const flowName = useDSWeaveStore((s) => s.flowName);
  const setFlowName = useDSWeaveStore((s) => s.setFlowName);
  const addIngested = useDSWeaveStore((s) => s.addIngested);
  const addOutputNode = useDSWeaveStore((s) => s.addOutputNode);
  const newFlow = useDSWeaveStore((s) => s.newFlow);
  const exportJson = useDSWeaveStore((s) => s.exportJson);
  const loadFlowGraph = useDSWeaveStore((s) => s.loadFlowGraph);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);
  const loadInputRef = useRef<HTMLInputElement>(null);

  const centerPosition = () => {
    const { x, y, zoom } = rf.getViewport();
    return {
      x: (window.innerWidth / 2 - x) / zoom - 130,
      y: (window.innerHeight / 2 - y) / zoom - 80,
    };
  };

  const handleSave = () => {
    const json = exportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safe = flowName.trim().replace(/[^\w\u4e00-\u9fa5.-]+/g, '_') || 'flow';
    a.href = url;
    a.download = `${safe}.flow.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoad = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const graph = parseFlowJson(await file.text());
      loadFlowGraph(graph);
      window.requestAnimationFrame(() => rf.fitView({ padding: 0.2 }));
    } catch (err) {
      alert(`加载失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleAddFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    e.target.value = '';
    if (!list || list.length === 0) return;
    const { warnings } = await addIngested(collectFromFileList(list), centerPosition());
    if (warnings.length) alert(warnings.join('\n'));
  };

  return (
    <header className="flex items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-4 py-2.5">
      <span className="text-lg font-semibold tracking-tight text-neutral-100">DSWeave</span>
      <span className="hidden text-[10px] text-neutral-600 sm:inline">空间化知识引擎</span>

      <input
        value={flowName}
        onChange={(e) => setFlowName(e.target.value)}
        className="ml-2 w-48 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 outline-none focus:border-sky-500"
        aria-label="工作流名称"
      />

      <div className="ml-auto flex items-center gap-2">
        <button type="button" className={btn()} onClick={() => fileInputRef.current?.click()}>
          + 文件
        </button>
        <button
          type="button"
          className={btn()}
          onClick={() => dirInputRef.current?.click()}
          title="导入 .gltf 资源文件夹（含 .bin 与纹理）"
        >
          + 文件夹
        </button>
        <button type="button" className={btn()} onClick={() => addOutputNode(centerPosition())}>
          + 输出节点
        </button>
        <span className="mx-1 h-5 w-px bg-neutral-800" />
        <button type="button" className={btn()} onClick={newFlow}>
          新建
        </button>
        <button type="button" className={btn()} onClick={() => loadInputRef.current?.click()}>
          加载
        </button>
        <button type="button" className={btn('primary')} onClick={handleSave}>
          保存
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".glb,.md,.markdown,.pdf,.txt,.html,.htm,.png,.jpg,.jpeg,.gif,.webp,.svg,.csv,.json,.tsv"
        className="hidden"
        onChange={handleAddFiles}
      />
      <input
        ref={dirInputRef}
        type="file"
        className="hidden"
        onChange={handleAddFiles}
        // 选择整个文件夹（gltf + 依赖）。webkitdirectory 非标准，需放到 JSX 属性里。
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
      />
      <input
        ref={loadInputRef}
        type="file"
        accept=".json,.flow.json"
        className="hidden"
        onChange={handleLoad}
      />
    </header>
  );
}
