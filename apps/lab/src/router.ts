import { createRouter, createWebHistory } from "vue-router";
import FilesPage from "./pages/FilesPage.vue";
import PlannedPage from "./pages/PlannedPage.vue";
import SandboxPage from "./pages/SandboxPage.vue";

export const routes = [
  { path: "/", name: "Files", component: FilesPage },
  {
    path: "/sprites",
    name: "Sprites",
    component: PlannedPage,
    props: { title: "Sprites", description: "Browse every sprite and animation with its palette." },
  },
  {
    path: "/music",
    name: "Music",
    component: PlannedPage,
    props: { title: "Music", description: "Listen to the music and sound effects." },
  },
  {
    path: "/levels",
    name: "Levels",
    component: PlannedPage,
    props: { title: "Levels", description: "Inspect the puzzle layouts, parts and goals of each level." },
  },
  { path: "/sandbox", name: "Sandbox", component: SandboxPage },
];

export const router = createRouter({ history: createWebHistory(), routes });
