export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class ProjectNotFoundError extends DomainError {
  constructor(projectId: string) {
    super("PROJECT_NOT_FOUND", `Project '${projectId}' was not found.`);
  }
}

export class TaskNotFoundError extends DomainError {
  constructor(taskId: string) {
    super("TASK_NOT_FOUND", `Task '${taskId}' was not found.`);
  }
}

export class InvalidTaskError extends DomainError {
  constructor(message: string) {
    super("INVALID_TASK", message);
  }
}
