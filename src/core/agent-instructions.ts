const taskDiscoveryRule =
  "When no taskId is known, call get_project_status, select the first task in next with runnable=true, and then call get_task for its working context. Request view=full only when the complete audit history is needed.";
const knownTaskRule =
  "When a developer or task brief provides a taskId, call get_task directly; do not call get_project_status first.";
const taskClaimRule =
  "After reading the task details and confirming that its status is ready, call start_task and save the returned runId.";
const taskClaimValidationRule =
  "start_task is the final atomic claim boundary: the server validates task status, developer-confirmed risk, completed dependencies, and concurrent claims. Do not expect get_task to expose runnable.";
const taskCreationReadinessRule =
  "Before creating a task, confirm you can state what the developer will observe when it is done, what is explicitly out of scope, and how to verify it. If unclear requirements prevent any of these, ask the developer instead of filling them in. Ask a small batch of targeted questions at once and give each a recommended default answer; do not re-ask what is already clear or can be discovered from code or documentation. If an answer is unavailable, record the unconfirmed point as an explicitly labeled assumption in the objective or acceptance criteria for inbox review instead of silently treating it as agreed.";
const proposedTaskRule =
  "When implementation or review finds work outside the current task, do not call create_task or create_tasks yourself. List it as a proposed new task with a title and a one-sentence reason: an implementation agent records it in the progress handoff or submission summary, a review agent records it in the review conclusion summary, and both list it in the final reply to the developer. Create the task only after the developer confirms it in the conversation. When the developer explicitly asks you to create tasks, for example during planning or after confirming page comments, create them as usual; the task-creation readiness check still applies.";
const scopeExpansionRule =
  "Do not expand scope silently. Put related work into the active task only when it fits the objective and acceptance criteria; otherwise propose it as a new task instead of creating it yourself.";
const deferredFullRegressionCreationRule =
  "When the root AGENTS.md assigns repository-wide full regression to the integration or merge stage, do not put generic full-suite tests into ordinary single-task acceptance criteria (include full regression only when the task itself directly affects global behavior and requires early regression).";
export const layeredVerificationRule =
  "Follow any tiered verification strategy defined in the repository root AGENTS.md: when the root AGENTS.md schedules repository-wide full regression at the target-branch merge stage, task-branch verification only needs to verify all task acceptance criteria and the project's defined change-related scope, and does not require rerunning the full regression suite on the task branch unless the task itself explicitly requires it.";
const taskCreationRule = `${taskCreationReadinessRule} Create inbox tasks only for independently verifiable outcomes. State a verifiable objective and acceptance criteria that each describe one independently checkable result as scenario, expected result, and verification. Scale the number of criteria to the task's size and risk, and do not add separate criteria for generic regression checks already required by the root AGENTS.md or review. ${deferredFullRegressionCreationRule} Preserve developer-confirmed examples and UI hierarchy, ordering, and state behavior as acceptance constraints. Include same-project dependencyIds and explain each dependency in the objective or acceptance criteria. State file or module ownership and exclusions only for planned parallel work, and do not copy the general workflow, review, risk, or Git rules into each task.`;
const pageCommentsRule =
  "When the developer pastes page comments, organize them first and ask the developer to confirm decision points, each with a recommended answer, before creating tasks or editing code.";
const inboxEditRule =
  "Use edit_inbox_task only to correct an inbox task definition. Call get_task first and pass the returned updatedAt as expectedUpdatedAt; the edit is rejected if the task changed since it was read, so call get_task again before retrying. This tool cannot change risk level or risk confirmation and cannot edit ready or later tasks. Use update_task for run-scoped progress instead.";
const taskSubmissionRule =
  `After the acceptance criteria and required verification pass, call submit_for_review with an exact 40-character commit SHA and exactly one delivery result per acceptance criterion, filed under the criterion id returned by get_task (met, not_met, or unverifiable; met requires at least one recorded command and result). ${layeredVerificationRule} Submission moves the task to in_review and invalidates the execution runId.`;
