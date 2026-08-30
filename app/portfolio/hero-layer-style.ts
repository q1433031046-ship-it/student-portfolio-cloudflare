import type { CSSProperties } from "react";
import type { HeroLayer } from "./model";

export function heroLayerStyle(layer: HeroLayer): CSSProperties {
  return {
    "--layer-x": `${layer.x}%`,
    "--layer-y": `${layer.y}%`,
    "--layer-width": `${layer.width}%`,
    "--layer-scale": layer.scale,
    "--layer-z": layer.zIndex,
    "--layer-align": layer.align,
    color: layer.color === "system" ? undefined : layer.color,
    fontFamily: layer.fontFamily === "custom" ? "PortfolioCustom, sans-serif" : undefined,
  } as CSSProperties;
}
