export type PortfolioPreviewTarget =
  | { kind: "hero"; slideId?: string }
  | { kind: "project"; projectId: string }
  | { kind: "contact" }
  | { kind: "end-cover"; slideId?: string };
