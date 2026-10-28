import { db } from "@/db/database";
import type { Task, TaskStatus, TaskPriority } from "@/types/task";
import { uuid } from "@/utils/format";
import { toPlain, stripProxy } from "@/utils/plain";

export interface CreateTaskInput {
  title: string;
  description?: string;
  sourceDocumentId?: string;
  priority?: TaskPriority;
  dueDate?: string;
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const now = new Date().toISOString();
  const task: Task = {
    id: uuid(),
    title: input.title.trim(),
    description: input.description,
    sourceDocumentId: input.sourceDocumentId,
    status: "todo",
    priority: input.priority ?? "medium",
    dueDate: input.dueDate,
    createdAt: now,
    updatedAt: now
  };
  await db.tasks.add(toPlain(task));
  return task;
}

export async function listTasks(): Promise<Task[]> {
  return db.tasks.orderBy("createdAt").reverse().toArray();
}

export async function updateTaskStatus(id: string, status: TaskStatus): Promise<void> {
  await db.tasks.update(id, { status, updatedAt: new Date().toISOString() });
}

export async function updateTask(id: string, patch: Partial<Task>): Promise<void> {
  // stripProxy 保留 undefined，确保可以清空 dueDate / description 等字段
  await db.tasks.update(
    id,
    stripProxy({ ...patch, updatedAt: new Date().toISOString() })
  );
}

export async function deleteTask(id: string): Promise<void> {
  await db.tasks.delete(id);
}
