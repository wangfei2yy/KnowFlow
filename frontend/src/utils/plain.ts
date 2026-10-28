/**
 * 转为可被 IndexedDB 结构化克隆的纯对象。
 *
 * 为什么必需：Vue 的响应式数组/对象本质是 Proxy，
 * 直接传给 IndexedDB 会抛
 * `DataCloneError: xxx could not be cloned`。
 * JSON 序列化可同时剥离 Proxy 与 undefined 字段。
 *
 * ⚠️ 注意：它会**丢弃 undefined 字段**。Dexie 的 update 依赖
 * `{ field: undefined }` 来表达「删除该字段」，因此 update 场景请用 stripProxy。
 */
export function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 递归剥离 Vue 响应式 Proxy，但**保留 undefined 字段**。
 *
 * 用于需要保留 Dexie 语义（undefined = 删除字段）的写入场景，
 * 以及数据库层的全局兜底。
 */
export function stripProxy<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripProxy(v)) as unknown as T;
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripProxy(v);
    }
    return out as T;
  }
  return value;
}
