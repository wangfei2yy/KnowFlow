/**
 * 小工具（小红书端内）专用轻量存储。
 *
 * 为什么不用 Dexie / IndexedDB：容器文档明确「浏览器自带存储仅作为兼容降级方案，
 * 无法保证始终可用」，端内推荐使用 xhs.miniTool 的 Storage API（9.46+）。
 * 该 API 只接受 JSON 字符串（单 key 1MB、总量 10MB），因此这里用
 * 「整表 JSON + 内存镜像」的方式实现，并保留与 Dexie 一致的最小 API 子集：
 * add / put / update / delete / get / toArray / count / clear /
 * bulkAdd / bulkPut / orderBy().toArray() / orderBy().reverse().toArray() /
 * where().equals().toArray() / transaction()。
 */
import { stripProxy } from "@/utils/plain";

type Row = Record<string, unknown>;

const PREFIX = "knowflow.mt.";

interface MiniToolBridge {
  getStorage?: (opts: { key: string }) => Promise<{ data?: string | null }>;
  setStorage?: (opts: { key: string; data: string }) => Promise<unknown>;
}

function bridge(): MiniToolBridge | null {
  const w = window as unknown as { xhs?: { miniTool?: MiniToolBridge } };
  return (w.xhs && w.xhs.miniTool) || null;
}

async function readKey(name: string): Promise<string | null> {
  const mt = bridge();
  if (mt && typeof mt.getStorage === "function") {
    try {
      const res = await mt.getStorage({ key: PREFIX + name });
      if (res && typeof res.data === "string") return res.data;
    } catch {
      /* 降级到 localStorage */
    }
  }
  try {
    return localStorage.getItem(PREFIX + name);
  } catch {
    return null;
  }
}

function writeKey(name: string, data: string): void {
  const mt = bridge();
  if (mt && typeof mt.setStorage === "function") {
    try {
      void mt.setStorage({ key: PREFIX + name, data });
    } catch {
      /* ignore */
    }
  }
  try {
    localStorage.setItem(PREFIX + name, data);
  } catch {
    /* 容量或权限受限时忽略，内存镜像仍然可用 */
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class LiteTable<T extends Row = Row> {
  private rows: T[] | null = null;
  private loading: Promise<void> | null = null;

  constructor(private readonly name: string) {}

  private async ensure(): Promise<T[]> {
    if (this.rows) return this.rows;
    if (!this.loading) {
      this.loading = (async () => {
        const raw = await readKey(this.name);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            this.rows = Array.isArray(parsed) ? (parsed as T[]) : [];
          } catch {
            this.rows = [];
          }
        } else {
          this.rows = [];
        }
      })();
    }
    await this.loading;
    return this.rows ?? [];
  }

  private persist(): void {
    writeKey(this.name, JSON.stringify(this.rows ?? []));
  }

  async add(item: T): Promise<string> {
    const rows = await this.ensure();
    const plain = stripProxy(item);
    rows.push(plain);
    this.persist();
    return String((plain as Row).id ?? "");
  }

  async bulkAdd(items: T[]): Promise<void> {
    const rows = await this.ensure();
    for (const item of items) rows.push(stripProxy(item));
    this.persist();
  }

  async put(item: T): Promise<string> {
    const rows = await this.ensure();
    const plain = stripProxy(item);
    const id = String((plain as Row).id ?? "");
    const index = rows.findIndex((r) => String((r as Row).id) === id);
    if (index >= 0) rows[index] = plain;
    else rows.push(plain);
    this.persist();
    return id;
  }

  async bulkPut(items: T[]): Promise<void> {
    for (const item of items) await this.put(item);
  }

  /**
   * 与 Dexie 语义保持一致：值为 undefined 表示删除该字段。
   */
  async update(id: string, changes: Row): Promise<number> {
    const rows = await this.ensure();
    const row = rows.find((r) => String((r as Row).id) === id);
    if (!row) return 0;
    const plain = stripProxy(changes);
    for (const key of Object.keys(plain)) {
      if (plain[key] === undefined) delete (row as Row)[key];
      else (row as Row)[key] = plain[key];
    }
    this.persist();
    return 1;
  }

  async delete(id: string): Promise<void> {
    const rows = await this.ensure();
    const index = rows.findIndex((r) => String((r as Row).id) === id);
    if (index >= 0) rows.splice(index, 1);
    this.persist();
  }

  async get(id: string): Promise<T | undefined> {
    const rows = await this.ensure();
    const row = rows.find((r) => String((r as Row).id) === id);
    return row ? clone(row) : undefined;
  }

  async toArray(): Promise<T[]> {
    const rows = await this.ensure();
    return clone(rows);
  }

  async count(): Promise<number> {
    const rows = await this.ensure();
    return rows.length;
  }

  async clear(): Promise<void> {
    await this.ensure();
    this.rows = [];
    this.persist();
  }

  orderBy(field: string) {
    const sorted = async (asc: boolean): Promise<T[]> => {
      const rows = await this.ensure();
      const copy = clone(rows);
      copy.sort((a, b) => {
        const av = (a as Row)[field] as string | number | undefined;
        const bv = (b as Row)[field] as string | number | undefined;
        if (av === bv) return 0;
        if (av === undefined || av === null) return 1;
        if (bv === undefined || bv === null) return -1;
        return av > bv ? 1 : -1;
      });
      return asc ? copy : copy.reverse();
    };
    return {
      toArray: () => sorted(true),
      reverse: () => ({ toArray: () => sorted(false) })
    };
  }

  where(field: string) {
    return {
      equals: (value: unknown) => ({
        toArray: async (): Promise<T[]> => {
          const rows = await this.ensure();
          return clone(rows).filter((r) => (r as Row)[field] === value);
        }
      })
    };
  }
}

export interface LiteDB {
  documents: LiteTable;
  categories: LiteTable;
  tasks: LiteTable;
  flashcards: LiteTable;
  aiJobs: LiteTable;
  transaction: (...args: unknown[]) => Promise<unknown>;
}

export function createLiteDB(): LiteDB {
  const db: LiteDB = {
    documents: new LiteTable("documents"),
    categories: new LiteTable("categories"),
    tasks: new LiteTable("tasks"),
    flashcards: new LiteTable("flashcards"),
    aiJobs: new LiteTable("aiJobs"),
    transaction: async (...args: unknown[]) => {
      const fn = args[args.length - 1];
      if (typeof fn === "function") return (fn as () => Promise<unknown>)();
      return undefined;
    }
  };
  return db;
}
