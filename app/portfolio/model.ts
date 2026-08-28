export type ExpansionMode = "single" | "multiple";
export type CoverOverlayMode = "hover" | "fixed";
export type ContactLayout = "details-left" | "image-left";
export type HeroEffect = "halo" | "signal";
export type HeroContentMode = "image-only" | "system" | "free";
export type HeroLayerKind = "identity" | "statement" | "facts";
export type ThemeKey = "graphite" | "ivory" | "cobalt" | "white";
export type VisualKey = "portrait" | "city" | "frame" | "character" | "storyboard";
export type TextAlign = "left" | "center" | "right";
export type GalleryOrientation = "portrait" | "landscape";

export type MediaPosition = {
  x: number;
  y: number;
};

export type MediaCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CoverTextStyle = {
  x: number;
  y: number;
  width: number;
  scale: number;
  align: TextAlign;
  color: "system" | `#${string}`;
  fontFamily: "system" | "custom";
};

export type ThemeConfig = {
  id: ThemeKey;
  label: string;
  swatches: [string, string, string];
};

export type HeroConfig = {
  name: string;
  role: string;
  targetRole: string;
  email: string;
  phone: string;
  statement: string;
  availability: string;
  slides: HeroSlide[];
};

export type HeroLayer = {
  id: string;
  kind: HeroLayerKind;
  x: number;
  y: number;
  width: number;
  scale: number;
  align: TextAlign;
  zIndex: number;
  visible: boolean;
  color: "system" | `#${string}`;
  fontFamily: "system" | "custom";
};

export type HeroSlide = {
  id: string;
  media: MediaAsset;
  contentMode: HeroContentMode;
  effect: HeroEffect;
  animationEnabled: boolean;
  layers: HeroLayer[];
};

export type CategoryTransition = {
  mode: "default" | "image";
  visible: boolean;
  media: MediaAsset;
};

export type CategoryConfig = {
  id: string;
  label: string;
  accent: string;
  transition: CategoryTransition;
};

export type MediaAsset = {
  id: string;
  label: string;
  alt: string;
  kind: "image" | "video" | "font";
  key?: string;
  src?: string;
  visualKey: VisualKey;
  objectPosition?: MediaPosition;
  sourceAspectRatio?: number;
  crop?: MediaCrop;
};

export type ContactConfig = {
  eyebrow: string;
  title: string;
  note: string;
  layout: ContactLayout;
  image: MediaAsset;
  eyebrowStyle: CoverTextStyle;
  titleStyle: CoverTextStyle;
  detailsStyle: CoverTextStyle;
  noteStyle: CoverTextStyle;
};

export type ProjectBlock =
  | { id: string; type: "text"; eyebrow: string; title: string; body: string }
  | { id: string; type: "media-text"; media: MediaAsset; side: "left" | "right"; eyebrow: string; title: string; body: string }
  | { id: string; type: "gallery"; eyebrow: string; title: string; orientation: GalleryOrientation; items: MediaAsset[] }
  | { id: string; type: "full-media"; media: MediaAsset; caption: string };

export type Project = {
  id: string;
  order: number;
  categoryId: string;
  title: string;
  year: string;
  duration: string;
  synopsis: string;
  challenge: string;
  solution: string;
  cover: MediaAsset;
  finalVideo: MediaAsset;
  coverPresentation: {
    overlayMode: CoverOverlayMode;
    showTitle: boolean;
    showSynopsis: boolean;
    showFacts: boolean;
    titleStyle: CoverTextStyle;
    synopsisStyle: CoverTextStyle;
    factsStyle: CoverTextStyle;
  };
  detailBlocks: ProjectBlock[];
};

export type PortfolioDocument = {
  schemaVersion: 4;
  settings: {
    siteTitle: string;
    activeTheme: ThemeKey;
    expansionMode: ExpansionMode;
    coverOverlayMode: CoverOverlayMode;
    videoWatermarkText: string;
    videoWatermarkStyle: {
      fontSize: number;
      color: `#${string}`;
      fontFamily: "system" | "custom";
    };
    customFont: MediaAsset;
    workHeading: {
      lead: string;
      accent: string;
    };
    contact: ContactConfig;
  };
  hero: HeroConfig;
  themes: ThemeConfig[];
  categories: CategoryConfig[];
  projects: Project[];
};

export type ValidationResult =
  | { ok: true; value: PortfolioDocument }
  | { ok: false; errors: string[] };

