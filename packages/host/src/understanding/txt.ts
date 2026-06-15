/** 纯文本 provider：正文（无标题语义）。 */
import type { FileRef, Understanding } from '@dsweave/core';
import type { UnderstandIO, UnderstandingProvider } from './registry.js';

export const txtProvider: UnderstandingProvider = {
  type: 'txt',
  version: '1',
  async understand(_file: FileRef, io: UnderstandIO): Promise<Understanding> {
    const text = io.text();
    const lines = text.split(/\r?\n/).length;
    return {
      text,
      metadata: { chars: text.length, lines },
      ready: true,
    };
  },
};
