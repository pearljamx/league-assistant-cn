import { createApp } from "vue";
import App from "./App.vue";
import CompanionApp from "./CompanionApp.vue";
import OverlayApp from "./OverlayApp.vue";
import "./style.css";
createApp(
  ["#champion-picker", "#champion-info"].includes(location.hash)
    ? CompanionApp
    : location.hash === "#overlay"
      ? OverlayApp
      : App,
).mount("#app");
