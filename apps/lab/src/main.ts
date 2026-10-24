import "@fontsource/silkscreen/400.css";
import { createApp } from "vue";
import App from "./App.vue";
import { restore } from "./library.ts";
import { router } from "./router.ts";
import "./style.css";

createApp(App).use(router).mount("#app");
void restore();
