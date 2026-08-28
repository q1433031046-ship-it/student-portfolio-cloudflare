export type ExpansionMode = "single" | "multiple";
export type HeroEffect = "halo" | "signal";
export type ThemeKey = "graphite" | "ivory" | "cobalt" | "white";
export type VisualKey = "portrait" | "city" | "frame" | "character" | "storyboard";

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
  slides: Array<{
    id: string;
    media: MediaAsset;
    contentMode: "image-only" | "system" | "free";
    effect: HeroEffect;
    animationEnabled: boolean;
    layers: Array<{
      id: string;
      kind: "identity" | "statement" | "facts";
      x: number;
      y: number;
      width: number;
      scale: number;
      align: "left" | "center" | "right";
      zIndex: number;
      visible: boolean;
    }>;
  }>;
};

export type CategoryConfig = {
  id: string;
  label: string;
  accent: string;
  transition: { mode: "default" | "image"; media: MediaAsset };
};

export type MediaAsset = {
  id: string;
  label: string;
  alt: string;
  src?: string;
  visualKey: VisualKey;
};

export type ProjectBlock =
  | {
      id: string;
      type: "text";
      eyebrow: string;
      title: string;
      body: string;
    }
  | {
      id: string;
      type: "media-text";
      media: MediaAsset;
      side: "left" | "right";
      eyebrow: string;
      title: string;
      body: string;
    }
  | {
      id: string;
      type: "gallery";
      eyebrow: string;
      title: string;
      items: MediaAsset[];
    }
  | {
      id: string;
      type: "full-media";
      media: MediaAsset;
      caption: string;
    };

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
  detailBlocks: ProjectBlock[];
};

export type PortfolioDemoConfig = {
  hero: HeroConfig;
  themes: ThemeConfig[];
  categories: CategoryConfig[];
  projects: Project[];
};

