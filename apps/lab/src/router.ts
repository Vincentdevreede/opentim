import { createRouter, createWebHistory } from "vue-router";
import ImportPage from "./pages/ImportPage.vue";

/**
 * The import page comes with the app, because every visit starts there or on a page that needs it. The other pages
 * load the first time they are opened, so the first load doesn't wait for code like the sandbox's PixiJS.
 */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: ImportPage },
    { path: "/sprites", component: () => import("./pages/SpritesPage.vue") },
    { path: "/parts", component: () => import("./pages/PartsPage.vue") },
    { path: "/levels", component: () => import("./pages/LevelsPage.vue") },
    { path: "/files", component: () => import("./pages/FilesPage.vue") },
    { path: "/audio", component: () => import("./pages/AudioPage.vue") },
    { path: "/sandbox", component: () => import("./pages/SandboxPage.vue") },
    // Any other address, like a page from another branch, gets an empty state instead of an empty page.
    { path: "/:missing(.*)*", component: () => import("./pages/MissingPage.vue") },
  ],
});