const THEME_KEYS = new Set<ThemeKey>(["graphite", "ivory", "cobalt", "white"]);
const HERO_EFFECTS = new Set<HeroEffect>(["halo", "signal"]);
const HERO_CONTENT_MODES = new Set<HeroContentMode>(["image-only", "system", "free"]);
const HERO_LAYER_KINDS = new Set<HeroLayerKind>(["identity", "statement", "facts"]);
const HERO_LAYER_ALIGNS = new Set(["left", "center", "right"]);
const TRANSITION_MODES = new Set(["default", "image"]);
const EXPANSION_MODES = new Set<ExpansionMode>(["single", "multiple"]);
const COVER_OVERLAY_MODES = new Set<CoverOverlayMode>(["hover", "fixed"]);
const CONTACT_LAYOUTS = new Set<ContactLayout>(["details-left", "image-left"]);
const VISUAL_KEYS = new Set<VisualKey>(["portrait", "city", "frame", "character", "storyboard"]);
const BLOCK_TYPES = new Set(["text", "media-text", "gallery", "full-media"]);
const GALLERY_ORIENTATIONS = new Set<GalleryOrientation>(["portrait", "landscape"]);

export function createDefaultHeroLayers(): HeroLayer[] {
  return [
    { id: "identity", kind: "identity", x: 3, y: 68, width: 40, scale: 1, align: "left", zIndex: 2, visible: true, color: "system", fontFamily: "system" },
    { id: "statement", kind: "statement", x: 3, y: 87, width: 36, scale: 1, align: "left", zIndex: 2, visible: true, color: "system", fontFamily: "system" },
    { id: "facts", kind: "facts", x: 72, y: 72, width: 25, scale: 1, align: "left", zIndex: 3, visible: true, color: "system", fontFamily: "system" },
  ];
}

export function createDefaultMediaPosition(): MediaPosition {
  return { x: 50, y: 50 };
}

export function createDefaultContactConfig(): ContactConfig {
  return {
    eyebrow: "CONTACT / 01",
    title: "保持联系。",
    note: "欢迎通过邮箱或电话联系。",
    layout: "details-left",
    image: { id: "site-contact-image", label: "", alt: "联系方式图片", kind: "image", visualKey: "frame" },
    eyebrowStyle: { x: 6, y: 16, width: 48, scale: 1, align: "left", color: "system", fontFamily: "system" },
    titleStyle: { x: 6, y: 33, width: 54, scale: 1, align: "left", color: "system", fontFamily: "system" },
    detailsStyle: { x: 6, y: 61, width: 48, scale: 1, align: "left", color: "system", fontFamily: "system" },
    noteStyle: { x: 6, y: 80, width: 48, scale: 1, align: "left", color: "system", fontFamily: "system" },
  };
}

export function createDefaultCoverPresentation(): NonNullable<Project["coverPresentation"]> {
  return {
    overlayMode: "hover",
    showTitle: true,
    showSynopsis: true,
    showFacts: true,
    titleStyle: { x: 3, y: 10, width: 62, scale: 1, align: "left", color: "system", fontFamily: "system" },
    synopsisStyle: { x: 3, y: 63, width: 42, scale: 1, align: "left", color: "system", fontFamily: "system" },
    factsStyle: { x: 3, y: 78, width: 72, scale: 1, align: "left", color: "system", fontFamily: "system" },
  };
}

function normalizeCoverPresentation(value: unknown, fallbackOverlayMode: CoverOverlayMode = "hover") {
  const defaults = createDefaultCoverPresentation();
  if (!isRecord(value)) return defaults;
  return {
    ...defaults,
    ...value,
    overlayMode: isStringIn(value.overlayMode, COVER_OVERLAY_MODES) ? value.overlayMode : fallbackOverlayMode,
    titleStyle: normalizeCoverTextStyle(value.titleStyle, defaults.titleStyle),
    synopsisStyle: normalizeCoverTextStyle(value.synopsisStyle, defaults.synopsisStyle),
    factsStyle: normalizeCoverTextStyle(value.factsStyle, defaults.factsStyle),
  };
}

function normalizeCoverTextStyle(value: unknown, fallback: CoverTextStyle): CoverTextStyle {
  if (!isRecord(value)) return fallback;
  return {
    ...fallback,
    ...value,
    x: typeof value.x === "number" ? value.x : fallback.x,
    y: typeof value.y === "number" ? value.y : fallback.y,
    width: typeof value.width === "number" ? value.width : fallback.width,
    scale: typeof value.scale === "number" ? value.scale : fallback.scale,
    align: isStringIn(value.align, new Set<TextAlign>(["left", "center", "right"])) ? value.align : fallback.align,
    color: value.color === "system" || isColor(value.color) ? value.color as CoverTextStyle["color"] : fallback.color,
    fontFamily: value.fontFamily === "custom" || value.fontFamily === "system" ? value.fontFamily : fallback.fontFamily,
  };
}

function normalizeAsset(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const normalized: Record<string, unknown> = { ...value };
  if (isRecord(value.objectPosition)) {
    normalized.objectPosition = {
      x: typeof value.objectPosition.x === "number" ? value.objectPosition.x : 50,
      y: typeof value.objectPosition.y === "number" ? value.objectPosition.y : 50,
    };
  }
  if (typeof value.sourceAspectRatio === "number" && Number.isFinite(value.sourceAspectRatio)) {
    normalized.sourceAspectRatio = value.sourceAspectRatio;
  }
  if (isRecord(value.crop)) {
    normalized.crop = {
      x: typeof value.crop.x === "number" ? value.crop.x : 0,
      y: typeof value.crop.y === "number" ? value.crop.y : 0,
      width: typeof value.crop.width === "number" ? value.crop.width : 100,
      height: typeof value.crop.height === "number" ? value.crop.height : 100,
    };
  }
  return normalized;
}

