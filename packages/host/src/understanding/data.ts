/** 数据 provider（csv / json）：字段 schema + 统计摘要。 */
import type { FileRef, Understanding } from '@dsweave/core';
import type { UnderstandIO, UnderstandingProvider } from './registry.js';

interface ColumnStat {
  name: string;
  type: 'number' | 'string' | 'boolean' | 'mixed' | 'empty';
  samples: string[];
}

/** 极简 CSV 解析（支持双引号包裹与转义），返回行（每行字段数组）。 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r[0] ?? '').trim().length > 0);
}

function classify(values: string[]): ColumnStat['type'] {
  let num = 0;
  let bool = 0;
  let nonEmpty = 0;
  for (const v of values) {
    const t = v.trim();
    if (t === '') continue;
    nonEmpty++;
    if (!Number.isNaN(Number(t))) num++;
    else if (/^(true|false)$/i.test(t)) bool++;
  }
  if (nonEmpty === 0) return 'empty';
  if (num === nonEmpty) return 'number';
  if (bool === nonEmpty) return 'boolean';
  if (num === 0 && bool === 0) return 'string';
  return 'mixed';
}

function understandCsv(text: string): Understanding {
  const rows = parseCsv(text);
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const columns: ColumnStat[] = header.map((name, c) => {
    const values = body.map((r) => r[c] ?? '');
    return { name: name.trim() || `col${c + 1}`, type: classify(values), samples: values.slice(0, 3) };
  });
  const summary = `CSV：${body.length} 行 × ${header.length} 列。字段：${columns
    .map((c) => `${c.name}(${c.type})`)
    .join('、')}`;
  return {
    schema: { format: 'csv', rows: body.length, columns },
    summary,
    metadata: { rows: body.length, cols: header.length },
    ready: true,
  };
}

function jsonShape(value: unknown, depth = 0): unknown {
  if (depth > 3) return '…';
  if (Array.isArray(value)) {
    return value.length > 0 ? [jsonShape(value[0], depth + 1)] : [];
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = jsonShape(v, depth + 1);
    }
    return out;
  }
  return typeof value;
}

function understandJson(text: string): Understanding {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      text,
      metadata: { error: `JSON 解析失败：${err instanceof Error ? err.message : String(err)}` },
      ready: true,
    };
  }
  const isArr = Array.isArray(parsed);
  const count = isArr ? (parsed as unknown[]).length : Object.keys((parsed as object) ?? {}).length;
  const summary = isArr
    ? `JSON 数组：${count} 条记录。`
    : `JSON 对象：${count} 个顶层字段。`;
  return {
    schema: { format: 'json', shape: jsonShape(parsed) },
    summary,
    metadata: { kind: isArr ? 'array' : 'object', count },
    ready: true,
  };
}

export const dataProvider: UnderstandingProvider = {
  type: 'data',
  version: '1',
  async understand(file: FileRef, io: UnderstandIO): Promise<Understanding> {
    const text = io.text();
    const isJson =
      file.uri.toLowerCase().endsWith('.json') ||
      file.mime.includes('json') ||
      /^\s*[[{]/.test(text);
    return isJson ? understandJson(text) : understandCsv(text);
  },
};
