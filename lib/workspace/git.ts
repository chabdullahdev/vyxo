import { execFile } from "node:child_process";
import { access, realpath, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { classifyProjectFilePath } from "../project/policy.ts";
import { WorkspaceError } from "./errors.ts";

/**
 * Git for a workspace project: save snapshots on this Mac, and push them to a remote the user
 * chooses (GitHub by default). VYXO uses the person's own Git and GitHub sign-in and stores no
 * credentials. Private files (keys, .env files, build output) are kept out of every snapshot.
 */

export const GIT_TIMEOUT_MS = 90_000;
/** An app opened from Finder has a short search path, so the usual install folders are added. */
const TOOL_FOLDERS =
  process.platform === "win32"
    ? ["C:\\Program Files\\Git\\cmd", "C:\\Program Files\\GitHub CLI"]
    : ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];

function toolEnvironment(): NodeJS.ProcessEnv {
  const current = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  return { ...process.env, PATH: [...new Set([...current, ...TOOL_FOLDERS])].join(delimiter), GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
}
const DEFAULT_BRANCH = "main";
const STATUS_LINES = 60;
const RECENT_COMMITS = 8;

/** Ignored by every new repository: build output, caches, the packages link, VYXO's bookkeeping, and secrets. */
export const GITIGNORE = `# Written by VYXO. Build output, caches, and private files stay out of snapshots.
node_modules
.next
out
.vyxo
.env
.env.*
*.pem
*.key
`;

export interface GitIdentity {
  name: string;
  email: string;
}

export interface GitCommit {
  hash: string;
  subject: string;
  date: string;
}

export interface GitStatus {
  repository: boolean;
  branch: string | null;
  changes: string[];
  changeCount: number;
  commits: GitCommit[];
  remote: string | null;
  identityReady: boolean;
}

export interface GitRunResult {
  stdout: string;
  stderr: string;
}

export type GitRunner = (args: string[], cwd: string) => Promise<GitRunResult>;

/** Runs git with arguments as a list (never a shell string), without prompting for passwords. */
export const runGit: GitRunner = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...toolEnvironment(), GIT_ASKPASS: "" },
      },
      (error, stdout, stderr) => {
        if (error) {
          const failure = new WorkspaceError("STORAGE_IO", friendlyGitError(String(stderr || error.message)));
          reject(failure);
        } else {
          resolve({ stdout: String(stdout), stderr: String(stderr) });
        }
      },
    );
  });

/** Turns git's messages into the one thing a person needs to do next. Raw output is never shown. */
export function friendlyGitError(stderr: string): string {
  const text = stderr.toLowerCase();
  if (text.includes("could not read username") || text.includes("authentication failed") || text.includes("permission denied")) {
    return "GitHub did not accept this Mac's sign-in. Open Terminal, run gh auth login, then try again.";
  }
  if (text.includes("repository not found") || text.includes("does not appear to be a git repository")) {
    return "The repository could not be found. Check the address, or create the repository on GitHub first.";
  }
  if (text.includes("could not resolve host") || text.includes("unable to access")) {
    return "The internet connection or the repository address failed. Check your connection and try again.";
  }
  if (text.includes("non-fast-forward") || text.includes("fetch first") || text.includes("rejected")) {
    return "The remote has changes this project does not have. Pull them first, or push to a new repository.";
  }
  if (text.includes("please tell me who you are") || text.includes("unable to auto-detect email")) {
    return "Add your name and email for Git first.";
  }
  return "Git could not finish this step. Try again.";
}

async function folderIsRepositoryRoot(folder: string, run: GitRunner): Promise<boolean> {
  try {
    const { stdout } = await run(["rev-parse", "--show-toplevel"], folder);
    return (await realpath(stdout.trim())) === (await realpath(folder));
  } catch {
    return false;
  }
}

