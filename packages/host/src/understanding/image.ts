/**
 * 图片 provider：M3 占位（OCR / 视觉描述后置）。
 *
 * 先登记尺寸/格式等可零依赖获取的元数据；OCR 与视觉 caption 留待接入视觉模型时补全。
 */
import type { FileRef, Understanding } from '@dsweave/core';
import type { UnderstandIO, UnderstandingProvider } from './registry.js';

/** 从 PNG/JPEG/GIF 头部读取像素尺寸（零依赖）。 */
export function readImageSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // PNG: 8 字节签名 + IHDR(宽 4、高 4 @ offset 16/20)
  if (bytes.length > 24 && view.getUint32(0) === 0x89504e47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // GIF: 'GIF' + 宽高小端 @ offset 6/8
  if (bytes.length > 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  // JPEG: 扫描 SOF0/2 段
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let off = 2;
    while (off + 9 < bytes.length) {
      if (bytes[off] !== 0xff) {
        off++;
        continue;
      }
      const marker = bytes[off + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        return { height: view.getUint16(off + 5), width: view.getUint16(off + 7) };
      }
      off += 2 + view.getUint16(off + 2);
    }
  }
  return undefined;
}

export const imageProvider: UnderstandingProvider = {
  type: 'image',
  version: '1',
  async understand(file: FileRef, io: UnderstandIO): Promise<Understanding> {
    const size = readImageSize(io.bytes);
    const caption = size
      ? `图片 ${file.uri}，尺寸 ${size.width}×${size.height}px（视觉描述/OCR 待接入）。`
      : `图片 ${file.uri}（视觉描述/OCR 待接入）。`;
    return {
      captions: [caption],
      metadata: { ...(size ?? {}), bytes: io.bytes.length },
      ready: true,
    };
  },
};