function normalizePortfolioInput(input: Record<string, unknown>): Record<string, unknown> {
  let candidate = input;
  if (candidate.schemaVersion === 1) {
    const hero = isRecord(candidate.hero)
      ? {
          ...candidate.hero,
          animationEnabled: true,
          media: {
            id: "hero-media",
            label: "个人首幅",
            alt: "个人作品集首幅画面",
            kind: "image",
            visualKey: "frame",
          },
        }
      : candidate.hero;
    const projects = Array.isArray(candidate.projects)
      ? candidate.projects.map((value) => {
          if (!isRecord(value)) return value;
          const { draftVideo: legacyMedia, ...project } = value;
          void legacyMedia;
          return project;
        })
      : candidate.projects;
    candidate = { ...candidate, schemaVersion: 2, hero, projects };
  }
  if (candidate.schemaVersion === 2) {
    const oldHero = isRecord(candidate.hero) ? candidate.hero : null;
    const oldSettings = isRecord(candidate.settings) ? candidate.settings : candidate.settings;
    const hero = oldHero
      ? {
          name: oldHero.name,
          role: oldHero.role,
          targetRole: oldHero.targetRole,
          email: oldHero.email,
          phone: "",
          statement: oldHero.statement,
          availability: oldHero.availability,
          slides: [{
            id: "hero-slide-1",
            media: oldHero.media,
            contentMode: "system",
            effect: oldHero.effect,
            animationEnabled: oldHero.animationEnabled,
            layers: createDefaultHeroLayers().map((layer) => ({
              id: layer.id,
              kind: layer.kind,
              x: layer.x,
              y: layer.y,
              width: layer.width,
              scale: layer.scale,
              align: layer.align,
              zIndex: layer.zIndex,
              visible: layer.visible,
            })),
          }],
        }
      : candidate.hero;
    const settings = isRecord(oldSettings)
      ? { ...oldSettings, videoWatermarkText: "" }
      : oldSettings;
    const categories = Array.isArray(candidate.categories)
      ? candidate.categories.map((value, index) => isRecord(value)
        ? {
            ...value,
            transition: {
              mode: "default",
              media: {
                id: "transition-" + (typeof value.id === "string" ? value.id : index + 1),
                label: "",
                alt: "",
                kind: "image",
                visualKey: "frame",
              },
            },
          }
        : value)
      : candidate.categories;
    candidate = { ...candidate, schemaVersion: 3, settings, hero, categories };
  }
  if (candidate.schemaVersion !== 3) return candidate;

  const oldSettings = isRecord(candidate.settings) ? candidate.settings : candidate.settings;
  const settings = isRecord(oldSettings)
    ? {
        ...oldSettings,
        siteTitle: "中科云领学生作品展示",
        coverOverlayMode: "hover",
        customFont: {
          id: "site-font",
          label: "",
          alt: "",
          kind: "font",
          visualKey: "frame",
        },
        workHeading: {
          lead: "作品不是结果。",
          accent: "它是一次完整思考。",
        },
        videoWatermarkStyle: {
          fontSize: 18,
          color: "#ffffff",
          fontFamily: "system",
        },
        contact: createDefaultContactConfig(),
      }
    : oldSettings;
  const hero = isRecord(candidate.hero) && Array.isArray(candidate.hero.slides)
    ? {
        ...candidate.hero,
        slides: candidate.hero.slides.map((value) => isRecord(value) && Array.isArray(value.layers)
          ? {
              ...value,
              layers: value.layers.map((layer) => isRecord(layer)
                ? { ...layer, color: "system", fontFamily: "system" }
                : layer),
            }
          : value),
      }
    : candidate.hero;
  const categories = Array.isArray(candidate.categories)
    ? candidate.categories.map((value) => isRecord(value) && isRecord(value.transition)
      ? { ...value, transition: { ...value.transition, visible: true } }
      : value)
    : candidate.categories;
  const legacyOverlayMode = isRecord(candidate.settings) && isStringIn(candidate.settings.coverOverlayMode, COVER_OVERLAY_MODES)
    ? candidate.settings.coverOverlayMode
    : "hover";
  const projects = Array.isArray(candidate.projects)
    ? candidate.projects.map((value) => isRecord(value)
      ? { ...value, coverPresentation: normalizeCoverPresentation(value.coverPresentation, legacyOverlayMode) }
      : value)
    : candidate.projects;
  return { ...candidate, schemaVersion: 4, settings, hero, categories, projects };
}

