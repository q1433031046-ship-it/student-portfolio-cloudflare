export function countGraphemes(value: string, locale = "zh-CN") {
  if (typeof Intl.Segmenter !== "function") return Array.from(value).length;
  const segmenter = new Intl.Segmenter(locale, { granularity: "grapheme" });
  return Array.from(segmenter.segment(value)).length;
}

export function graphemeCountLabel(value: string, maximum: number, locale = "zh-CN") {
  return `${countGraphemes(value, locale)} / ${maximum}`;
}
