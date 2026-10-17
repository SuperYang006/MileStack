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

export class InvalidTaskDependencyError extends DomainError {
  constructor(message: string) {
    super("INVALID_TASK_DEPENDENCY", message);
  }
}

export class TaskDependenciesNotEditableError extends DomainError {
  constructor(taskId: string) {
    super(
      "TASK_DEPENDENCIES_NOT_EDITABLE",
      `Task '${taskId}' dependencies can only be changed while the task is in inbox or ready status.`,
    );
  }
}

export class InvalidTaskStateError extends DomainError {
  constructor(taskId: string, expected: string, actual: string) {
    super(
      "INVALID_TASK_STATE",
      `Task '${taskId}' must be ${expected}, but is '${actual}'.`,
    );
  }
}

export class TaskRunOwnershipError extends DomainError {
  constructor(taskId: string) {
    super(
      "TASK_RUN_OWNERSHIP_MISMATCH",
      `The supplied runId does not own task '${taskId}'.`,
    );
  }
}

export class TaskRiskNotConfirmedError extends DomainError {
  constructor(taskId: string) {
    super(
      "TASK_RISK_NOT_CONFIRMED",
      `Task '${taskId}' risk must be confirmed by a developer before it can start.`,
    );
  }
}

export class ReviewRunOwnershipError extends DomainError {
  constructor(taskId: string) {
    super(
      "REVIEW_RUN_OWNERSHIP_MISMATCH",
      `The supplied reviewRunId does not own the current review for task '${taskId}'.`,
    );
  }
}

export class ReviewEvidenceIncompleteError extends DomainError {
  constructor(taskId: string) {
    super(
      "REVIEW_EVIDENCE_INCOMPLETE",
      `AI review for task '${taskId}' must include at least one verification command and result.`,
    );
  }
}

export class IntegrationCheckStaleError extends DomainError {
  constructor(taskId: string) {
    super(
      "INTEGRATION_CHECK_STALE",
      `The review or task state for '${taskId}' changed during the local integration check. Refresh the task and retry against the latest review.`,
    );
  }
}

export class TaskDependenciesIncompleteError extends DomainError {
  readonly dependencyIds: string[];

  constructor(taskId: string, dependencyIds: string[]) {
    super(
      "TASK_DEPENDENCIES_INCOMPLETE",
      `Task '${taskId}' cannot start until dependencies are completed: ${dependencyIds.join(", ")}.`,
    );
    this.dependencyIds = dependencyIds;
  }
}

export class TaskHasDependentsError extends DomainError {
  readonly dependentTaskIds: string[];

  constructor(taskId: string, dependentTaskIds: string[]) {
    super(
      "TASK_HAS_DEPENDENTS",
      `Task '${taskId}' cannot be deleted because it is required by: ${dependentTaskIds.join(", ")}.`,
    );
    this.dependentTaskIds = dependentTaskIds;
  }
}
