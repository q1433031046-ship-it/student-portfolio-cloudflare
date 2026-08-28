import type { Metadata } from "next";
import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: await resolveMetadataBase(),
    title: "中科云领学生作品展示",
    description: "中科云领学生原创影像、动画与视觉设计作品集。让学习有作品，让作品被看见。",
    openGraph: {
      title: "中科云领学生作品展示",
      description: "让每一个创意，被看见。",
      type: "website",
      locale: "zh_CN",
      images: [{ url: "/og.png", width: 1731, height: 909, alt: "中科云领学生作品展示" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "中科云领学生作品展示",
      description: "让每一个创意，被看见。",
      images: ["/og.png"],
    },
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

async function resolveMetadataBase() {
  const configured = String(Reflect.get(env, "SITE_URL") ?? "").trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:") return new URL(url.origin);
    } catch {
      // Fall through to the verified request hostname.
    }
  }
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  if (!/^(?:[a-z0-9-]+\.)*[a-z0-9-]+(?::\d{1,5})?$/iu.test(host)) return new URL("http://localhost");
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return new URL(`${protocol}://${host}`);
}
