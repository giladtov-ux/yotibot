import { landingPageUrl } from "./user-access.js";

export function miniAppMenuUpdate() {
  return {
    menu_button: {
      type: "web_app",
      // Keep the indicator yellow to match the official yellow/black logo.
      // The native button's shape and colors are controlled by Telegram.
      text: "🟡",
      web_app: { url: new URL("/app.html", landingPageUrl()).href },
    },
  };
}
