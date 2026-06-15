/** 文件理解：默认 provider 注册表装配 + 导出。 */
import { ProviderRegistry } from './registry.js';
import { mdProvider } from './md.js';
import { txtProvider } from './txt.js';
import { htmlProvider } from './html.js';
import { dataProvider } from './data.js';
import { gltfProvider } from './gltf.js';
import { pdfProvider } from './pdf.js';
import { imageProvider } from './image.js';

/** 创建装配了全部内置 provider 的注册表。 */
export function createDefaultRegistry(): ProviderRegistry {
  return new ProviderRegistry()
    .register(mdProvider)
    .register(txtProvider)
    .register(htmlProvider)
    .register(dataProvider)
    .register(gltfProvider)
    .register(pdfProvider)
    .register(imageProvider);
}

export { ProviderRegistry } from './registry.js';
export type { UnderstandIO, UnderstandingProvider } from './registry.js';
export { mdProvider, markdownOutline } from './md.js';
export { txtProvider } from './txt.js';
export { htmlProvider, htmlToText, htmlOutline, htmlTitle } from './html.js';
export { dataProvider, parseCsv } from './data.js';
export { gltfProvider, extractGlbJson } from './gltf.js';
export { pdfProvider } from './pdf.js';
export { imageProvider, readImageSize } from './image.js';
