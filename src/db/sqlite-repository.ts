import type BetterSqlite3 from "better-sqlite3";
import { and, asc, desc, eq } from "drizzle-orm";

import type {
  MileStackRepository,
  ProjectRecord,
  TaskDependencyRecord,
  TaskEventRecord,
  TaskRecord,
  ReviewRecord,
  TaskRepositoryTransaction,
} from "../core/repositories.js";
import {
  completedWorkPayloadFor,
  normalizeCompletedWorkPayload,
  normalizeReviewFindingsPayload,
  reviewFindingsPayloadFor,
} from "../core/review-model.js";
import { normalizeAcceptanceCriteriaPayload } from "../core/task-model.js";
import {
  taskDependencies,
  taskEvents,
  taskReviews,
  projects,
  tasks,
} from "./schema.js";
import type { MileStackDatabase } from "./open-database.js";

function mapProject(project: typeof projects.$inferSelect): ProjectRecord {
  return project;
}

function mapTask(task: typeof tasks.$inferSelect): TaskRecord {
  return {
    ...task,
    acceptanceCriteria: normalizeAcceptanceCriteriaPayload(
      task.acceptanceCriteria,
    ),
  };
}

function mapTaskEvent(event: typeof taskEvents.$inferSelect): TaskEventRecord {
  const normalized = normalizeCompletedWorkPayload(event.completedWork);
  return {
    ...event,
    completedWork: normalized.completedWork,
    criteriaResults: normalized.criteriaResults,
  };
}

function mapReview(review: typeof taskReviews.$inferSelect): ReviewRecord {
  const normalized = normalizeReviewFindingsPayload(review.findings);
  return {
    ...review,
    findings: normalized.findings,
    findingClosures: normalized.findingClosures,
    verificationEvidence: review.verificationEvidence ?? [],
  };
}

function taskEventRow(event: TaskEventRecord) {
  const { criteriaResults, ...row } = event;
  return {
    ...row,
    completedWork: completedWorkPayloadFor({
      completedWork: row.completedWork,
      criteriaResults: criteriaResults ?? null,
    }),
  };
}

function reviewRow(review: ReviewRecord) {
  const { findingClosures, ...row } = review;
  return {
    ...row,
    findings: reviewFindingsPayloadFor({
      findings: row.findings,
      findingClosures,
    }),
  };
}

function updateReviewRow(changes: Partial<ReviewRecord>) {
  const { findingClosures, ...row } = changes;
  if (findingClosures === undefined) {
    return row;
  }
  return {
    ...row,
    findings: reviewFindingsPayloadFor({
      findings: row.findings ?? [],
      findingClosures,
    }),
  };
}

function mapTaskDependency(
  dependency: typeof taskDependencies.$inferSelect,
): TaskDependencyRecord {
  return {
    taskId: dependency.taskId,
    dependsOnTaskId: dependency.dependsOnTaskId,
  };
}

export class SqliteRepository implements MileStackRepository {
  constructor(
    private readonly db: MileStackDatabase,
    private readonly sqlite: BetterSqlite3.Database,
  ) {}

  findProjectById(id: string): ProjectRecord | null {
    const project = this.db.select().from(projects).where(eq(projects.id, id)).get();
    return project ? mapProject(project) : null;
  }

  findByRootPath(rootPath: string): ProjectRecord | null {
    const project = this.db
      .select()
      .from(projects)
      .where(eq(projects.rootPath, rootPath))
      .get();
    return project ? mapProject(project) : null;
  }

  findSingleProject(): ProjectRecord | null {
    const rows = this.db.select().from(projects).limit(2).all();
    return rows.length === 1 ? mapProject(rows[0]!) : null;
  }

  insert(project: ProjectRecord): ProjectRecord {
    return mapProject(this.db.insert(projects).values(project).returning().get());
  }

  findTaskById(id: string): TaskRecord | null {
    const task = this.db.select().from(tasks).where(eq(tasks.id, id)).get();
    return task ? mapTask(task) : null;
  }

  listByProjectId(projectId: string): TaskRecord[] {
    return this.db
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .orderBy(asc(tasks.createdAt))
      .all()
      .map(mapTask);
  }

  findLatestUpdatedAtByProjectId(projectId: string): string | null {
    const task = this.db
      .select({ updatedAt: tasks.updatedAt })
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .orderBy(desc(tasks.updatedAt))
      .limit(1)
      .get();
    if (!task) return null;

    const project = this.db
      .select({ createdAt: projects.createdAt, updatedAt: projects.updatedAt })
      .from(projects)
      .where(eq(projects.id, projectId))
      .get();
    // Project updates act as deletion cursors only after creation; an empty
    // project still has no latest task update.
    const projectUpdatedAt = project && project.updatedAt > project.createdAt
      ? project.updatedAt
      : null;
    return projectUpdatedAt && projectUpdatedAt > task.updatedAt
      ? projectUpdatedAt
      : task.updatedAt;
  }

