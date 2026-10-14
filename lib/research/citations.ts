export interface CitationCheck {
  cited: number[];
  invalid: number[];
  verified: false;
}

/**
 * Deterministically extract inline citation markers from a model summary and
 * separate those that reference a retrieved source from those that do not.
 * This can prove a cited number is out of range; it cannot prove that a source
 * actually supports a claim.
 */
export function validateCitations(summary: string, sourceCount: number): CitationCheck {
  const cited = new Set<number>();
  const invalid = new Set<number>();
  for (const match of summary.matchAll(/\[(\d{1,3})\]/g)) {
    const value = Number(match[1]);
    if (Number.isInteger(value) && value >= 1 && value <= sourceCount) cited.add(value);
    else invalid.add(value);
  }
  return {
    cited: [...cited].sort((a, b) => a - b),
    invalid: [...invalid].sort((a, b) => a - b),
    verified: false,
  };
}
