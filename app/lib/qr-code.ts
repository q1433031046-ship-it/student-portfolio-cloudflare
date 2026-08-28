const VERSION = 10;
const SIZE = VERSION * 4 + 17;
const DATA_CODEWORDS = 216;
const ERROR_CODEWORDS_PER_BLOCK = 26;
const DATA_BLOCK_LENGTHS = [43, 43, 43, 43, 44] as const;
const QUIET_ZONE = 4;

type Cell = boolean | null;

export function createQrMatrix(value: string): boolean[][] {
  const data = new TextEncoder().encode(value);
  if (data.length > 213) throw new Error("二维码链接过长");
  const codewords = createCodewords(data);
  const modules: Cell[][] = Array.from({ length: SIZE }, () => Array<Cell>(SIZE).fill(null));

  placeFinder(modules, 0, 0);
  placeFinder(modules, SIZE - 7, 0);
  placeFinder(modules, 0, SIZE - 7);
  placeAlignmentPatterns(modules);
  placeTimingPatterns(modules);
  placeVersionInformation(modules);
  placeFormatInformation(modules, false);
  placeData(modules, codewords);
  placeFormatInformation(modules, true);

  return modules.map((row) => row.map(Boolean));
}

export function qrSvg(value: string, options: { title?: string; foreground?: string; background?: string } = {}) {
  const matrix = createQrMatrix(value);
  const dimension = SIZE + QUIET_ZONE * 2;
  const foreground = options.foreground ?? "#111216";
  const background = options.background ?? "#ffffff";
  const title = options.title ? `<title>${escapeXml(options.title)}</title>` : "";
  const path = matrix.flatMap((row, y) => row.map((dark, x) => dark ? `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z` : "")).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimension} ${dimension}" shape-rendering="crispEdges">${title}<path fill="${background}" d="M0 0h${dimension}v${dimension}H0z"/><path fill="${foreground}" d="${path}"/></svg>`;
}

function createCodewords(data: Uint8Array) {
  const bits: number[] = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, data.length, 16);
  for (const byte of data) appendBits(bits, byte, 8);
  for (let index = 0; index < Math.min(4, DATA_CODEWORDS * 8 - bits.length); index += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCodewords: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    dataCodewords.push(bits.slice(index, index + 8).reduce((value, bit) => (value << 1) | bit, 0));
  }
  for (let pad = 0; dataCodewords.length < DATA_CODEWORDS; pad += 1) dataCodewords.push(pad % 2 === 0 ? 0xec : 0x11);

  const blocks: Array<{ data: number[]; error: number[] }> = [];
  let offset = 0;
  for (const length of DATA_BLOCK_LENGTHS) {
    const blockData = dataCodewords.slice(offset, offset + length);
    blocks.push({ data: blockData, error: reedSolomon(blockData, ERROR_CODEWORDS_PER_BLOCK) });
    offset += length;
  }

  const result: number[] = [];
  for (let index = 0; index < Math.max(...DATA_BLOCK_LENGTHS); index += 1) {
    for (const block of blocks) if (index < block.data.length) result.push(block.data[index]);
  }
  for (let index = 0; index < ERROR_CODEWORDS_PER_BLOCK; index += 1) {
    for (const block of blocks) result.push(block.error[index]);
  }
  return result;
}

function reedSolomon(data: number[], degree: number) {
  const generator = generatorPolynomial(degree);
  const remainder = Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let index = 0; index < degree; index += 1) remainder[index] ^= multiply(generator[index + 1], factor);
  }
  return remainder;
}

function generatorPolynomial(degree: number) {
  let polynomial = [1];
  for (let power = 0; power < degree; power += 1) polynomial = multiplyPolynomials(polynomial, [1, exponent(power)]);
  return polynomial;
}

function multiplyPolynomials(left: number[], right: number[]) {
  const result = Array<number>(left.length + right.length - 1).fill(0);
  for (let i = 0; i < left.length; i += 1) {
    for (let j = 0; j < right.length; j += 1) result[i + j] ^= multiply(left[i], right[j]);
  }
  return result;
}

const EXPONENTS = (() => {
  const values = Array<number>(512).fill(0);
  let current = 1;
  for (let index = 0; index < 255; index += 1) {
    values[index] = current;
    current <<= 1;
    if ((current & 0x100) !== 0) current ^= 0x11d;
  }
  for (let index = 255; index < values.length; index += 1) values[index] = values[index - 255];
  return values;
})();

