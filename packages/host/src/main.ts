import { createHost, HOST_VERSION } from './index.js';

const port = Number(process.env.DSWEAVE_PORT ?? 8787);
const host = createHost({ workingDir: process.cwd(), port });

host
  .start()
  .then(() => {
    console.log(`[dsweave/host] v${HOST_VERSION} ready · workingDir=${host.options.workingDir}`);
  })
  .catch((err: unknown) => {
    console.error('[dsweave/host] failed to start:', err);
    process.exit(1);
  });
