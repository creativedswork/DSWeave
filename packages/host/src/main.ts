import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHost, HOST_VERSION, type AgentKind } from './index.js';

// 锚定仓库根：dist/main.js 位于 packages/host/dist/，上溯三级即仓库根，
// 从而不受 `pnpm --filter` 把 cwd 设为包目录的影响。
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const port = Number(process.env.DSWEAVE_PORT ?? 8787);
const agentKind = (process.env.DSWEAVE_AGENT as AgentKind) ?? 'scene';
const workingDir = process.env.DSWEAVE_WORKDIR
  ? resolve(process.env.DSWEAVE_WORKDIR)
  : repoRoot;
const playerDistPath = process.env.DSWEAVE_PLAYER_DIST
  ? resolve(process.env.DSWEAVE_PLAYER_DIST)
  : resolve(repoRoot, 'packages/player/dist/index.html');

if (!existsSync(playerDistPath)) {
  console.warn(
    `[dsweave/host] ⚠️ Player bundle 未找到：${playerDistPath}\n` +
      `  产出 scene.html 前请先构建：pnpm --filter @dsweave/player build`,
  );
}

const host = createHost({ workingDir, port, agentKind, playerDistPath });

host
  .start()
  .then(() => {
    console.log(
      `[dsweave/host] v${HOST_VERSION} ready · agent=${agentKind} · port=${port}\n` +
        `  workingDir=${workingDir}\n  playerDist=${playerDistPath}`,
    );
  })
  .catch((err: unknown) => {
    console.error('[dsweave/host] failed to start:', err);
    process.exit(1);
  });