const implementationStopRule =
  "The implementation agent stops after a successful submit_for_review: do not call start_review, approve_review, request_changes, or complete_review, and do not spawn a subagent, new session, or any other reviewer context to review the task you just submitted.";
const reviewEntryRule =
  "Review starts only when the developer sends the task ID to an independent review agent. Call get_task with that taskId and confirm phase=review, then call start_review and save the returned reviewRunId before inspecting the submitted artifact. Review the exact commit recorded in the latest submission, verify every acceptance criterion independently, and record a closure for every finding from a changes-requested previous round. Conclude with approve_review, request_changes, or complete_review using the reviewRunId, then stop.";
const reviewVerificationCoreRule =
  `independently reproduce the key verification for each acceptance criterion and the project's defined change-related scope. ${layeredVerificationRule}`;
const reviewDimensionRule =
  `Do not accept the submitter's criteriaResults as review evidence: ${reviewVerificationCoreRule} Inspect the reviewed diff for changes outside the task objective and acceptance criteria, and check the work against the repository root AGENTS.md. Record each finding with a low, medium, or high severity for developer triage, but severity does not permit a pass: a review cannot pass while any submitted criterion is not_met or unverifiable or any previous finding remains not_fixed or partially_fixed.`;
const reReviewApproachRule =
  "When re-reviewing after changes were requested, start from the incremental diff: the get_task default view returns the previous round's review round and commit SHA next to previousFindings, so first compare that previous commit with the current submission's commit to locate what changed. Close every previous finding one by one, and still independently verify every acceptance criterion. The incremental diff only locates changes; it never replaces independent verification of every acceptance criterion and the project's defined task-branch verification scope.";
const integrationRule =
  "Required local Git integration is checked against the fixed review commit and the developer-confirmed local target branch. A low-risk task may complete automatically only after that check; medium- and high-risk tasks require developer approval and the same integration gate.";
const batchIntegrationRetryRule =
  "When multiple accepted tasks have been batch-merged into the local target branch, call check_tasks_integration with each task's { taskId, expectedReviewId } to run read-only integration checks and archive integrated items together without merging, fetching, or pushing.";
const integrationRetryRule =
  `For a task that is already accepted and still waiting for local integration, call check_task_integration with its latest review id after the developer has completed any authorized local merge. This is a separate integration retry, not a continuation of the implementation agent's work after submission. ${batchIntegrationRetryRule}`;

export const acceptanceCriteriaCreationCheck =
  "When creating a task, check that each acceptance criterion describes one independently verifiable delivery result, has a corresponding verification, and does not smuggle in an unconfirmed implementation restriction.";

export const taskCreationReadinessPrompt =
  "Before creating a task, confirm you can state the observable outcome, explicit exclusions, and verification. If unclear requirements prevent that, ask the developer instead of filling it in.";

export const projectAgentInstructionsPath = ".milestack/agent-instructions.md";

export const rootAgentInstructionsFile = "AGENTS.md";

export const agentInstructionsToolName = "get_agent_instructions";

export const rootAgentInstructionSnippet = `Before working on tasks, read and follow \`${projectAgentInstructionsPath}\`; if it is missing, call the MileStack MCP tool ${agentInstructionsToolName}.`;

const missingInstructionsFileRule = `If ${projectAgentInstructionsPath} is missing in the current checkout, for example in a worktree or checkout where milestack init has not run, call ${agentInstructionsToolName} to read the same full instructions from this MCP server.`;