export function validatePortfolioDocument(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["作品集文档必须是对象"] };
  let candidate = normalizePortfolioInput(input);
  if (candidate.schemaVersion === 4) candidate = normalizeSchemaFourPresentation(candidate);
  if (candidate.schemaVersion !== 4) errors.push("schemaVersion 必须为 4");

  const settings = expectRecord(candidate.settings, "settings", errors);
  const hero = expectRecord(candidate.hero, "hero", errors);
  const themes = expectArray(candidate.themes, "themes", errors, 1, 8);
  const categories = expectArray(candidate.categories, "categories", errors, 1, 30);
  const projects = expectArray(candidate.projects, "projects", errors, 0, 60);

  if (settings) {
    validateText(settings.siteTitle, "settings.siteTitle", 1, 80, errors);
    if (!isStringIn(settings.activeTheme, THEME_KEYS)) errors.push("settings.activeTheme 无效");
    if (!isStringIn(settings.expansionMode, EXPANSION_MODES)) errors.push("settings.expansionMode 无效");
    if (!isStringIn(settings.coverOverlayMode, COVER_OVERLAY_MODES)) errors.push("settings.coverOverlayMode 无效");
    validateText(settings.videoWatermarkText, "settings.videoWatermarkText", 0, 80, errors);
    const watermarkStyle = expectRecord(settings.videoWatermarkStyle, "settings.videoWatermarkStyle", errors);
    if (watermarkStyle) {
      validateNumber(watermarkStyle.fontSize, "settings.videoWatermarkStyle.fontSize", 10, 72, errors);
      if (!isColor(watermarkStyle.color)) errors.push("settings.videoWatermarkStyle.color 无效");
      if (watermarkStyle.fontFamily !== "system" && watermarkStyle.fontFamily !== "custom") errors.push("settings.videoWatermarkStyle.fontFamily 无效");
    }
    validateMedia(settings.customFont, "settings.customFont", "font", new Set<string>(), errors);
    const workHeading = expectRecord(settings.workHeading, "settings.workHeading", errors);
    if (workHeading) {
      validateText(workHeading.lead, "settings.workHeading.lead", 1, 100, errors);
      validateText(workHeading.accent, "settings.workHeading.accent", 1, 100, errors);
    }
    const contact = expectRecord(settings.contact, "settings.contact", errors);
    if (contact) {
      validateText(contact.eyebrow, "settings.contact.eyebrow", 0, 60, errors);
      validateText(contact.title, "settings.contact.title", 1, 100, errors);
      validateText(contact.note, "settings.contact.note", 0, 300, errors);
      if (!isStringIn(contact.layout, CONTACT_LAYOUTS)) errors.push("settings.contact.layout 无效");
      validateMedia(contact.image, "settings.contact.image", "image", new Set<string>(), errors);
      for (const field of ["eyebrowStyle", "titleStyle", "detailsStyle", "noteStyle"] as const) {
        validateCoverTextStyle(contact[field], `settings.contact.${field}`, errors);
      }
    }
  }
  if (hero) validateHero(hero, errors);

  const themeIds = new Set<string>();
  themes?.forEach((theme, index) => validateTheme(theme, index, themeIds, errors));
  if (settings && typeof settings.activeTheme === "string" && !themeIds.has(settings.activeTheme)) {
    errors.push("settings.activeTheme 必须引用 themes 中的主题");
  }

  const categoryIds = new Set<string>();
  categories?.forEach((category, index) => validateCategory(category, index, categoryIds, errors));

  const projectIds = new Set<string>();
  projects?.forEach((project, index) => validateProject(project, index, categoryIds, projectIds, errors));

  const serializedLength = safeSerializedLength(candidate);
  if (serializedLength > 1_000_000) errors.push("作品集文档不能超过 1 MB");

  if (errors.length > 0) return { ok: false, errors: errors.slice(0, 40) };
  return { ok: true, value: candidate as PortfolioDocument };
}

