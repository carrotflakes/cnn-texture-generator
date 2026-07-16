// Application entry point and routing setup. Mounts the catalog or editor for the active route.

import "./styles.css";
import { currentRoute, onRouteChange, replace, type RouteState } from "./router";
import { mountCatalog } from "./catalog";
import { mountEdit } from "./edit";
import { mountFavoritesDrawer } from "./favorites-drawer";

const app = document.getElementById("app")!;
let dispose: (() => void) | null = null;

mountFavoritesDrawer();

function mount(state: RouteState): void {
  dispose?.();
  dispose = state.route === "edit" ? mountEdit(app, state.params) : mountCatalog(app, state.params);
}

// Normalize an empty hash to the first catalog page.
if (!location.hash) {
  replace("catalog", { page: 0 });
}

onRouteChange(mount);
mount(currentRoute());
