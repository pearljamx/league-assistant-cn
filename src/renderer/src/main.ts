import { createApp } from "vue";
import App from "./App.vue";
import CompanionApp from "./CompanionApp.vue";
import "./style.css";
createApp(
  ["#champion-picker", "#champion-info"].includes(location.hash)
    ? CompanionApp
    : App,
).mount("#app");
