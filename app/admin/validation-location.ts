export type ValidationLocation = {
  projectIndex: number | null;
  categoryIndex: number | null;
  blockIndex: number | null;
  endCoverIndex: number | null;
};

export function parseValidationLocation(reason: string): ValidationLocation {
  return {
    projectIndex: matchIndex(reason, /projects\[(\d+)\]/u),
    categoryIndex: matchIndex(reason, /categories\[(\d+)\]/u),
    blockIndex: matchIndex(reason, /detailBlocks\[(\d+)\]/u),
    endCoverIndex: matchIndex(reason, /endCovers\.slides\[(\d+)\]/u),
  };
}

export function validationViewForReason(reason: string) {
  if (/endCovers\.slides|封底/u.test(reason)) return "封底";
  if (/settings\.contact|联系方式主标题/u.test(reason)) return "联系";
  if (/hero\.(?:email|phone)/u.test(reason)) return "联系";
  if (/settings\.workHeading/u.test(reason)) return "首图与文字";
  if (/settings\.videoWatermarkText/u.test(reason)) return "作品";
  if (/hero\./u.test(reason)) return "首图与文字";
  if (/categories\[/u.test(reason)) return "作品分类";
  if (/projects\[/u.test(reason)) return "作品";
  if (/settings\.siteTitle/u.test(reason)) return "概览";
  return "";
}

function matchIndex(value: string, pattern: RegExp) {
  const match = value.match(pattern);
  return match ? Number(match[1]) : null;
}
