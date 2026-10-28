export type SourceType = "note" | "text" | "file" | "web";

export interface Document {
  id: string;
  title: string;
  content: string;
  sourceType: SourceType;
  sourceName?: string;
  categoryId?: string;
  tags: string[];
  summary?: string;
  keywords: string[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  contentHash?: string;
}

export interface Category {
  id: string;
  name: string;
  color?: string;
  sortOrder: number;
  createdAt: string;
}

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  note: "笔记",
  text: "文本",
  file: "文件",
  web: "网页"
};
