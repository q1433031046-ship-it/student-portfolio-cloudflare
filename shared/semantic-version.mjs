const SEMANTIC_VERSION_PATTERN = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9a-z-]+(?:\.[0-9a-z-]+)*))?$/u;
const NUMERIC_IDENTIFIER_PATTERN = /^\d+$/u;

function invalidVersion() {
  return new TypeError("Invalid semantic version.");
}

export function parseSemanticVersion(input) {
  if (typeof input !== "string") {
    throw invalidVersion();
  }

  const match = SEMANTIC_VERSION_PATTERN.exec(input);
  if (!match) {
    throw invalidVersion();
  }

  const [, majorText, minorText, patchText, prereleaseText] = match;
  const core = [majorText, minorText, patchText].map(Number);
  if (core.some((part) => !Number.isSafeInteger(part))) {
    throw invalidVersion();
  }

  const prerelease = prereleaseText?.split(".") ?? [];
  if (prerelease.some((part) => (
    NUMERIC_IDENTIFIER_PATTERN.test(part)
    && part.length > 1
    && part.startsWith("0")
  ))) {
    throw invalidVersion();
  }

  const [major, minor, patch] = core;
  const canonicalPrerelease = prerelease.length > 0
    ? `-${prerelease.join(".")}`
    : "";

  return Object.freeze({
    version: `${major}.${minor}.${patch}${canonicalPrerelease}`,
    major,
    minor,
    patch,
    prerelease: Object.freeze(prerelease),
  });
}

function compareNumber(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function comparePrerelease(left, right) {
  if (left.length === 0 || right.length === 0) {
    if (left.length === right.length) return 0;
    return left.length === 0 ? 1 : -1;
  }

  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) continue;

    const leftIsNumeric = NUMERIC_IDENTIFIER_PATTERN.test(leftPart);
    const rightIsNumeric = NUMERIC_IDENTIFIER_PATTERN.test(rightPart);
    if (leftIsNumeric && rightIsNumeric) {
      const lengthComparison = compareNumber(leftPart.length, rightPart.length);
      if (lengthComparison !== 0) return lengthComparison;
      return leftPart < rightPart ? -1 : 1;
    }
    if (leftIsNumeric !== rightIsNumeric) {
      return leftIsNumeric ? -1 : 1;
    }
    return leftPart < rightPart ? -1 : 1;
  }

  return 0;
}

export function compareSemanticVersion(leftInput, rightInput) {
  const left = parseSemanticVersion(leftInput);
  const right = parseSemanticVersion(rightInput);

  for (const key of ["major", "minor", "patch"]) {
    const comparison = compareNumber(left[key], right[key]);
    if (comparison !== 0) return comparison;
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}

function runCli() {
  const [command, input, ...extra] = process.argv.slice(2);
  if (command !== "parse" || typeof input !== "string" || extra.length > 0) {
    console.error("Usage: node shared/semantic-version.mjs parse <version>");
    process.exitCode = 64;
    return;
  }

  try {
    console.log(parseSemanticVersion(input).version);
  } catch {
    console.error("Invalid semantic version.");
    process.exitCode = 1;
  }
}

if (
  typeof process !== "undefined"
  && Array.isArray(process.argv)
  && typeof process.argv[1] === "string"
  && process.argv[1].replaceAll("\\", "/").endsWith("/shared/semantic-version.mjs")
) {
  runCli();
}
