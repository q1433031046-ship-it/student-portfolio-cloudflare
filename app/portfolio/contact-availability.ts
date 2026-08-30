import type { ContactConfig, HeroConfig } from "./model";

type ContactHero = Pick<HeroConfig, "email" | "phone">;
type ContactDetails = Pick<ContactConfig, "eyebrow" | "title" | "note" | "image">;

export function hasContactContent(hero: ContactHero, contact: ContactDetails) {
  return Boolean(
    hero.email.trim()
    || hero.phone.trim()
    || contact.eyebrow.trim()
    || contact.title.trim()
    || contact.note.trim()
    || contact.image.src
    || contact.image.key
    || contact.image.available === true,
  );
}