  listByTaskId(taskId: string): TaskEventRecord[] {
    return this.db
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, taskId))
      .orderBy(asc(taskEvents.createdAt))
      .all()
      .map(mapTaskEvent);
  }

  listReviewsByTaskId(taskId: string): ReviewRecord[] {
    return this.db
      .select()
      .from(taskReviews)
      .where(eq(taskReviews.taskId, taskId))
      .orderBy(asc(taskReviews.reviewRound))
      .all()
      .map(mapReview);
  }

  listReviewsByProjectId(projectId: string): ReviewRecord[] {
    return this.db
      .select()
      .from(taskReviews)
      .where(eq(taskReviews.projectId, projectId))
      .orderBy(asc(taskReviews.taskId), asc(taskReviews.reviewRound))
      .all()
      .map(mapReview);
  }

  listDependenciesByProjectId(projectId: string): TaskDependencyRecord[] {
    return this.db
      .select({
        taskId: taskDependencies.taskId,
        dependsOnTaskId: taskDependencies.dependsOnTaskId,
      })
      .from(taskDependencies)
      .innerJoin(tasks, eq(taskDependencies.taskId, tasks.id))
      .where(eq(tasks.projectId, projectId))
      .orderBy(asc(taskDependencies.taskId), asc(taskDependencies.dependsOnTaskId))
      .all();
  }

  listDependenciesByTaskId(taskId: string): TaskDependencyRecord[] {
    return this.db
      .select()
      .from(taskDependencies)
      .where(eq(taskDependencies.taskId, taskId))
      .orderBy(asc(taskDependencies.dependsOnTaskId))
      .all()
      .map(mapTaskDependency);
  }

  transaction<T>(work: (transaction: TaskRepositoryTransaction) => T): T {
    return this.sqlite.transaction(() => {
      const transaction: TaskRepositoryTransaction = {
        findProjectById: (id) => {
          const project = this.db
            .select()
            .from(projects)
            .where(eq(projects.id, id))
            .get();
          return project ? mapProject(project) : null;
        },
        findTaskById: (id) => {
          const task = this.db.select().from(tasks).where(eq(tasks.id, id)).get();
          return task ? mapTask(task) : null;
        },
        listByProjectId: (projectId) =>
          this.db
            .select()
            .from(tasks)
            .where(eq(tasks.projectId, projectId))
            .orderBy(asc(tasks.createdAt))
            .all()
            .map(mapTask),
        listEventsByTaskId: (taskId) =>
          this.db
            .select()
            .from(taskEvents)
            .where(eq(taskEvents.taskId, taskId))
            .orderBy(asc(taskEvents.createdAt))
            .all()
            .map(mapTaskEvent),
        listReviewsByTaskId: (taskId) =>
          this.db
            .select()
            .from(taskReviews)
            .where(eq(taskReviews.taskId, taskId))
            .orderBy(asc(taskReviews.reviewRound))
            .all()
            .map(mapReview),
        listDependenciesByProjectId: (projectId) =>
          this.db
            .select({
              taskId: taskDependencies.taskId,
              dependsOnTaskId: taskDependencies.dependsOnTaskId,
            })
            .from(taskDependencies)
            .innerJoin(tasks, eq(taskDependencies.taskId, tasks.id))
            .where(eq(tasks.projectId, projectId))
            .orderBy(
              asc(taskDependencies.taskId),
              asc(taskDependencies.dependsOnTaskId),
            )
            .all(),
        updateTask: (id, changes, expectedStatus) => {
          const conditions = [eq(tasks.id, id)];
          if (expectedStatus) {
            conditions.push(eq(tasks.status, expectedStatus));
          }
          const updated = this.db
            .update(tasks)
            .set(changes)
            .where(and(...conditions))
            .returning()
            .get();
          return updated ? mapTask(updated) : null;
        },
        updateProject: (id, changes) => {
          const updated = this.db
            .update(projects)
            .set(changes)
            .where(eq(projects.id, id))
            .returning()
            .get();
          return updated ? mapProject(updated) : null;
        },
        deleteTask: (id) => {
          this.db.delete(tasks).where(eq(tasks.id, id)).run();
        },
        insertTask: (task) =>
          mapTask(this.db.insert(tasks).values(task).returning().get()),
        insertTaskEvent: (event) =>
          mapTaskEvent(
            this.db
              .insert(taskEvents)
              .values(taskEventRow(event))
              .returning()
              .get(),
          ),
        insertReview: (review) =>
          mapReview(
            this.db
              .insert(taskReviews)
              .values(reviewRow(review))
              .returning()
              .get(),
          ),
        updateReview: (id, changes) => {
          const updated = this.db
            .update(taskReviews)
            .set(updateReviewRow(changes))
            .where(eq(taskReviews.id, id))
            .returning()
            .get();
          return updated ? mapReview(updated) : null;
        },
        replaceTaskDependencies: (taskId, dependencyIds) => {
          this.db
            .delete(taskDependencies)
            .where(eq(taskDependencies.taskId, taskId))
            .run();
          if (dependencyIds.length > 0) {
            this.db
              .insert(taskDependencies)
              .values(
                dependencyIds.map((dependsOnTaskId) => ({
                  taskId,
                  dependsOnTaskId,
                })),
              )
              .run();
          }
        },
      };
      return work(transaction);
    }).immediate();
  }
}

export function createSqliteRepository(database: {
  db: MileStackDatabase;
  sqlite: BetterSqlite3.Database;
}): SqliteRepository {
  return new SqliteRepository(database.db, database.sqlite);
}
