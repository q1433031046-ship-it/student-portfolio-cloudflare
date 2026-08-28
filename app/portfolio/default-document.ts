import { portfolioDemo } from "../demo/portfolio-data";
import { createDefaultContactConfig, createDefaultCoverPresentation, type MediaAsset, type PortfolioDocument, type ProjectBlock } from "./model";

function media(asset: (typeof portfolioDemo.projects)[number]["cover"], kind: "image" | "video"): MediaAsset {
  return { ...asset, kind };
}

function block(value: (typeof portfolioDemo.projects)[number]["detailBlocks"][number]): ProjectBlock {
  if (value.type === "media-text") return { ...value, media: media(value.media, "image") };
  if (value.type === "gallery") return { ...value, orientation: "portrait", items: value.items.slice(0, 4).map((item) => media(item, "image")) };
  if (value.type === "full-media") return { ...value, media: media(value.media, "image") };
  return value;
}

export function createDefaultPortfolioDocument(): PortfolioDocument {
  return {
    schemaVersion: 4,
    settings: {
      siteTitle: "中科云领学生作品展示",
      activeTheme: "graphite",
      expansionMode: "single",
      coverOverlayMode: "hover",
      videoWatermarkText: "",
      videoWatermarkStyle: { fontSize: 18, color: "#ffffff", fontFamily: "system" },
      customFont: { id: "site-font", label: "", alt: "", kind: "font", visualKey: "frame" },
      workHeading: { lead: "作品不是结果。", accent: "它是一次完整思考。" },
      contact: createDefaultContactConfig(),
    },
    hero: {
      ...portfolioDemo.hero,
      slides: portfolioDemo.hero.slides.map((slide) => ({
        ...slide,
        media: media(slide.media, "image"),
        layers: slide.layers.map((layer) => ({ ...layer, color: "system", fontFamily: "system" })),
      })),
    },
    themes: portfolioDemo.themes.map((theme) => ({ ...theme })),
    categories: portfolioDemo.categories.map((category) => ({
      ...category,
      transition: { ...category.transition, visible: true, media: media(category.transition.media, "image") },
    })),
    projects: portfolioDemo.projects.map((project) => ({
      ...project,
      cover: media(project.cover, "image"),
      finalVideo: media(project.finalVideo, "video"),
      coverPresentation: createDefaultCoverPresentation(),
      detailBlocks: project.detailBlocks.map(block),
    })),
  };
}
