import { env } from "cloudflare:workers";
import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser } from "../chatgpt-auth";
import { AdminClient } from "./admin-client";
import { AdminInteractionEnhancements } from "./admin-interaction-enhancements";
import { AdminUpgradeCenter } from "./admin-upgrade-center";
import styles from "./admin.module.css";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const sitesPlatform = String(Reflect.get(env, "AUTH_PLATFORM")) === "sites";
  const user = sitesPlatform ? await getChatGPTUser() : null;
  return <main className={styles.adminShell}>
    <AdminClient
      initialEmail={user?.email ?? null}
      signInHref={sitesPlatform ? chatGPTSignInPath("/admin") : null}
      signOutHref={sitesPlatform ? chatGPTSignOutPath("/admin") : null}
    />
    <AdminUpgradeCenter />
    <AdminInteractionEnhancements />
  </main>;
}
