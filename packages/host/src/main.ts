import { createHost, HOST_VERSION } from './index.js';

const host = createHost({ workingDir: process.cwd(), port: 8787 });
console.log(`[dsweave/host] v${HOST_VERSION} placeholder, workingDir=${host.options.workingDir}`);
