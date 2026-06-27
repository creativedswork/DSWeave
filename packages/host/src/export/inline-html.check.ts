import assert from 'node:assert/strict';
import { inlineAssets, injectViewerRuntime } from './inline-html.js';

// 1) asset:// 替换为 data URI，并报告无法解析的引用
{
  const html = '<model-viewer src="asset://n1"></model-viewer><img src="asset://nX">';
  const { html: out, missing } = inlineAssets(html, (id) =>
    id === 'n1' ? { mime: 'model/gltf-binary', bytes: new Uint8Array([1, 2, 3]) } : undefined,
  );
  assert.ok(out.includes('data:model/gltf-binary;base64,'), '应内联 data URI');
  assert.ok(!out.includes('asset://n1'), 'n1 占位应被替换');
  assert.deepEqual(missing, ['nX'], '未解析引用应报告');
  assert.ok(out.includes('asset://nX'), '未解析引用保持原样');
}

// 2) 同一 nodeId 多次引用只编码一次且都被替换
{
  let calls = 0;
  const html = 'a asset://n1 b asset://n1 c';
  const { html: out } = inlineAssets(html, () => {
    calls++;
    return { mime: 'image/png', bytes: new Uint8Array([9]) };
  });
  assert.equal(calls, 1, '同一 nodeId 只解析一次');
  assert.equal(out.match(/data:image\/png/g)?.length, 2, '两处都被替换');
}

// 3) 运行时注入到 <head>
{
  const out = injectViewerRuntime('<html><head></head><body>x</body></html>', 'CONSOLE_LOG');
  assert.ok(out.includes('<script>CONSOLE_LOG</script>'), '应注入运行时脚本');
  assert.ok(out.indexOf('CONSOLE_LOG') < out.indexOf('</head>'), '运行时应在 head 内');
}

// 4) 无 <head> 时退化注入到 <body> 前 / 开头
{
  const out = injectViewerRuntime('<body>x</body>', 'RT');
  assert.ok(out.includes('<script>RT</script>'), '无 head 也应注入');
}

console.log('✓ inline-html.check 通过');
