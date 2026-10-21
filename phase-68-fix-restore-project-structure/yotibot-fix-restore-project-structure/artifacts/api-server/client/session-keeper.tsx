import React from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider, useAuth, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { heIL } from "@clerk/localizations";

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

function SessionPresence() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const clerk = useClerk();
  React.useEffect(() => {
    if (!isLoaded) return;
    Object.assign(window, { AhSheliEmailSignOut: () => clerk.signOut({ redirectUrl: "/" }) });
    window.dispatchEvent(new CustomEvent("ah-sheli-email-ready", { detail: { signedIn: isSignedIn === true, userId: userId || null } }));
  }, [isLoaded, isSignedIn, userId, clerk]);
  return <span hidden aria-hidden="true" data-clerk-session={isLoaded && isSignedIn ? "active" : "loading"} />;
}

if (!clerkPubKey) throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY.");

const rootNode = document.createElement("div");
rootNode.hidden = true;
rootNode.setAttribute("aria-hidden", "true");
rootNode.dataset.sessionKeeper = "clerk";
document.body.append(rootNode);

createRoot(rootNode).render(
  <ClerkProvider
    publishableKey={clerkPubKey}
    proxyUrl={clerkProxyUrl}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    localization={heIL}
  >
    <SessionPresence />
  </ClerkProvider>,
);