async function identityConfigured(folder: string, run: GitRunner): Promise<boolean> {
  try {
    const name = await run(["config", "user.name"], folder);
    const email = await run(["config", "user.email"], folder);
    return name.stdout.trim().length > 0 && email.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function gitStatus(folder: string, run: GitRunner = runGit): Promise<GitStatus> {
  if (!(await folderIsRepositoryRoot(folder, run))) {
    return { repository: false, branch: null, changes: [], changeCount: 0, commits: [], remote: null, identityReady: false };
  }
  const branch = (await run(["branch", "--show-current"], folder)).stdout.trim() || null;
  const porcelain = (await run(["status", "--porcelain"], folder)).stdout.split("\n").filter((line) => line.trim().length > 0);
  let commits: GitCommit[] = [];
  try {
    const log = (await run(["log", `-${RECENT_COMMITS}`, "--pretty=format:%h%x1f%s%x1f%cI"], folder)).stdout;
    commits = log
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const [hash, subject, date] = line.split("\u001f");
        return { hash, subject, date };
      });
  } catch {
    // A repository with no snapshots yet.
  }
  let remote: string | null = null;
  try {
    remote = (await run(["remote", "get-url", "origin"], folder)).stdout.trim() || null;
  } catch {
    remote = null;
  }
  return {
    repository: true,
    branch,
    changes: porcelain.slice(0, STATUS_LINES).map((line) => line.slice(3)),
    changeCount: porcelain.length,
    commits,
    remote,
    identityReady: await identityConfigured(folder, run),
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Refuse to save a snapshot that contains private files. The staged files are unstaged again first. */
async function refuseIfPrivate(folder: string, run: GitRunner): Promise<void> {
  const staged = (await run(["diff", "--cached", "--name-only", "-z"], folder)).stdout.split("\u0000").filter(Boolean);
  const blocked = staged.filter((path) => classifyProjectFilePath(path) !== "allowed");
  if (blocked.length > 0) {
    await run(["reset", "-q"], folder).catch(() => undefined);
    throw new WorkspaceError(
      "UNSAFE",
      `These files look private, so they were not saved: ${blocked.slice(0, 5).join(", ")}. Move them out of the project or add them to .gitignore.`,
    );
  }
}

async function setIdentity(folder: string, identity: GitIdentity | null, run: GitRunner): Promise<void> {
  if (!identity) return;
  const name = identity.name.trim();
  const email = identity.email.trim();
  if (name.length === 0 || email.length === 0 || name.length > 100 || email.length > 200) {
    throw new WorkspaceError("INVALID_PATH", "Enter a name and an email for your snapshots.");
  }
  await run(["config", "user.name", name], folder);
  await run(["config", "user.email", email], folder);
}

/** Start version tracking for the project and save its current files as the first snapshot. */
export async function gitInit(folder: string, identity: GitIdentity | null, run: GitRunner = runGit): Promise<GitStatus> {
  if (!(await folderIsRepositoryRoot(folder, run))) {
    await run(["init", "-q", "-b", DEFAULT_BRANCH], folder);
  }
  if (!(await exists(join(folder, ".gitignore")))) {
    await writeFile(join(folder, ".gitignore"), GITIGNORE, { encoding: "utf8", mode: 0o600 });
  }
  await setIdentity(folder, identity, run);
  if (!(await identityConfigured(folder, run))) {
    throw new WorkspaceError("INVALID_PATH", "Enter a name and an email for your snapshots.");
  }
  await run(["add", "-A"], folder);
  await refuseIfPrivate(folder, run);
  const hasCommits = await run(["rev-parse", "--verify", "-q", "HEAD"], folder).then(() => true, () => false);
  if (!hasCommits || (await run(["status", "--porcelain"], folder)).stdout.trim().length > 0) {
    await run(["commit", "-q", "-m", "Start project"], folder);
  }
  return gitStatus(folder, run);
}

/** Save a snapshot of everything that changed. */
export async function gitSnapshot(folder: string, message: string, run: GitRunner = runGit): Promise<GitStatus> {
  const subject = message.replace(/[\r\n]+/g, " ").trim().slice(0, 120) || "Update project";
  if (!(await identityConfigured(folder, run))) {
    throw new WorkspaceError("INVALID_PATH", "Set your name and email for Git first.");
  }
  await run(["add", "-A"], folder);
  if ((await run(["diff", "--cached", "--name-only"], folder)).stdout.trim().length === 0) {
    throw new WorkspaceError("NOT_FOUND", "Nothing has changed since the last snapshot.");
  }
  await refuseIfPrivate(folder, run);
  await run(["commit", "-q", "-m", subject], folder);
  return gitStatus(folder, run);
}

/** Connect the project to a remote repository. Only web and SSH addresses are accepted. */
export function checkRemoteAddress(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0 || trimmed.length > 300) {
    throw new WorkspaceError("INVALID_PATH", "Enter the repository address.");
  }
  if (!/^(https:\/\/|ssh:\/\/|git@)[A-Za-z0-9._@:/~-]+$/.test(trimmed)) {
    throw new WorkspaceError("INVALID_PATH", "The address must start with https://, ssh://, or git@.");
  }
  return trimmed;
}

export async function gitSetRemote(folder: string, url: string, run: GitRunner = runGit): Promise<GitStatus> {
  const address = checkRemoteAddress(url);
  const hasOrigin = await run(["remote", "get-url", "origin"], folder).then(() => true, () => false);
  await run(hasOrigin ? ["remote", "set-url", "origin", address] : ["remote", "add", "origin", address], folder);
  return gitStatus(folder, run);
}

/** Create a private GitHub repository with the GitHub CLI the person already signed in to, and connect it. */
export async function gitCreateGithubRepository(
  folder: string,
  name: string,
  run: GitRunner = runGit,
): Promise<GitStatus> {
  const slug = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  if (slug.length === 0) throw new WorkspaceError("INVALID_PATH", "Choose a name for the repository.");
  const created = await new Promise<GitRunResult>((resolve, reject) => {
    execFile(
      "gh",
      ["repo", "create", slug, "--private", "--description", "Made with VYXO"],
      { cwd: folder, timeout: GIT_TIMEOUT_MS, env: { ...toolEnvironment(), GH_PROMPT_DISABLED: "1" } },
      (error, stdout, stderr) => {
        if (error) {
          const text = String(stderr || error.message).toLowerCase();
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            reject(new WorkspaceError("UNSUPPORTED", "The GitHub command-line tool (gh) is not installed. Install it from cli.github.com, then try again."));
          } else if (text.includes("already exists")) {
            reject(new WorkspaceError("EXISTS", "A repository with this name already exists on your GitHub account. Choose another name, or connect it by its address."));
          } else if (text.includes("not logged") || text.includes("gh auth login")) {
            reject(new WorkspaceError("UNSAFE", "Sign in to GitHub first: open Terminal, run gh auth login, then try again."));
          } else {
            reject(new WorkspaceError("STORAGE_IO", "The GitHub repository could not be created. Try again."));
          }
        } else {
          resolve({ stdout: String(stdout), stderr: String(stderr) });
        }
      },
    );
  });
  const url = created.stdout.trim().split(/\s+/).pop() ?? "";
  if (!/^https:\/\/github\.com\//.test(url)) {
    throw new WorkspaceError("STORAGE_IO", "The GitHub repository was created, but its address was not found. Connect it by address.");
  }
  return gitSetRemote(folder, `${url}.git`, run);
}

export async function gitPush(folder: string, run: GitRunner = runGit): Promise<GitStatus> {
  const status = await gitStatus(folder, run);
  if (!status.repository) throw new WorkspaceError("NOT_FOUND", "Set up Git for this project first.");
  if (!status.remote) throw new WorkspaceError("NOT_FOUND", "Connect a GitHub repository first.");
  if (!status.branch) throw new WorkspaceError("NOT_FOUND", "There is no snapshot to push yet.");
  await run(["push", "-q", "-u", "origin", status.branch], folder);
  return gitStatus(folder, run);
}
