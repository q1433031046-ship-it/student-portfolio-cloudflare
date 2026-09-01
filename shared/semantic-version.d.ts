export interface SemanticVersion {
  readonly version: string;
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
}

export function parseSemanticVersion(input: string): SemanticVersion;

export function compareSemanticVersion(left: string, right: string): -1 | 0 | 1;
