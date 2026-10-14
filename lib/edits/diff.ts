import { DIFF_MAX_LINES, type DiffLine, type FileDiff } from "./types.ts";

const MAX_LCS_CELLS = 1_000_000;

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function lcsDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const n = oldLines.length;
  const m = newLines.length;
  const table: Int32Array[] = [];
  for (let i = 0; i <= n; i += 1) table.push(new Int32Array(m + 1));

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] =
        oldLines[i] === newLines[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      lines.push({ type: "context", text: oldLines[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push({ type: "removed", text: oldLines[i] });
      i += 1;
    } else {
      lines.push({ type: "added", text: newLines[j] });
      j += 1;
    }
  }
  while (i < n) {
    lines.push({ type: "removed", text: oldLines[i] });
    i += 1;
  }
  while (j < m) {
    lines.push({ type: "added", text: newLines[j] });
    j += 1;
  }
  return lines;
}

function coarseDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  return [
    ...oldLines.map((text): DiffLine => ({ type: "removed", text })),
    ...newLines.map((text): DiffLine => ({ type: "added", text })),
  ];
}

export function computeLineDiff(
  oldText: string,
  newText: string,
  maxLines = DIFF_MAX_LINES,
): FileDiff {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  const useLcs = oldLines.length * newLines.length <= MAX_LCS_CELLS;
  const full = useLcs ? lcsDiff(oldLines, newLines) : coarseDiff(oldLines, newLines);

  let added = 0;
  let removed = 0;
  for (const line of full) {
    if (line.type === "added") added += 1;
    else if (line.type === "removed") removed += 1;
  }

  const truncated = full.length > maxLines;
  return {
    added,
    removed,
    lines: truncated ? full.slice(0, maxLines) : full,
    truncated,
  };
}
