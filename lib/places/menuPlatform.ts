/**
 * menuPlatform — detect a venue whose ONLY web presence is a third-party menu/listing
 * platform (kwickmenu, menu11, wheree) rather than its own first-party site.
 *
 * Operator 2026-06-13: these are not real first-party venues worth featuring — when a
 * stub's website is one of these AND it has no live happy hour, soft-delete it
 * (scripts/drop-menu-platform-stubs.ts). This DELIBERATELY reverses the older
 * siteTriage "keep ordering/social links as crowdsource stubs" stance for this narrow
 * class of pure menu-display hosts.
 *
 * NOT to be confused with lib/recover/sourceProvenance MENU_HOSTS — that allowlists
 * asset/CDN hosts (toasttab, squarespace) that legitimately serve a real venue's own
 * menu. Here the platform IS the venue's entire web presence, which is the problem.
 *
 * Pure, no I/O. Easily extended — add a host below.
 */
const MENU_PLATFORM_HOSTS = [
  "kwickmenu.com",
  "menu11.com",
  "wheree.com",
];

/** Lowercase host with leading "www." stripped; null if unparseable. */
function host(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** True when the URL's host IS (or is a subdomain of) a known menu-platform host. */
export function isMenuPlatformWebsite(url: string | null | undefined): boolean {
  const h = host(url);
  if (!h) return false;
  return MENU_PLATFORM_HOSTS.some((p) => h === p || h.endsWith(`.${p}`));
}
