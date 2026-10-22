export type WorkspaceErrorCode =
  | "INVALID_TEMPLATE"
  | "INVALID_PATH"
  | "NOT_FOUND"
  | "EXISTS"
  | "NOT_A_WORKSPACE"
  | "UNSAFE"
  | "TOO_LARGE"
  | "LIMIT_EXCEEDED"
  | "UNSUPPORTED"
  | "STORAGE_IO";

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;

  constructor(code: WorkspaceErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
  }
}

export function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}
