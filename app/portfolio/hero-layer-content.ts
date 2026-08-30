import type { HeroConfig, HeroLayerKind } from "./model";

type HeroLayerCopy = Pick<HeroConfig, "statement" | "role" | "targetRole" | "email" | "phone">;

export function hasHeroLayerContent(kind: HeroLayerKind, hero: HeroLayerCopy) {
  if (kind === "identity") return true;
  if (kind === "statement") return Boolean(hero.statement.trim());
  return [hero.role, hero.targetRole, hero.email, hero.phone].some((value) => Boolean(value.trim()));
}