export function formatProjectAgentInstructions(version: string): string {
  return [
    `<!-- Generated by MileStack milestack init; source: MileStack ${version}; version: ${version}. -->`,
    "# MileStack Agent Instructions",
    "",
    "This file is generated by milestack init for the local project workflow. It centralizes MileStack task discovery, claiming, execution, review, risk, isolation, and Git rules. Task records should contain only task-specific objectives, acceptance criteria, dependencies, and execution boundaries.",
    "",
    "## Scope and instruction precedence",
    "",
    "- Treat MileStack as the source of truth for task state and semantic progress. Do not create parallel TODO, progress, planning, or handoff documents that duplicate MileStack state.",
    "- This file lives under the locally ignored .milestack/ directory. Every developer must run milestack init in each checkout, and generated content should not be edited by hand.",
    `- Add this line manually to the version-controlled root AGENTS.md: ${rootAgentInstructionSnippet} milestack init never creates, overwrites, or appends to the root AGENTS.md.`,
    "- This generated file does not automatically apply to repository source merely because it is under .milestack/. Keep durable project-specific architecture, testing, and delivery rules in the root AGENTS.md or durable project documentation.",
    "- Follow the root AGENTS.md together with this file. If a project rule conflicts with the current MileStack tool contract, stop and ask the developer instead of guessing.",
    "- Modify only the files and modules owned by the current task. Preserve unrelated developer and agent changes.",
    "",
    "## Create well-scoped tasks",
    "",
    `- ${taskCreationReadinessRule}`,
    `- ${proposedTaskRule}`,
    "- Every task must state a verifiable objective, complete acceptance criteria, and same-project dependencyIds.",
    "- Put the task-specific execution boundary in the objective or acceptance criteria: required verification commands and expected results, and the delivery form such as a local commit or review artifact. For planned parallel work, also define non-overlapping file or module ownership and explicitly excluded areas. Do not copy the general workflow, review, risk, or Git rules from this file into every task.",
    "",
    "## Preserve concrete task constraints",
    "",
    "When creating or updating a MileStack task, preserve developer-confirmed concrete examples as part of the task definition.",
    "",
    "- Do not replace an approved wireframe, layout sketch, field mapping, workflow, example input/output, ordering rule, or state-specific behavior with only an abstract summary.",
    "- Record both:",
    "  1. the design intent; and",
    "  2. the observable example or concrete structure that constrains implementation.",
    "- For UI work, explicitly preserve information hierarchy, element ordering, grouping, conditional visibility, responsive behavior, and permitted deviations.",
    "- Treat developer-confirmed examples as acceptance constraints unless the developer says they are illustrative only.",
    "- Before creating the task, check that every material constraint from the approved proposal appears in the objective or acceptance criteria.",
    "- Keep concrete examples concise, but prefer slight duplication over losing a requirement through abstraction.",
    "",
    "## Calibrate task specificity",
    "",
    "- Make task definitions concrete about observable behavior, developer-confirmed examples, external contracts, architectural boundaries, compatibility requirements, and verification outcomes.",
    "- Do not invent or prescribe internal file lists, private functions, helper types, algorithms, test fixture names, or implementation steps unless the developer confirmed them, an existing public contract requires them, or they are necessary for architecture or safety.",
    "- Write every acceptance criterion by default as scenario, expected result, and verification, with one independently checkable result per criterion. Scenario is the trigger or starting condition; expected result is the observable behavior, deliverable, or confirmed structural requirement; verification is how to obtain evidence. A simple task may state the same in one sentence without the three labels.",
    `- Scale the number of acceptance criteria to the task's size and risk; a small change usually needs one to three. Do not write separate criteria for generic regression checks that the root AGENTS.md or the review already require, such as unrelated commands staying unchanged, no new dependencies, or the standard typecheck, test, and build commands. Add such a check only when this task specifically puts that behavior at risk, and keep required verification commands in the verification of the criteria they prove. ${deferredFullRegressionCreationRule}`,
    "- Include only developer-confirmed requirements, existing contracts, and necessary architecture or safety boundaries. Distinguish acceptance constraints from implementation suggestions: do not write unconfirmed implementation suggestions as acceptance criteria; omit unconfirmed implementation ideas or label them explicitly as non-binding.",
    "- Example of an unconfirmed implementation suggestion that must not become a criterion: “Create `createPhoneBindingPage` in `domain/phone-binding.js`.” State the confirmed observable result instead.",
    "- Example of a behavior criterion: “Scenario: a verification code has been sent. Expected result: resend is unavailable during the countdown and available after it ends. Verification: a page behavior test controls time and checks the send button state.”",
    "- Example of a confirmed structural requirement: when the developer explicitly requires a native Page, keep it in the criterion, for example “Scenario: the page is opened. Expected result: it is a native Page. Verification: inspect the registered page type.”",
    "- Treat developer-confirmed UI layouts, field order, workflows, state behavior, and API/protocol fields as mandatory acceptance constraints; do not downgrade them because they are concrete.",
    `- ${acceptanceCriteriaCreationCheck}`,
    "",
    "## Handle page comments",
    "",
    "Comments the developer pastes from the MileStack bookmarklet or any other comment tool are handled the same way. Organize them before editing code.",
    "",
    "- Organize first, without changing code: locate every comment in the code; merge comments that ask for the same change; separate requests that change data, an API, or validation from the visual change; and point out where the code and what the developer saw disagree and need the developer's confirmation.",
    "- Ask the developer in one batch about directional feedback, how the work should be split, and anything ambiguous, and attach a recommended answer to every question.",
    "- Create tasks only after the developer confirms the answers, and record the confirmed decisions in the task.",
    "- Organize acceptance criteria by change, not by comment: one criterion may cover several comments that ask for the same adjustment.",
    "- Account for every comment: map it to an acceptance criterion, split it into another task, or state why it will not be done. Keep the original comment text in the task so the adjustment stays traceable.",
    "- The developer accepts the visual result on the page. When something still looks wrong, they add page comments again and the same flow applies.",
    "",
    "## Discover, claim, and execute work",
    "",
    `- ${taskDiscoveryRule}`,
    `- ${knownTaskRule}`,
    `- ${taskClaimRule} ${taskClaimValidationRule}`,
    "- If start_task fails, do not begin implementation. Report the returned state, dependency, risk, or ownership error and wait for the required action.",
    "- Use the current runId for update_task and submit_for_review. Never reuse a credential after submission, requested changes, or reopen.",
    "- Record meaningful milestones and handoffs, not every command, tool call, or individual file edit.",
    `- ${scopeExpansionRule}`,
    "- To correct an inbox task definition, call get_task for the latest updatedAt, then call edit_inbox_task with the complete definition and that updatedAt as expectedUpdatedAt. The edit is rejected if the task changed since it was read. This tool cannot change risk level or risk confirmation and cannot edit ready or later tasks; use update_task for run-scoped progress instead.",
    "- actorLabel is optional. Use agent when no model label is available. Labels are audit metadata only and do not establish identity, authority, or reviewer independence.",
    "",
    "## Default branch and worktree",
    "",
    "- Implement every claimed task in its own Git worktree by default; runnable=true only means a task is claimable, and never run two writing agents in the same working tree.",
    "- First implementation: after start_task, create a local branch named task/<short task ID>-<short description> together with a linked Git worktree, based on the local latest commit of the task's integration target branch, or of the main checkout's current branch when the task does not require integration, and implement inside that worktree.",
    "- Work directly in the current checkout instead of creating a branch and worktree only when the developer explicitly asks for it, or when the project is not a Git repository.",
    "- Rework after requested changes: do not create a new branch. Return to the branch and worktree recorded by the previous round's submission and append commits there; the get_task working view exposes them as latestSubmission.review.branch and latestSubmission.review.worktree. When that worktree no longer exists, recreate a worktree for the same branch.",
    "- In a new worktree, install dependencies from the local package cache first: pnpm install --frozen-lockfile --offline, falling back to pnpm install --frozen-lockfile --prefer-offline, or npm ci --prefer-offline for npm projects. Go online only when the lockfile needs packages the local cache does not have.",
    "- Record the actual branch and worktree with the review submission. When an isolated worktree cannot be created, stop and report the blocker instead of editing the current checkout; implement there only after the developer explicitly authorizes it. Running implementations serially or coordinating file ownership is parallel-safety advice only and never authorizes skipping worktree isolation.",
    "- Integration or merge work is a separate step. Do not merge task branches or change shared branches without explicit developer authorization.",
    "",
    "## Submit a fixed artifact",
    "",
    "- Submit only after the task-specific acceptance criteria and required verification pass. Use submit_for_review with an existing full 40-character commit SHA and record the actual branch and worktree when available.",
    `- ${layeredVerificationRule}`,
    "- Before submission, verify git cat-file -e <commitSha>^{commit}. Uncommitted working-tree changes are not part of the review artifact.",
    "- Submission invalidates the execution runId. Further implementation after requested changes requires a new start_task claim and a new review round.",
    "- Stop after a successful submit_for_review. Do not call start_review, approve_review, request_changes, or complete_review, and do not spawn a subagent, new session, or any other reviewer context to review the task you just submitted. Review starts only when the developer sends that task ID to an independent review agent.",
    "- For tasks whose confirmed delivery condition requires local Git integration, review or approval alone is not delivery. Completion requires the fixed reviewed commit to be verifiably present on the developer-confirmed local target branch, or the developer to explicitly record that Git integration is not required. This proves local integration only, not push, release, or deployment.",
    "- If the current task workflow cannot record or verify a required integration check, state the missing evidence and next action instead of claiming integration or completion. Do not merge, fetch, push, or deploy without explicit developer authorization.",
    "",
    "## Perform an independent review",
    "",
    "- Review work is assigned by the developer. Perform this section only after the developer sends the task ID to you as an independent review agent; do not select a pending review task from the queue yourself.",
    "- Review the exact submitted commit, not an uncommitted working tree or a moving branch tip. actorLabel alone does not prove independence.",
    "- Call start_review(taskId, actorLabel?) to atomically claim the latest pending review and save its independent reviewRunId. Never substitute the implementer's runId.",
    `- Do not accept the submitter's criteriaResults as review evidence: ${reviewVerificationCoreRule} Inspect the reviewed diff for changes outside the task objective and acceptance criteria, and check the work against the repository root AGENTS.md.`,
    "- A passing review must record the commands actually run and their results. Do not claim verification that was not performed. A review cannot pass while a submitted acceptance criterion is not_met or unverifiable.",
    "- Use approve_review(taskId, reviewRunId, summary, findings, verificationEvidence, actorLabel?) or complete_review with decision=passed to pass a review.",
    "- Use request_changes(taskId, reviewRunId, summary, findings, actorLabel?) or complete_review with decision=changes_requested to return work. Every new finding must record a concrete issue, an actionable suggestion, a severity, a trigger condition, an observable impact, and evidence; add a location when one can be identified.",
    `- ${reReviewApproachRule}`,
    "- When re-reviewing a round that requested changes, record a closure status (fixed, partially_fixed, not_fixed, unverifiable, or invalidated) for every previous finding. A review cannot pass while a previous finding remains not_fixed or partially_fixed.",
    "- request_changes returns the task to ready and invalidates old execution and review credentials. Rework must be claimed with a new runId and submitted as a new fixed commit.",
    "",
    "## Apply the risk policy",
    "",
    "- low: risk must already be developer-confirmed. An independent AI pass with at least one verification command and result may complete the task automatically after the required local integration check passes.",
    "- medium: an AI pass records review_passed but leaves the task in in_review until a developer approves the latest passed review round.",
    "- high: explicit developer risk confirmation is required. An AI pass still leaves the task in in_review until a developer approves the latest passed review round.",
    "- Agents must not confirm, lower, or bypass a task's risk level on behalf of a developer.",
    `- If a review is accepted but local integration is pending or unavailable, retain its approval facts and use check_task_integration with the latest review id to retry after the developer has completed any authorized local merge. ${batchIntegrationRetryRule} Do not claim completion until the task status is completed.`,
    "",
    "## Git and delivery authority",
    "",
    "- Keep review artifacts local unless the developer explicitly authorizes a push. Do not push, merge, or modify a shared remote branch without that authorization.",
    "- Do not use short SHAs, invented references, or uncommitted snapshots as review artifacts.",
    "- Before handing off, confirm the task-specific acceptance criteria, verification results, resolvable commit SHA, remaining risks, and next required action are recorded in MileStack. Review evidence, findings, and the risk conclusion belong to the independent review agent that receives this task ID from the developer.",
    "",
  ].join("\n");
}