function normalizeSchemaFourPresentation(candidate: Record<string, unknown>): Record<string, unknown> {
  const legacyOverlayMode = isRecord(candidate.settings) && isStringIn(candidate.settings.coverOverlayMode, COVER_OVERLAY_MODES)
    ? candidate.settings.coverOverlayMode
    : "hover";
  const hero = isRecord(candidate.hero) && Array.isArray(candidate.hero.slides)
    ? {
        ...candidate.hero,
        slides: candidate.hero.slides.map((slide) => isRecord(slide)
          ? { ...slide, media: normalizeAsset(slide.media) }
          : slide),
      }
    : candidate.hero;
  const categories = Array.isArray(candidate.categories)
    ? candidate.categories.map((category) => isRecord(category) && isRecord(category.transition)
      ? { ...category, transition: { ...category.transition, media: normalizeAsset(category.transition.media) } }
      : category)
    : candidate.categories;
  const projects = Array.isArray(candidate.projects)
    ? candidate.projects.map((project) => {
        if (!isRecord(project)) return project;
        const detailBlocks = Array.isArray(project.detailBlocks)
          ? project.detailBlocks.map((block) => {
              if (!isRecord(block)) return block;
              if (block.type === "media-text" || block.type === "full-media") return { ...block, media: normalizeAsset(block.media) };
              if (block.type === "gallery" && Array.isArray(block.items)) {
                return {
                  ...block,
                  orientation: isStringIn(block.orientation, GALLERY_ORIENTATIONS) ? block.orientation : "portrait",
                  items: block.items.map(normalizeAsset),
                };
              }
              return block;
            })
          : project.detailBlocks;
        return {
          ...project,
          cover: normalizeAsset(project.cover),
          finalVideo: normalizeAsset(project.finalVideo),
          coverPresentation: normalizeCoverPresentation(project.coverPresentation, legacyOverlayMode),
          detailBlocks,
        };
      })
    : candidate.projects;
  const settings = isRecord(candidate.settings)
    ? {
        ...candidate.settings,
        siteTitle: typeof candidate.settings.siteTitle === "string" ? candidate.settings.siteTitle : "中科云领学生作品展示",
        coverOverlayMode: isStringIn(candidate.settings.coverOverlayMode, COVER_OVERLAY_MODES) ? candidate.settings.coverOverlayMode : "hover",
        customFont: normalizeAsset(candidate.settings.customFont),
        contact: normalizeContactConfig(candidate.settings.contact),
      }
    : candidate.settings;
  const themes = Array.isArray(candidate.themes)
    ? candidate.themes.some((theme) => isRecord(theme) && theme.id === "white")
      ? candidate.themes
      : [...candidate.themes, { id: "white", label: "纯白", swatches: ["#ffffff", "#111217", "#3258ff"] }]
    : candidate.themes;
  return { ...candidate, hero, categories, projects, settings, themes };
}

export function mediaAssetsInDocument(document: PortfolioDocument): MediaAsset[] {
  const assets: MediaAsset[] = [
    document.settings.customFont,
    document.settings.contact.image,
    ...document.hero.slides.map((slide) => slide.media),
    ...document.categories.map((category) => category.transition.media),
  ];
  for (const project of document.projects) {
    assets.push(project.cover, project.finalVideo);
    for (const block of project.detailBlocks) {
      if (block.type === "media-text" || block.type === "full-media") assets.push(block.media);
      if (block.type === "gallery") assets.push(...block.items);
    }
  }
  return assets;
}

export function toPublicPortfolioDocument(document: PortfolioDocument): PortfolioDocument {
  return {
    ...document,
    hero: {
      ...document.hero,
      slides: document.hero.slides.map((slide) => ({
        ...slide,
        media: publicAsset(slide.media),
        layers: slide.layers.map((layer) => ({ ...layer })),
      })),
    },
    settings: {
      ...document.settings,
      customFont: publicAsset(document.settings.customFont),
      contact: { ...document.settings.contact, image: publicAsset(document.settings.contact.image) },
    },
    themes: document.themes.map((theme) => ({ ...theme, swatches: [...theme.swatches] as [string, string, string] })),
    categories: document.categories.map((category) => ({
      ...category,
      transition: { ...category.transition, media: publicAsset(category.transition.media) },
    })),
    projects: document.projects.map((project) => ({
      ...project,
      cover: publicAsset(project.cover),
      finalVideo: publicAsset(project.finalVideo),
      detailBlocks: project.detailBlocks.map((block) => {
        if (block.type === "media-text" || block.type === "full-media") return { ...block, media: publicAsset(block.media) };
        if (block.type === "gallery") return { ...block, items: block.items.map(publicAsset) };
        return { ...block };
      }),
    })),
  };
}

export function findPublishedMedia(
  document: PortfolioDocument,
  key: string,
): { project: Project | null; asset: MediaAsset; role: "font" | "contact" | "hero" | "transition" | "cover" | "final" | "detail" } | null {
  if (document.settings.customFont.key === key) return { project: null, asset: document.settings.customFont, role: "font" };
  if (document.settings.contact.image.key === key) return { project: null, asset: document.settings.contact.image, role: "contact" };
  const heroAsset = document.hero.slides.find((slide) => slide.media.key === key)?.media;
  if (heroAsset) return { project: null, asset: heroAsset, role: "hero" };
  const transitionAsset = document.categories.find((category) => category.transition.media.key === key)?.transition.media;
  if (transitionAsset) return { project: null, asset: transitionAsset, role: "transition" };
  for (const project of document.projects) {
    if (project.cover.key === key) return { project, asset: project.cover, role: "cover" };
    if (project.finalVideo.key === key) return { project, asset: project.finalVideo, role: "final" };
    for (const block of project.detailBlocks) {
      if ((block.type === "media-text" || block.type === "full-media") && block.media.key === key) {
        return { project, asset: block.media, role: "detail" };
      }
      if (block.type === "gallery") {
        const asset = block.items.find((item) => item.key === key);
        if (asset) return { project, asset, role: "detail" };
      }
    }
  }
  return null;
}

