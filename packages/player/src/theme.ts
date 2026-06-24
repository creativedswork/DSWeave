import type { SceneTheme } from '@dsweave/core';

/** 解析后的呈现配色（由 SceneTheme.palette 派生）。 */
export interface ResolvedTheme {
  bg: string;
  /** Canvas 渐变远端色。 */
  bgFar: string;
  accent: string;
  text: string;
  textDim: string;
  panelBg: string;
  panelBorder: string;
}

const PALETTES: Record<string, ResolvedTheme> = {
  'dark-tech': {
    bg: '#0a0a0f',
    bgFar: '#12121d',
    accent: '#38bdf8',
    text: '#e8eaf0',
    textDim: '#8b90a0',
    panelBg: 'rgba(16,18,28,0.82)',
    panelBorder: 'rgba(56,189,248,0.25)',
  },
  light: {
    bg: '#f5f6f8',
    bgFar: '#e6e9ef',
    accent: '#2563eb',
    text: '#1a1d24',
    textDim: '#5b6170',
    panelBg: 'rgba(255,255,255,0.86)',
    panelBorder: 'rgba(37,99,235,0.2)',
  },
  warm: {
    bg: '#171210',
    bgFar: '#241a14',
    accent: '#f59e0b',
    text: '#f4ece3',
    textDim: '#a8957f',
    panelBg: 'rgba(28,20,16,0.82)',
    panelBorder: 'rgba(245,158,11,0.25)',
  },
};

/** 把 SceneTheme 解析为呈现配色（未知 palette 退回 dark-tech）。 */
export function resolveTheme(theme: SceneTheme): ResolvedTheme {
  const key = theme.palette.toLowerCase();
  if (PALETTES[key]) return PALETTES[key];
  if (key.includes('light')) return PALETTES.light!;
  if (key.includes('warm') || key.includes('amber')) return PALETTES.warm!;
  return PALETTES['dark-tech']!;
}
