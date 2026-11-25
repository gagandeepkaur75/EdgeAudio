/**
 * The site's main menu. Used by the top bar (PageNav) and the home page's side
 * menu so both always show the same pages in the same order.
 */
export function useSiteNavLinks() {
  return [
    { to: "/", label: "Home" },
    { to: "/project", label: "Project" },
    { to: "/team", label: "Team" },
    { to: "/deliverables", label: "Deliverables" },
    { to: "/final-presentation", label: "Latest Presentation" },
    { to: "/live-communication", label: "Live Test" },
    { to: "/timeline", label: "Timeline" },
    { to: "/architecture", label: "Architecture" },
    { to: "/documentation", label: "Documentation" },
    { to: "/admin", label: "Admin" },
  ];
}

/** True when `to` is the page currently shown. */
export function isNavActive(pathname, to) {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}