export function formatAgentIntegrationInstructions(): string {
  return [
    "MILESTACK_START",
    `- ${rootAgentInstructionSnippet}`,
    "- Treat MileStack as the source of truth for task state and semantic progress; do not maintain duplicate TODO, progress, planning, or handoff documents.",
    `- ${projectAgentInstructionsPath} is generated by milestack init and centralizes task discovery, claiming, execution, review, risk, isolation, and Git rules. The MCP tool ${agentInstructionsToolName} returns the same content.`,
    "- Run milestack init in every local checkout. It never creates, overwrites, or appends to the root AGENTS.md.",
    "MILESTACK_END",
  ].join("\n");
}

export function formatMcpInstructions(): string {
  return [
    `Local instructions file: ${missingInstructionsFileRule}`,
    `Page comments: ${pageCommentsRule}`,
    `Task creation: ${taskCreationRule} ${proposedTaskRule}`,
    `Inbox edits: ${inboxEditRule}`,
    `Task discovery: ${taskDiscoveryRule}`,
    `Known task: ${knownTaskRule}`,
    `Claiming: ${taskClaimRule} ${taskClaimValidationRule}`,
    `Submission: ${taskSubmissionRule}`,
    `Implementation stop: ${implementationStopRule}`,
    `Review entry: ${reviewEntryRule}`,
    `Review dimensions: ${reviewDimensionRule}`,
    `Re-review: ${reReviewApproachRule}`,
    `Review outcome: ${integrationRule}`,
    `Accepted task awaiting local integration: ${integrationRetryRule}`,
  ].join("\n");
}

