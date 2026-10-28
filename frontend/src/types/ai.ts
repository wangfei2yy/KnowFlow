export type AIJobType = "summary" | "qa" | "actions" | "flashcards";
export type AIJobStatus = "pending" | "running" | "success" | "failed";

export interface SummaryResult {
  summary: string;
  keyPoints: string[];
  keywords: string[];
}

export interface SourceContext {
  documentId: string;
  title: string;
  excerpt: string;
}

export interface AnswerResult {
  answer: string;
  sources: { documentId: string; title: string; excerpt: string }[];
  confidence: "low" | "medium" | "high";
}

export interface ExtractedTask {
  title: string;
  description?: string;
  dueDate?: string | null;
  priority: "low" | "medium" | "high";
  evidence: string;
}

export interface FlashcardDraft {
  question: string;
  answer: string;
}

export interface AIJob {
  id: string;
  documentId?: string;
  type: AIJobType;
  status: AIJobStatus;
  result?: unknown;
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
}
