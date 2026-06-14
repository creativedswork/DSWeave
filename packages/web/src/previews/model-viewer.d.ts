import type { DetailedHTMLProps, HTMLAttributes } from 'react';

/** <model-viewer> 自定义元素的最小 JSX 声明（仅本项目用到的属性）。 */
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        alt?: string;
        'camera-controls'?: boolean | '';
        'auto-rotate'?: boolean | '';
        'disable-zoom'?: boolean | '';
        'shadow-intensity'?: string;
        exposure?: string;
        loading?: 'auto' | 'lazy' | 'eager';
      };
    }
  }
}

export {};