export function formatKnownTaskBriefInstructions(taskId: string): string {
  return [
    "This brief already provides a taskId, so use the known-task flow:",
    `1. Call get_task directly with taskId \u0060${taskId}\u0060. Do not call get_project_status first.`,
    "2. Read the objective, acceptance criteria, dependencies, history, current handoff, and status before acting.",
    `3. If the task status is ready, call start_task with taskId \u0060${taskId}\u0060 and save the returned runId. ${taskClaimValidationRule}`,
    "4. If the claim fails, do not modify the project; report the returned error and required action.",
    "5. Record meaningful progress with update_task and the current runId. Include a summary and, when they change, currentStep and nextStep.",
    "6. If you are blocked or cannot continue, call update_task with the current runId, blocker, requiredAction, and handoffNote, then stop. Do not invent a separate release or block tool.",
    "7. After the acceptance criteria and required verification pass, call submit_for_review with the current runId, an existing full 40-character commit SHA, the actual branch and worktree, and exactly one delivery result per acceptance criterion filed under the criterion id returned by get_task (met, not_met, or unverifiable; met requires recorded evidence). Submission moves the task to in_review and invalidates the runId. Stop after a successful submit_for_review: do not call start_review, approve_review, request_changes, or complete_review, and do not spawn a subagent, new session, or any other reviewer context to review this task. The developer sends this task ID to an independent review agent for the next step.",
  ].join("\n");
}
