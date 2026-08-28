import type { HeroLayer } from "./model";

const round = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function clampHeroLayer(layer: HeroLayer): HeroLayer {
  const width = round(clamp(layer.width, 10, 100));
  return {
    ...layer,
    x: round(clamp(layer.x, 0, 100 - width)),
    y: round(clamp(layer.y, 0, 100)),
    width,
    scale: round(clamp(layer.scale, 0.5, 2.5)),
    zIndex: Math.round(clamp(layer.zIndex, 1, 20)),
  };
}

export function moveHeroLayer(layer: HeroLayer, dxPercent: number, dyPercent: number): HeroLayer {
  return clampHeroLayer({ ...layer, x: layer.x + dxPercent, y: layer.y + dyPercent });
}

export function resizeHeroLayer(layer: HeroLayer, dxPercent: number): HeroLayer {
  return clampHeroLayer({ ...layer, width: layer.width + dxPercent });
}

export function keyboardMoveDelta(key: string, shiftKey: boolean) {
  const step = shiftKey ? 5 : 1;
  if (key === "ArrowLeft") return { x: -step, y: 0 };
  if (key === "ArrowRight") return { x: step, y: 0 };
  if (key === "ArrowUp") return { x: 0, y: -step };
  if (key === "ArrowDown") return { x: 0, y: step };
  return null;
}
