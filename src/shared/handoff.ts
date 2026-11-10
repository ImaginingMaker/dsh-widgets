/** The project the handed-off session belongs to. `workspaceId` is present when the host resolved one. */
export interface HandoffProject {
  readonly cwd?: string;
  readonly workspaceId?: string;
  readonly title?: string;
}

/** The Host's answer to one handoff: the new session it created and the note it sent there. */
export interface HandoffResult {
  readonly sessionId: string;
  readonly handoff: string;
  readonly project: HandoffProject;
}