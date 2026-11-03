import { createRouter, createWebHistory } from "vue-router";
import AudioPage from "./pages/AudioPage.vue";
import FilesPage from "./pages/FilesPage.vue";
import ImportPage from "./pages/ImportPage.vue";
import LevelsPage from "./pages/LevelsPage.vue";
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
    { path: "/sandbox", component: SandboxPage },
  ],
});
