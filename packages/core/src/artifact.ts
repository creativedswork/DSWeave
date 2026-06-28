/**
 * Artifact —— Host 能力产出物的契约（内容寻址、可交付）。
 *
 * scene.html 能力把 Agent 自撰 HTML + model-viewer 运行时 + 内联资产 → 自包含单文件 HTML。
 * 产物落盘到 `.dsweave/artifacts/<hash>/`，单文件可双击直接打开，
 * 也可经 Host 的静态服务（`/_artifacts/<hash>/...`）在前端 iframe 预览。
 */
export interface Artifact {
  /** 访问 uri（Host 静态服务的相对路径，如 `/_artifacts/<hash>/index.html`）。 */
  uri: string;
  mime: string;
  /** 内容寻址 hash（含最终 HTML 全文）。 */
  hash: string;
  /** 是否自包含单文件（可双击直接打开）。 */
  singleFile: boolean;
  /** 字节数。 */
  bytes: number;
  /** 来源输出节点 id。 */
  fromNodeId?: string;
  /** 落盘的绝对路径（Host 侧，便于下载/复用；前端用 uri）。 */
  path?: string;
}
