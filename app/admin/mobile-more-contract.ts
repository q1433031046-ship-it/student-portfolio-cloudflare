export const ADMIN_MOBILE_MORE_CLOSE_EVENT = "admin:mobile-more-close";

export function closeAdminMobileMore() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ADMIN_MOBILE_MORE_CLOSE_EVENT));
}
