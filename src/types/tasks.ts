export type TaskStatus = "pending" | "in_progress" | "completed";

export type TodoPriority = "high" | "medium" | "low";
export interface TaskItem {
  id: string;
  subject: string;
  status: TaskStatus;
  activeForm?: string;
  updatedAt: number;
  priority?: TodoPriority; // todo-file only
  due?: string; // todo-file only — free text
  blocked?: boolean; // todo-file only
}

// Per-session snapshot pushed from the main process (one panel hosts many sessions).
export interface TaskSummary {
  claudeSessionId: string;
  panelNumber: number | null;
  cwd: string;
  source: "task-tools" | "todowrite" | "todo-file" | "manual";
  repoRoot?: string; // todo-file only — groups the card by repo instead of terminal
  updatedAt: number;
  tasks: TaskItem[];
  total: number;
  completed: number;
  inProgress: number;
}
