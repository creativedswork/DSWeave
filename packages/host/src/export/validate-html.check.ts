import assert from 'node:assert/strict';
import { validateHtml } from './validate-html.js';

const known = new Set(['n1', 'n2']);

// 合法：引用均已知、无外链、非空
assert.deepEqual(validateHtml('<model-viewer src="asset://n1"></model-viewer>', known), []);

// 空内容
assert.ok(validateHtml('   ', known).length > 0, '空内容应报错');

// 引用未知 nodeId
{
  const errs = validateHtml('<img src="asset://zzz">', known);
  assert.ok(errs.some((e) => e.includes('zzz')), '未知 nodeId 应报错');
}

// 外链脚本（违反离线）
{
  const errs = validateHtml('<script src="https://cdn.example/x.js"></script>', known);
  assert.ok(errs.some((e) => e.includes('外链')), '外链脚本应报错');
}

// 外链样式
{
  const errs = validateHtml('<link rel="stylesheet" href="http://x/y.css">', known);
  assert.ok(errs.some((e) => e.includes('外链')), '外链样式应报错');
}

console.log('✓ validate-html.check 通过');
