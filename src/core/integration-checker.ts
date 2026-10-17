export type IntegrationCheckInput = {
  commitSha: string;
  targetBranch: string;
};

export type IntegrationCheckResult =
  | { status: "integrated"; targetCommitSha: string }
  | {
      status: "not_integrated" | "unavailable";
      message: string;
      targetCommitSha?: string | null;
    };

/** The checker is bound to one project outside core and performs local read-only Git checks. */
export interface IntegrationChecker {
  check(input: IntegrationCheckInput): IntegrationCheckResult;
}
