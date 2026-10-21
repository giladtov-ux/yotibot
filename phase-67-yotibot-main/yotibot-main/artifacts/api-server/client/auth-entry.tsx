import React from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider, SignIn, SignUp } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { heIL } from "@clerk/localizations";
import { Route, Router as WouterRouter, Switch, useLocation } from "wouter";
import "./auth.css";

declare global {
  interface ImportMetaEnv {
    readonly BASE_URL: string;
    readonly VITE_CLERK_PUBLISHABLE_KEY: string;
    readonly VITE_CLERK_PROXY_URL: string;
    readonly VITE_CLERK_AUTH_MODE: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

const clerkPubKey = import.meta.env.VITE_CLERK_AUTH_MODE === "external"
  ? import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
  : publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_AUTH_MODE === "external"
  ? undefined : import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const stripBase = (path: string) =>
  basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;

const appearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: "/",
    logoImageUrl: `${window.location.origin}/brand/ah-sheli-logo-yellow-black.png`,
  },
  variables: {
    colorPrimary: "#FFD000",
    colorForeground: "#f4f8ff",
    colorMutedForeground: "#b4c7dd",
    colorDanger: "#ffaaa0",
    colorBackground: "#10294b",
    colorInput: "#071b35",
    colorInputForeground: "#f4f8ff",
    colorNeutral: "#537293",
    fontFamily: "'Heebo', sans-serif",
    borderRadius: "14px",
  },
  elements: {
    rootBox: { display: "flex", justifyContent: "center", width: "100%" },
    cardBox: { width: "440px", maxWidth: "calc(100vw - 28px)", overflow: "hidden", border: "1px solid #355679", borderRadius: "20px", backgroundColor: "#10294b", boxShadow: "0 18px 54px rgba(0, 8, 27, .38)" },
    card: { border: "0", borderRadius: "0", backgroundColor: "transparent", boxShadow: "none" },
    footer: { border: "0", borderTop: "1px solid #355679", borderRadius: "0", backgroundColor: "transparent", boxShadow: "none" },
    headerTitle: { color: "#f4f8ff", fontWeight: 700 },
    headerSubtitle: { color: "#b4c7dd" },
    socialButtonsBlockButtonText: { color: "#f4f8ff", fontWeight: 600 },
    formFieldLabel: { color: "#dce7f3", fontWeight: 600 },
    footerActionLink: { color: "#ffe575", fontWeight: 700 },
    footerActionText: { color: "#b4c7dd" },
    dividerText: { color: "#b4c7dd" },
    identityPreviewEditButton: { color: "#ffd000" },
    formFieldSuccessText: { color: "#ffd000", fontWeight: 600 },
    alertText: { color: "#ffd9d4" },
    logoBox: { overflow: "hidden", borderRadius: "12px" },
    logoImage: { borderRadius: "12px", objectFit: "cover" },
    socialButtonsBlockButton: { border: "1px solid #496684", borderRadius: "10px", backgroundColor: "#0c2241", color: "#f4f8ff" },
    formButtonPrimary: { border: "0", borderRadius: "10px", backgroundColor: "#ffd000", color: "#080808", fontWeight: 800 },
    formFieldInput: { border: "1px solid #496684", borderRadius: "10px", backgroundColor: "#071b35", color: "#f4f8ff" },
    footerAction: { borderTop: "1px solid #355679" },
    dividerLine: { backgroundColor: "#496684" },
    alert: { border: "1px solid #8b4545", borderRadius: "10px", backgroundColor: "#482d3b" },
    otpCodeFieldInput: { border: "1px solid #496684", borderRadius: "9px", backgroundColor: "#071b35", color: "#f4f8ff" },
    formFieldRow: { color: "#f4f8ff" },
    main: { color: "#f4f8ff" },
  },
};

function AuthScreens() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={appearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={heIL}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <div className="auth-page" dir="rtl">
        <header className="auth-header">
          <a href="/" className="auth-brand" aria-label="אח שלי">
            <img src="/brand/ah-sheli-logo-yellow-black.png" alt="אח שלי" />
          </a>
          <p>המרחב שלך, ממשיך איתך</p>
        </header>
        <main className="auth-main">
          <Switch>
            <Route path="/sign-in/*?">
              <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} forceRedirectUrl="/app.html" />
            </Route>
            <Route path="/sign-up/*?">
              <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} forceRedirectUrl="/app.html" />
            </Route>
          </Switch>
          <p className="auth-footnote">נדרש אימות כתובת דוא״ל וחיבור לחשבון Telegram כדי לפתוח את המרחב.</p>
        </main>
      </div>
    </ClerkProvider>
  );
}

function App() {
  if (!clerkPubKey) throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY.");
  return <WouterRouter base={basePath}><AuthScreens /></WouterRouter>;
}

createRoot(document.getElementById("auth-root")!).render(<App />);
