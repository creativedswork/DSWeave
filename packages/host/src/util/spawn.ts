/**
 * 跨平台 spawn 封装。
 *
 * 背景：在 Windows 上，PATH 中的 `npx` / `gemini` 等命令实际是 `npx.cmd` / `gemini.cmd`
 * 这类批处理脚本。Node 的 `child_process.spawn` 不加 `shell` 时无法解析它们（ENOENT），
 * 且自 Node 安全修复（CVE-2024-27980）后，直接 spawn `.cmd`/`.bat` 会抛 EINVAL。
 * 因此在 win32 上必须显式启用 `shell` 才能找到并执行这些命令。
 *
 * 启用 shell 后，命令行由我们自己拼接，含空格 / 特殊字符的参数（如带空格的文件路径）
 * 需要加引号，这里统一处理，避免 PowerShell / cmd.exe 解析错位。
 */
import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
  type SpawnSyncOptions,
} from 'node:child_process';

const isWindows = process.platform === 'win32';

/** 为 Windows 命令行加引号：仅在含空格或 cmd 特殊字符时包裹双引号。 */
function quoteForWindows(s: string): string {
  if (s.length === 0) return '""';
  if (!/[\s"^&|<>()%!]/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

/**
 * 跨平台 spawn：POSIX 直接透传；Windows 上启用 shell 并对命令/参数加引号，
 * 从而可正确解析 `npx`、`gemini` 等 `.cmd` 命令。stdio 管道与 POSIX 行为一致。
 */
export function spawnCross(
  command: string,
  args: string[] = [],
  options: SpawnOptions = {},
): ChildProcess {
  if (!isWindows) return spawn(command, args, options);
  return spawn(quoteForWindows(command), args.map(quoteForWindows), {
    ...options,
    shell: true,
  });
}

/** 跨平台同步 spawn（供 git clone 等需阻塞等待退出码的场景）。 */
export function spawnCrossSync(
  command: string,
  args: string[] = [],
  options: SpawnSyncOptions = {},
) {
  if (!isWindows) return spawnSync(command, args, options);
  return spawnSync(quoteForWindows(command), args.map(quoteForWindows), {
    ...options,
    shell: true,
  });
}