function validateHero(hero: Record<string, unknown>, errors: string[]) {
  validateText(hero.name, "hero.name", 1, 60, errors);
  validateText(hero.role, "hero.role", 1, 80, errors);
  validateText(hero.targetRole, "hero.targetRole", 1, 120, errors);
  validateText(hero.email, "hero.email", 3, 160, errors);
  if (typeof hero.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(hero.email)) errors.push("hero.email 格式无效");
  validateText(hero.phone, "hero.phone", 0, 30, errors);
  if (typeof hero.phone !== "string" || (hero.phone.length > 0 && !/^[0-9+()\-\s]{5,30}$/u.test(hero.phone))) errors.push("hero.phone 格式无效");
  validateText(hero.statement, "hero.statement", 1, 260, errors);
  validateText(hero.availability, "hero.availability", 0, 100, errors);
  const slides = expectArray(hero.slides, "hero.slides", errors, 1, 12);
  const slideIds = new Set<string>();
  const mediaIds = new Set<string>();
  slides?.forEach((slide, index) => validateHeroSlide(slide, index, slideIds, mediaIds, errors));
}

function validateHeroSlide(value: unknown, index: number, ids: Set<string>, mediaIds: Set<string>, errors: string[]) {
  const path = `hero.slides[${index}]`;
  const slide = expectRecord(value, path, errors);
  if (!slide) return;
  validateId(slide.id, `${path}.id`, ids, errors);
  validateMedia(slide.media, `${path}.media`, "image", mediaIds, errors);
  if (!isStringIn(slide.contentMode, HERO_CONTENT_MODES)) errors.push(`${path}.contentMode 无效`);
  if (!isStringIn(slide.effect, HERO_EFFECTS)) errors.push(`${path}.effect 无效`);
  if (typeof slide.animationEnabled !== "boolean") errors.push(`${path}.animationEnabled 必须为布尔值`);
  const layers = expectArray(slide.layers, `${path}.layers`, errors, 3, 3);
  const layerIds = new Set<string>();
  layers?.forEach((layer, layerIndex) => validateHeroLayer(layer, `${path}.layers[${layerIndex}]`, layerIds, errors));
}

function validateHeroLayer(value: unknown, path: string, ids: Set<string>, errors: string[]) {
  const layer = expectRecord(value, path, errors);
  if (!layer) return;
  validateId(layer.id, `${path}.id`, ids, errors);
  if (!isStringIn(layer.kind, HERO_LAYER_KINDS)) errors.push(`${path}.kind 无效`);
  if (!isStringIn(layer.align, HERO_LAYER_ALIGNS)) errors.push(`${path}.align 无效`);
  validateNumber(layer.x, `${path}.x`, 0, 100, errors);
  validateNumber(layer.y, `${path}.y`, 0, 100, errors);
  validateNumber(layer.width, `${path}.width`, 10, 100, errors);
  validateNumber(layer.scale, `${path}.scale`, 0.5, 2.5, errors);
  validateNumber(layer.zIndex, `${path}.zIndex`, 1, 20, errors);
  if (typeof layer.x === "number" && typeof layer.width === "number" && layer.x + layer.width > 100) errors.push(`${path} 超出画布宽度`);
  if (typeof layer.visible !== "boolean") errors.push(`${path}.visible 必须为布尔值`);
  if (layer.color !== "system" && !isColor(layer.color)) errors.push(`${path}.color 无效`);
  if (layer.fontFamily !== "system" && layer.fontFamily !== "custom") errors.push(`${path}.fontFamily 无效`);
}

function validateTheme(value: unknown, index: number, ids: Set<string>, errors: string[]) {
  const theme = expectRecord(value, `themes[${index}]`, errors);
  if (!theme) return;
  validateId(theme.id, `themes[${index}].id`, ids, errors);
  if (!isStringIn(theme.id, THEME_KEYS)) errors.push(`themes[${index}].id 无效`);
  validateText(theme.label, `themes[${index}].label`, 1, 30, errors);
  if (!Array.isArray(theme.swatches) || theme.swatches.length !== 3 || !theme.swatches.every(isColor)) {
    errors.push(`themes[${index}].swatches 必须包含三个十六进制颜色`);
  }
}

function validateCategory(value: unknown, index: number, ids: Set<string>, errors: string[]) {
  const category = expectRecord(value, `categories[${index}]`, errors);
  if (!category) return;
  validateId(category.id, `categories[${index}].id`, ids, errors);
  validateText(category.label, `categories[${index}].label`, 1, 40, errors);
  if (!isColor(category.accent)) errors.push(`categories[${index}].accent 必须是十六进制颜色`);
  const transition = expectRecord(category.transition, `categories[${index}].transition`, errors);
  if (transition) {
    if (!isStringIn(transition.mode, TRANSITION_MODES)) errors.push(`categories[${index}].transition.mode 无效`);
    if (typeof transition.visible !== "boolean") errors.push(`categories[${index}].transition.visible 必须为布尔值`);
    validateMedia(transition.media, `categories[${index}].transition.media`, "image", new Set<string>(), errors);
  }
}

