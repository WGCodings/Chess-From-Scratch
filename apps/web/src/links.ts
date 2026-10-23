// Links in the desktop app: a desktop window can't open browser tabs, so web
// pages open in the user's browser and the guide opens in its own window.
// On the website links work as they are.

import { desktop } from "./platform";

/** Opens the guide (at a page) in its own window, or a browser tab on the website. */
export async function openGuide(page = "Home"): Promise<void> {
  const url = `guide.html#${page}`;
  if (!desktop) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const existing = await WebviewWindow.getByLabel("guide");
  if (existing) {
    await existing.emit("guide-page", page);
    await existing.setFocus();
    return;
  }
  new WebviewWindow("guide", { url, title: "Guide · Chess From Scratch", width: 1000, height: 820 });
}

export function installDesktopLinks(): void {
  if (!desktop) return;
  const d = desktop;
  document.addEventListener("click", (e) => {
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || e.defaultPrevented) return;
    const url = new URL(a.href, location.href);
    if (/^https?:$/.test(url.protocol) && url.origin !== location.origin) {
      e.preventDefault();
      void d.openUrl(url.href);
    } else if (url.pathname.endsWith("/guide.html") && !location.pathname.endsWith("/guide.html")) {
      e.preventDefault();
      void openGuide(decodeURIComponent(url.hash.slice(1)) || "Home");
    }
  });
}