export const portfolioDemo: PortfolioDemoConfig = {
  hero: {
    name: "林予安",
    role: "AI 影像创作者",
    targetRole: "视觉设计 / AIGC 导演",
    email: "hello@linyuan.studio",
    phone: "+86 138 0000 0000",
    statement: "把想象变成有节奏、有情绪，也能被记住的画面。",
    availability: "2026 · SEEKING NEW STORIES",
    slides: [
      {
        id: "hero-slide-1",
        contentMode: "system",
        effect: "halo",
        animationEnabled: true,
        media: { id: "hero-media", label: "个人首幅", alt: "林予安个人作品集首幅画面", visualKey: "frame" },
        layers: [
          { id: "identity", kind: "identity", x: 3, y: 68, width: 40, scale: 1, align: "left", zIndex: 2, visible: true },
          { id: "statement", kind: "statement", x: 3, y: 87, width: 36, scale: 1, align: "left", zIndex: 2, visible: true },
          { id: "facts", kind: "facts", x: 72, y: 72, width: 25, scale: 1, align: "left", zIndex: 3, visible: true },
        ],
      },
      {
        id: "hero-slide-2",
        contentMode: "image-only",
        effect: "signal",
        animationEnabled: false,
        media: { id: "hero-media-2", label: "个人首幅 02", alt: "林予安个人作品集第二张首幅画面", visualKey: "portrait" },
        layers: [
          { id: "identity", kind: "identity", x: 3, y: 68, width: 40, scale: 1, align: "left", zIndex: 2, visible: true },
          { id: "statement", kind: "statement", x: 3, y: 87, width: 36, scale: 1, align: "left", zIndex: 2, visible: true },
          { id: "facts", kind: "facts", x: 72, y: 72, width: 25, scale: 1, align: "left", zIndex: 3, visible: true },
        ],
      },
    ],
  },
  themes: [
    { id: "graphite", label: "石墨", swatches: ["#0a0a0b", "#f3f1ec", "#a9c7d6"] },
    { id: "ivory", label: "暖白", swatches: ["#f1eee7", "#161618", "#c95032"] },
    { id: "cobalt", label: "深海", swatches: ["#07101d", "#edf4ff", "#67d7c5"] },
    { id: "white", label: "纯白", swatches: ["#ffffff", "#111217", "#3258ff"] },
  ],
  categories: [
    { id: "narrative", label: "AI 剧情短片", accent: "#9fb4ff", transition: { mode: "default", media: { id: "transition-narrative", label: "", alt: "", visualKey: "frame" } } },
    { id: "commercial", label: "AI 广告片", accent: "#ff9e7a", transition: { mode: "default", media: { id: "transition-commercial", label: "", alt: "", visualKey: "frame" } } },
    { id: "comic", label: "AI 漫剧", accent: "#8de0cb", transition: { mode: "default", media: { id: "transition-comic", label: "", alt: "", visualKey: "frame" } } },
    { id: "visual", label: "视觉实验", accent: "#dcc5ff", transition: { mode: "default", media: { id: "transition-visual", label: "", alt: "", visualKey: "frame" } } },
  ],
  projects: [
    {
      id: "echo-after",
      order: 1,
      categoryId: "narrative",
      title: "回声之后",
      year: "2026",
      duration: "02:48",
      synopsis: "一段关于记忆、告别与重新选择的 AI 剧情短片。作品用重复出现的蓝色光源，把人物无法说出口的情绪连接起来。",
      challenge: "在多场景切换中维持人物外观与情绪连续，同时让 AI 生成画面拥有可控的镜头节奏。",
      solution: "先建立角色与场景基准，再按镜头拆分动作和情绪强度，最后统一光色、声音与剪辑节拍。",
      cover: {
        id: "echo-cover",
        label: "项目封面",
        alt: "《回声之后》项目封面示意",
        visualKey: "city",
      },
      finalVideo: {
        id: "echo-final",
        label: "成稿 · 02:48",
        alt: "《回声之后》成稿播放器",
        visualKey: "city",
      },
      detailBlocks: [
        {
          id: "echo-intent",
          type: "media-text",
          side: "right",
          eyebrow: "01 / CREATIVE INTENT",
          title: "让光成为记忆的坐标",
          body: "人物每次接近真相，环境中的冷光就会更靠近镜头。视觉线索替代了解释性对白，也让生成镜头之间拥有统一的情绪锚点。",
          media: {
            id: "echo-keyframe",
            label: "情绪关键帧",
            alt: "《回声之后》冷光情绪关键帧示意",
            visualKey: "frame",
          },
        },
        {
          id: "echo-storyboard",
          type: "gallery",
          eyebrow: "02 / STORYBOARD",
          title: "分镜与节奏",
          items: [
            { id: "echo-board-1", label: "01 · 进入", alt: "进入场景分镜示意", visualKey: "storyboard" },
            { id: "echo-board-2", label: "02 · 靠近", alt: "靠近光源分镜示意", visualKey: "city" },
            { id: "echo-board-3", label: "03 · 回望", alt: "人物回望分镜示意", visualKey: "portrait" },
          ],
        },
        {
          id: "echo-character",
          type: "media-text",
          side: "left",
          eyebrow: "03 / CHARACTER",
          title: "角色一致性不是一张设定图",
          body: "角色资产按正侧面、表情和服装层级组织。生成前先锁定不可变化的识别特征，再为不同镜头开放姿态与光线变化。",
          media: {
            id: "echo-character-sheet",
            label: "角色设定",
            alt: "角色设定与表情变化示意",
            visualKey: "character",
          },
        },
        {
          id: "echo-final-frame",
          type: "full-media",
          caption: "最终单帧 · 冷光从环境线索变成角色主动做出的选择。",
          media: {
            id: "echo-full-frame",
            label: "最终单帧",
            alt: "《回声之后》最终单帧示意",
            visualKey: "frame",
          },
        },
      ],
    },
    {
      id: "soft-signal",
      order: 2,
      categoryId: "commercial",
      title: "微光正发生",
      year: "2026",
      duration: "01:36",
      synopsis: "为一款概念香氛创作的 AI 广告片。画面从材料质感出发，用微距、慢动作和呼吸般的留白建立气味联想。",
      challenge: "在没有真实产品拍摄的条件下，让瓶体、液体和光线保持可信，并避免镜头语言落入普通产品展示。",
      solution: "先以材质和光线定义品牌感，再把产品形态分解成可重复控制的轮廓，最后用声音强化触感。",
      cover: {
        id: "signal-cover",
        label: "项目封面",
        alt: "《微光正发生》项目封面示意",
        visualKey: "portrait",
      },
      finalVideo: {
        id: "signal-final",
        label: "成稿 · 01:36",
        alt: "《微光正发生》成稿播放器",
        visualKey: "portrait",
      },
      detailBlocks: [
        {
          id: "signal-concept",
          type: "text",
          eyebrow: "01 / CONCEPT",
          title: "先设计感觉，再设计镜头",
          body: "项目先确定柔软、清凉、靠近皮肤三个感觉关键词，再把它们翻译成材质、景别和运动速度。这样每一帧都有共同的判断标准。",
        },
        {
          id: "signal-assets",
          type: "gallery",
          eyebrow: "02 / MATERIAL STUDY",
          title: "材质与光线测试",
          items: [
            { id: "signal-asset-1", label: "玻璃", alt: "玻璃材质测试示意", visualKey: "frame" },
            { id: "signal-asset-2", label: "雾", alt: "雾化光线测试示意", visualKey: "city" },
            { id: "signal-asset-3", label: "液体", alt: "液体运动测试示意", visualKey: "portrait" },
            { id: "signal-asset-4", label: "高光", alt: "边缘高光测试示意", visualKey: "character" },
          ],
        },
        {
          id: "signal-final-frame",
          type: "full-media",
          caption: "成片单帧 · 产品轮廓只在一次呼吸的时间里完整出现。",
          media: {
            id: "signal-full-frame",
            label: "成片单帧",
            alt: "《微光正发生》成片单帧示意",
            visualKey: "portrait",
          },
        },
      ],
    },
  ],
};