function validateProject(
  value: unknown,
  index: number,
  categoryIds: Set<string>,
  projectIds: Set<string>,
  errors: string[],
) {
  const project = expectRecord(value, `projects[${index}]`, errors);
  if (!project) return;
  validateId(project.id, `projects[${index}].id`, projectIds, errors);
  if (!Number.isInteger(project.order) || Number(project.order) < 0) errors.push(`projects[${index}].order 无效`);
  if (typeof project.categoryId !== "string" || !categoryIds.has(project.categoryId)) {
    errors.push(`projects[${index}].categoryId 未引用有效分类`);
  }
  validateText(project.title, `projects[${index}].title`, 1, 100, errors);
  if (typeof project.year !== "string" || !/^20\d{2}$/.test(project.year)) errors.push(`projects[${index}].year 无效`);
  if (typeof project.duration !== "string" || !/^\d{1,3}:[0-5]\d$/.test(project.duration)) errors.push(`projects[${index}].duration 无效`);
  validateText(project.synopsis, `projects[${index}].synopsis`, 1, 1200, errors);
  validateText(project.challenge, `projects[${index}].challenge`, 0, 1200, errors);
  validateText(project.solution, `projects[${index}].solution`, 0, 1200, errors);
  const mediaIds = new Set<string>();
  validateMedia(project.cover, `projects[${index}].cover`, "image", mediaIds, errors);
  validateMedia(project.finalVideo, `projects[${index}].finalVideo`, "video", mediaIds, errors);
  const presentation = expectRecord(project.coverPresentation, `projects[${index}].coverPresentation`, errors);
  if (presentation) {
    if (!isStringIn(presentation.overlayMode, COVER_OVERLAY_MODES)) errors.push(`projects[${index}].coverPresentation.overlayMode 无效`);
    for (const field of ["showTitle", "showSynopsis", "showFacts"] as const) {
      if (typeof presentation[field] !== "boolean") errors.push(`projects[${index}].coverPresentation.${field} 必须为布尔值`);
    }
    for (const field of ["titleStyle", "synopsisStyle", "factsStyle"] as const) {
      if (presentation[field] !== undefined) validateCoverTextStyle(presentation[field], `projects[${index}].coverPresentation.${field}`, errors);
    }
  }

  const blocks = expectArray(project.detailBlocks, `projects[${index}].detailBlocks`, errors, 0, 80);
  const blockIds = new Set<string>();
  blocks?.forEach((block, blockIndex) => validateBlock(block, `projects[${index}].detailBlocks[${blockIndex}]`, blockIds, mediaIds, errors));
}

function validateBlock(value: unknown, path: string, ids: Set<string>, mediaIds: Set<string>, errors: string[]) {
  const block = expectRecord(value, path, errors);
  if (!block) return;
  validateId(block.id, `${path}.id`, ids, errors);
  if (typeof block.type !== "string" || !BLOCK_TYPES.has(block.type)) {
    errors.push(`${path}.type 无效`);
    return;
  }
  if (block.type === "text") {
    validateText(block.eyebrow, `${path}.eyebrow`, 0, 80, errors);
    validateText(block.title, `${path}.title`, 1, 120, errors);
    validateText(block.body, `${path}.body`, 1, 4000, errors);
  }
  if (block.type === "media-text") {
    validateMedia(block.media, `${path}.media`, "image", mediaIds, errors);
    if (block.side !== "left" && block.side !== "right") errors.push(`${path}.side 无效`);
    validateText(block.eyebrow, `${path}.eyebrow`, 0, 80, errors);
    validateText(block.title, `${path}.title`, 1, 120, errors);
    validateText(block.body, `${path}.body`, 1, 4000, errors);
  }
  if (block.type === "gallery") {
    validateText(block.eyebrow, `${path}.eyebrow`, 0, 80, errors);
    validateText(block.title, `${path}.title`, 1, 120, errors);
    if (!isStringIn(block.orientation, GALLERY_ORIENTATIONS)) errors.push(`${path}.orientation 无效`);
    const items = expectArray(block.items, `${path}.items`, errors, 1, 4);
    items?.forEach((item, itemIndex) => validateMedia(item, `${path}.items[${itemIndex}]`, "image", mediaIds, errors));
  }
  if (block.type === "full-media") {
    validateMedia(block.media, `${path}.media`, "image", mediaIds, errors);
    validateText(block.caption, `${path}.caption`, 0, 500, errors);
  }
}

