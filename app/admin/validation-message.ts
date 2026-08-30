const fieldNames: Array<[RegExp, string]> = [
  [/settings\.contact\.title/u, "联系方式的主标题"],
  [/settings\.contact\.eyebrow/u, "联系方式的眉题"],
  [/settings\.contact\.note/u, "联系方式的说明"],
  [/settings\.siteTitle/u, "网站名称"],
  [/settings\.videoWatermarkText/u, "视频水印文字"],
  [/settings\.workHeading\.lead/u, "作品区标题第一行"],
  [/settings\.workHeading\.accent/u, "作品区标题第二行"],
  [/hero\.name/u, "姓名"],
  [/hero\.role/u, "职业标题"],
  [/hero\.targetRole/u, "求职方向"],
  [/hero\.email/u, "联系邮箱"],
  [/hero\.phone/u, "电话号码"],
  [/hero\.statement/u, "个人定位"],
  [/hero\.availability/u, "状态短句"],
  [/endCovers\.slides\[\d+\]\.title/u, "封底标题"],
  [/endCovers\.slides\[\d+\]\.statement/u, "封底说明"],
  [/endCovers\.slides\[\d+\]\.details/u, "封底补充信息"],
  [/categories\[\d+\]\.label/u, "分类名称"],
  [/projects\[\d+\]\.title/u, "作品名称"],
  [/projects\[\d+\]\.year/u, "作品年份"],
  [/projects\[\d+\]\.synopsis/u, "作品简介"],
  [/projects\[\d+\]\.challenge/u, "项目难点"],
  [/projects\[\d+\]\.solution/u, "解决思路"],
];

export function humanizeValidationMessage(rawReason: string) {
  const field = fieldNames.find(([pattern]) => pattern.test(rawReason))?.[1];
  if (!field) return rawReason;
  const range = rawReason.match(/需要\s*(\d+)\s*[–-]\s*(\d+)\s*个字符(?:，当前\s*(\d+)\s*个)?/u);
  if (range) {
    const minimum = Number(range[1]);
    const maximum = Number(range[2]);
    const current = range[3] ? Number(range[3]) : undefined;
    const rule = minimum === 0 ? `最多 ${maximum} 个字符，也可以留空` : `${minimum} 至 ${maximum} 个字符`;
    return `${field}需要${rule}${current === undefined ? "" : `；现在是 ${current} 个字符`}。中文可以直接输入。`;
  }
  if (/格式不正确/u.test(rawReason)) return `${field}的格式不正确，请按输入框提示修改。`;
  if (/无效|长度/u.test(rawReason)) return `${field}的内容不符合要求，请返回该输入框检查。中文可以直接输入。`;
  return `${field}需要修改：${rawReason.replace(/（[^）]+）/gu, "").trim()}`;
}