const LOGARITHMS = (() => {
  const values = Array<number>(256).fill(0);
  for (let index = 0; index < 255; index += 1) values[EXPONENTS[index]] = index;
  return values;
})();

function exponent(power: number) {
  return EXPONENTS[power];
}

function multiply(left: number, right: number) {
  return left === 0 || right === 0 ? 0 : EXPONENTS[LOGARITHMS[left] + LOGARITHMS[right]];
}

function placeFinder(modules: Cell[][], left: number, top: number) {
  for (let y = -1; y <= 7; y += 1) {
    for (let x = -1; x <= 7; x += 1) {
      const row = top + y;
      const column = left + x;
      if (row < 0 || row >= SIZE || column < 0 || column >= SIZE) continue;
      const inPattern = x >= 0 && x <= 6 && y >= 0 && y <= 6;
      modules[row][column] = inPattern && (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
    }
  }
}

function placeAlignmentPatterns(modules: Cell[][]) {
  const positions = [6, 28, 50];
  for (const row of positions) {
    for (const column of positions) {
      if (modules[row][column] !== null) continue;
      for (let y = -2; y <= 2; y += 1) {
        for (let x = -2; x <= 2; x += 1) modules[row + y][column + x] = Math.max(Math.abs(x), Math.abs(y)) !== 1;
      }
    }
  }
}

function placeTimingPatterns(modules: Cell[][]) {
  for (let index = 8; index < SIZE - 8; index += 1) {
    if (modules[6][index] === null) modules[6][index] = index % 2 === 0;
    if (modules[index][6] === null) modules[index][6] = index % 2 === 0;
  }
}

function placeVersionInformation(modules: Cell[][]) {
  const bits = bchVersion(VERSION);
  for (let index = 0; index < 18; index += 1) {
    const dark = ((bits >> index) & 1) === 1;
    modules[Math.floor(index / 3)][index % 3 + SIZE - 11] = dark;
    modules[index % 3 + SIZE - 11][Math.floor(index / 3)] = dark;
  }
}

function placeFormatInformation(modules: Cell[][], actual: boolean) {
  const bits = bchFormat(0);
  for (let index = 0; index < 15; index += 1) {
    const dark = actual && ((bits >> index) & 1) === 1;
    if (index < 6) modules[index][8] = dark;
    else if (index < 8) modules[index + 1][8] = dark;
    else modules[SIZE - 15 + index][8] = dark;

    if (index < 8) modules[8][SIZE - index - 1] = dark;
    else if (index === 8) modules[8][7] = dark;
    else modules[8][15 - index - 1] = dark;
  }
  modules[SIZE - 8][8] = actual;
}

function placeData(modules: Cell[][], data: number[]) {
  let row = SIZE - 1;
  let direction = -1;
  let byteIndex = 0;
  let bitIndex = 7;
  for (let column = SIZE - 1; column > 0; column -= 2) {
    if (column === 6) column -= 1;
    while (true) {
      for (let offset = 0; offset < 2; offset += 1) {
        const x = column - offset;
        if (modules[row][x] !== null) continue;
        let dark = byteIndex < data.length && ((data[byteIndex] >>> bitIndex) & 1) === 1;
        if ((row + x) % 2 === 0) dark = !dark;
        modules[row][x] = dark;
        bitIndex -= 1;
        if (bitIndex < 0) { byteIndex += 1; bitIndex = 7; }
      }
      row += direction;
      if (row >= 0 && row < SIZE) continue;
      row -= direction;
      direction = -direction;
      break;
    }
  }
}

function bchFormat(value: number) {
  let remainder = value << 10;
  while (bitLength(remainder) - bitLength(0x537) >= 0) remainder ^= 0x537 << (bitLength(remainder) - bitLength(0x537));
  return ((value << 10) | remainder) ^ 0x5412;
}

function bchVersion(value: number) {
  let remainder = value << 12;
  while (bitLength(remainder) - bitLength(0x1f25) >= 0) remainder ^= 0x1f25 << (bitLength(remainder) - bitLength(0x1f25));
  return (value << 12) | remainder;
}

function bitLength(value: number) {
  let length = 0;
  for (let current = value; current !== 0; current >>>= 1) length += 1;
  return length;
}

function appendBits(target: number[], value: number, length: number) {
  for (let index = length - 1; index >= 0; index -= 1) target.push((value >>> index) & 1);
}

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
