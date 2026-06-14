import type { ExecStatus } from '@dsweave/core';

/** 节点/边外框随执行状态的样式。 */
export function statusRing(status: ExecStatus | undefined): string {
  switch (status) {
    case 'running':
      return 'border-sky-400 ring-2 ring-sky-400/40 animate-pulse';
    case 'done':
      return 'border-emerald-500';
    case 'error':
      return 'border-rose-500';
    default:
      return '';
  }
}

export const STATUS_LABEL: Record<ExecStatus, string> = {
  idle: '待运行',
  running: '运行中',
  done: '完成',
  error: '错误',
};

export const STATUS_DOT: Record<ExecStatus, string> = {
  idle: 'bg-neutral-600',
  running: 'bg-sky-400 animate-pulse',
  done: 'bg-emerald-500',
  error: 'bg-rose-500',
};

export const TOOL_STATE_DOT: Record<string, string> = {
  pending: 'bg-neutral-500',
  running: 'bg-sky-400 animate-pulse',
  done: 'bg-emerald-500',
  error: 'bg-rose-500',
};
