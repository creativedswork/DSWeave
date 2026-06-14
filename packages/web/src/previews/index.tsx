import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { SourceNodeData } from '../types';

const FRAME = 'h-40 w-full overflow-hidden rounded-md border border-neutral-800 bg-neutral-900';

function Empty({ note }: { note: string }) {
  return (
    <div className={`${FRAME} flex items-center justify-center text-xs text-neutral-600`}>
      {note}
    </div>
  );
}

function GltfPreview({ data }: { data: SourceNodeData }) {
  if (!data.previewUrl) return <Empty note="模型预览需重新拖入文件" />;
  return (
    <div className={FRAME}>
      <model-viewer
        src={data.previewUrl}
        alt={data.label}
        camera-controls
        auto-rotate
        shadow-intensity="1"
        exposure="0.9"
        loading="eager"
        style={{ width: '100%', height: '100%', backgroundColor: '#0a0a0a' }}
      />
    </div>
  );
}

function ImagePreview({ data }: { data: SourceNodeData }) {
  if (!data.previewUrl) return <Empty note="图片预览需重新拖入文件" />;
  return (
    <div className={FRAME}>
      <img src={data.previewUrl} alt={data.label} className="h-full w-full object-contain" />
    </div>
  );
}

function PdfPreview({ data }: { data: SourceNodeData }) {
  if (!data.previewUrl) return <Empty note="PDF 预览需重新拖入文件" />;
  return (
    <div className={FRAME}>
      <iframe src={data.previewUrl} title={data.label} className="h-full w-full" />
    </div>
  );
}

function MarkdownPreview({ data }: { data: SourceNodeData }) {
  if (data.previewText == null) return <Empty note="Markdown 预览需重新拖入文件" />;
  return (
    <div
      className={`${FRAME} prose prose-invert prose-sm max-w-none overflow-auto p-2 text-[11px] leading-snug`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.previewText}</ReactMarkdown>
    </div>
  );
}

function TextPreview({ data }: { data: SourceNodeData }) {
  if (data.previewText == null) return <Empty note="文本预览需重新拖入文件" />;
  return (
    <pre className={`${FRAME} overflow-auto p-2 text-[10px] leading-snug text-neutral-300`}>
      {data.previewText}
    </pre>
  );
}

function HtmlPreview({ data }: { data: SourceNodeData }) {
  if (data.previewUrl) {
    return (
      <div className={FRAME}>
        <iframe
          src={data.previewUrl}
          title={data.label}
          sandbox=""
          className="h-full w-full bg-white"
        />
      </div>
    );
  }
  return <TextPreview data={data} />;
}

/** 根据文件类型分发到合适的预览。 */
export function SourcePreview({ data }: { data: SourceNodeData }) {
  switch (data.file.type) {
    case 'gltf':
      return <GltfPreview data={data} />;
    case 'image':
      return <ImagePreview data={data} />;
    case 'pdf':
      return <PdfPreview data={data} />;
    case 'md':
      return <MarkdownPreview data={data} />;
    case 'html':
      return <HtmlPreview data={data} />;
    case 'txt':
    case 'data':
      return <TextPreview data={data} />;
    default:
      return <Empty note={`暂不支持预览：${data.file.type}`} />;
  }
}
