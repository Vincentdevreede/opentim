import { createRouter, createWebHistory } from "vue-router";
import FilesPage from "./pages/FilesPage.vue";
import ImportPage from "./pages/ImportPage.vue";
import PlannedPage from "./pages/PlannedPage.vue";
import SandboxPage from "./pages/SandboxPage.vue";
import SpritesPage from "./pages/SpritesPage.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: ImportPage },
    { path: "/sprites", component: SpritesPage },
    {
      path: "/levels",
      component: PlannedPage,
      props: { title: "Levels", description: "Inspect the layout, parts and goal of each level." },
    },
    { path: "/files", component: FilesPage },
    {
      path: "/audio",
      component: PlannedPage,
      props: { title: "Audio", description: "Listen to the music and sound effects." },
    },
    { path: "/sandbox", component: SandboxPage },
  ],
});
