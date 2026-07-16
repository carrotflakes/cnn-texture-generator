// Lightweight location.hash-based router.
// Format: #/<route>?key=value&...

export type Route = "catalog" | "edit";

export interface RouteState {
  route: Route;
  params: URLSearchParams;
}

function parseHash(hash: string): RouteState {
  const raw = hash.replace(/^#\/?/, ""); // Remove the leading "#" or "#/".
  const [path, query = ""] = raw.split("?");
  const route: Route = path === "edit" ? "edit" : "catalog";
  return { route, params: new URLSearchParams(query) };
}

export function currentRoute(): RouteState {
  return parseHash(location.hash);
}

function buildHash(route: Route, params: Record<string, string | number>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) search.set(key, String(value));
  const query = search.toString();
  return `#/${route}${query ? `?${query}` : ""}`;
}

// Navigates while adding a history entry so the Back button returns to the previous route.
export function navigate(route: Route, params: Record<string, string | number>): void {
  location.hash = buildHash(route, params);
}

// Updates the current URL without adding a history entry, such as when synchronizing editor parameters.
export function replace(route: Route, params: Record<string, string | number>): void {
  const url = `${location.pathname}${location.search}${buildHash(route, params)}`;
  history.replaceState(null, "", url);
}

export function onRouteChange(callback: (state: RouteState) => void): void {
  window.addEventListener("hashchange", () => callback(currentRoute()));
}