function validateMedia(value: unknown, path: string, kind: "image" | "video" | "font", ids: Set<string>, errors: string[]) {
  const media = expectRecord(value, path, errors);
  if (!media) return;
  validateId(media.id, `${path}.id`, ids, errors);
  validateText(media.label, `${path}.label`, 0, 120, errors);
  validateText(media.alt, `${path}.alt`, 0, 240, errors);
  if (media.kind !== kind) errors.push(`${path}.kind 必须为 ${kind}`);
  if (!isStringIn(media.visualKey, VISUAL_KEYS)) errors.push(`${path}.visualKey 无效`);
  if (media.key !== undefined && (typeof media.key !== "string" || !/^portfolio\/[a-zA-Z0-9/_-]+\.[a-z0-9]+$/.test(media.key))) {
    errors.push(`${path}.key 无效`);
  }
  if (media.src !== undefined && (typeof media.src !== "string" || media.src.length > 1000)) errors.push(`${path}.src 无效`);
  if (media.objectPosition !== undefined) {
    const position = expectRecord(media.objectPosition, `${path}.objectPosition`, errors);
    if (position) {
      validateNumber(position.x, `${path}.objectPosition.x`, 0, 100, errors);
      validateNumber(position.y, `${path}.objectPosition.y`, 0, 100, errors);
    }
  }
  if (media.sourceAspectRatio !== undefined) validateNumber(media.sourceAspectRatio, `${path}.sourceAspectRatio`, 0.1, 20, errors);
  if (media.crop !== undefined) {
    const crop = expectRecord(media.crop, `${path}.crop`, errors);
    if (crop) {
      validateNumber(crop.x, `${path}.crop.x`, 0, 100, errors);
      validateNumber(crop.y, `${path}.crop.y`, 0, 100, errors);
      validateNumber(crop.width, `${path}.crop.width`, 5, 100, errors);
      validateNumber(crop.height, `${path}.crop.height`, 5, 100, errors);
      if (typeof crop.x === "number" && typeof crop.width === "number" && crop.x + crop.width > 100.01) errors.push(`${path}.crop 超出图片宽度`);
      if (typeof crop.y === "number" && typeof crop.height === "number" && crop.y + crop.height > 100.01) errors.push(`${path}.crop 超出图片高度`);
    }
  }
}

function normalizeContactConfig(value: unknown): ContactConfig {
  const fallback = createDefaultContactConfig();
  if (!isRecord(value)) return fallback;
  return {
    eyebrow: typeof value.eyebrow === "string" ? value.eyebrow : fallback.eyebrow,
    title: typeof value.title === "string" ? value.title : fallback.title,
    note: typeof value.note === "string" ? value.note : fallback.note,
    layout: isStringIn(value.layout, CONTACT_LAYOUTS) ? value.layout : fallback.layout,
    image: normalizeAsset(value.image) as MediaAsset ?? fallback.image,
    eyebrowStyle: normalizeCoverTextStyle(value.eyebrowStyle, fallback.eyebrowStyle),
    titleStyle: normalizeCoverTextStyle(value.titleStyle, fallback.titleStyle),
    detailsStyle: normalizeCoverTextStyle(value.detailsStyle, fallback.detailsStyle),
    noteStyle: normalizeCoverTextStyle(value.noteStyle, fallback.noteStyle),
  };
}

function validateCoverTextStyle(value: unknown, path: string, errors: string[]) {
  const style = expectRecord(value, path, errors);
  if (!style) return;
  validateNumber(style.x, `${path}.x`, 0, 100, errors);
  validateNumber(style.y, `${path}.y`, 0, 100, errors);
  validateNumber(style.width, `${path}.width`, 10, 100, errors);
  validateNumber(style.scale, `${path}.scale`, 0.5, 2.5, errors);
  if (!isStringIn(style.align, new Set<TextAlign>(["left", "center", "right"]))) errors.push(`${path}.align 无效`);
  if (style.color !== "system" && !isColor(style.color)) errors.push(`${path}.color 无效`);
  if (style.fontFamily !== "system" && style.fontFamily !== "custom") errors.push(`${path}.fontFamily 无效`);
}

function validateId(value: unknown, path: string, ids: Set<string>, errors: string[]) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(value)) {
    errors.push(`${path} 无效`);
    return;
  }
  if (ids.has(value)) errors.push(`${path} 重复`);
  ids.add(value);
}

function validateText(value: unknown, path: string, min: number, max: number, errors: string[]) {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) errors.push(`${path} 长度无效`);
}

function validateNumber(value: unknown, path: string, min: number, max: number, errors: string[]) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) errors.push(`${path} 无效`);
}

function isColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function isStringIn<T extends string>(value: unknown, values: Set<T>): value is T {
  return typeof value === "string" && values.has(value as T);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, path: string, errors: string[]) {
  if (!isRecord(value)) {
    errors.push(`${path} 必须是对象`);
    return null;
  }
  return value;
}

function expectArray(value: unknown, path: string, errors: string[], min: number, max: number) {
  if (!Array.isArray(value)) {
    errors.push(`${path} 必须是数组`);
    return null;
  }
  if (value.length < min || value.length > max) errors.push(`${path} 数量必须在 ${min}-${max} 之间`);
  return value;
}

function safeSerializedLength(value: unknown) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function publicAsset(asset: MediaAsset): MediaAsset {
  if (asset.kind === "video") {
    const { key: _key, src: _src, ...safe } = asset;
    void _key;
    void _src;
    return safe;
  }
  const { key, ...safe } = asset;
  return { ...safe, src: key ? `/api/media/${key}` : asset.src };
}
