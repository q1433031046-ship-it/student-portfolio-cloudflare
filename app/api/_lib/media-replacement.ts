import type { MediaAsset, PortfolioDocument } from "../../portfolio/model";

export type EditableMediaSlot =
  | "hero"
  | "transition"
  | "cover"
  | "final"
  | "detail"
  | "font"
  | "contact"
  | "end-cover";

export function isExactDraftMediaReplacement(
  document: PortfolioDocument,
  projectId: string,
  slot: EditableMediaSlot,
  assetId: string,
  objectKey: string,
) {
  const matches = (asset: MediaAsset) => asset.id === assetId && asset.key === objectKey;

  if (slot === "hero") {
    return projectId === "site" && document.hero.slides.some((slide) => matches(slide.media));
  }
  if (slot === "font") {
    return projectId === "site" && matches(document.settings.customFont);
  }
  if (slot === "contact") {
    return projectId === "site" && matches(document.settings.contact.image);
  }
  if (slot === "transition") {
    const category = document.categories.find((candidate) => candidate.id === projectId);
    return Boolean(category && matches(category.transition.media));
  }
  if (slot === "end-cover") {
    const slide = document.endCovers.slides.find((candidate) => candidate.id === projectId);
    return Boolean(slide && matches(slide.media));
  }

  const project = document.projects.find((candidate) => candidate.id === projectId);
  if (!project) return false;
  if (slot === "cover") return matches(project.cover);
  if (slot === "final") return matches(project.finalVideo);
  if (slot !== "detail") return false;

  return project.detailBlocks.some((block) => {
    if (block.type === "media-text" || block.type === "full-media") return matches(block.media);
    return block.type === "gallery" && block.items.some(matches);
  });
}
