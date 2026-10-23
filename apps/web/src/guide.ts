/**
 * The guide: the pages in docs/wiki (also published as the GitHub wiki),
 * shown on the site. Links between pages are wiki style, `[text](Page-Name)`.
 */

import { marked } from "marked";
import { installDesktopLinks } from "./links";
import { isDesktop } from "./platform";
import "./style.css";

const raw = import.meta.glob("../../../docs/wiki/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const PAGES = new Map(Object.entries(raw).map(([path, text]) => [path.split("/").pop()!.replace(/\.md$/, ""), text]));

/** Wiki links (`Page-Name`) become `#Page-Name`; outside links open in a new tab. */
function render(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  for (const a of doc.querySelectorAll("a")) {
    const href = a.getAttribute("href") ?? "";
    if (/^https?:/.test(href)) {
      a.target = "_blank";
      a.rel = "noopener";
    } else if (PAGES.has(href)) {
      a.setAttribute("href", `#${href}`);
    }
  }
  return doc.body.firstElementChild!.innerHTML;
}

const nav = document.getElementById("guide-nav")!;
const main = document.getElementById("guide-page")!;
nav.innerHTML = render(PAGES.get("_Sidebar") ?? "");

function show(): void {
  const name = decodeURIComponent(location.hash.slice(1)) || "Home";
  const md = PAGES.get(name) ?? `# Page not found\n\nThere is no page called *${name}*. Go back to the [start](Home).`;
  main.innerHTML = render(md);
  document.title = `${main.querySelector("h1")?.textContent ?? "Guide"} · Chess From Scratch`;
  for (const a of nav.querySelectorAll("a")) a.classList.toggle("current", a.getAttribute("href") === `#${name}`);
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", show);
show();

// In the desktop app the guide is its own window: no way "back", web links open in the browser.
installDesktopLinks();
if (isDesktop) {
  for (const a of document.querySelectorAll<HTMLAnchorElement>('.topbar a[href="./"]')) {
    if (a.classList.contains("btn")) a.hidden = true;
    else a.removeAttribute("href");
  }
  void import("@tauri-apps/api/event").then(({ listen }) => listen<string>("guide-page", (e) => (location.hash = e.payload)));
}
