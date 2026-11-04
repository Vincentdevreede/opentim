import { createRouter, createWebHistory } from "vue-router";
import AudioPage from "./pages/AudioPage.vue";
import FilesPage from "./pages/FilesPage.vue";
import ImportPage from "./pages/ImportPage.vue";
import LevelsPage from "./pages/LevelsPage.vue";
import MissingPage from "./pages/MissingPage.vue";
import SandboxPage from "./pages/SandboxPage.vue";
import SpritesPage from "./pages/SpritesPage.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: ImportPage },
    { path: "/sprites", component: SpritesPage },
    { path: "/levels", component: LevelsPage },
    { path: "/files", component: FilesPage },
    { path: "/audio", component: AudioPage },
    // Locked until files are loaded, like its menu item; App shows the empty state in its place.
    { path: "/sandbox", component: SandboxPage, meta: { needsFiles: true } },
    // Any other address, like a page from another branch, gets an empty state instead of an empty page.
    { path: "/:missing(.*)*", component: MissingPage },
  ],
});
