import type { Metadata } from "next";
import { headers } from "next/headers";
import "@fontsource-variable/anuphan";
import "./globals.css";
import { THEME_BOOT_SCRIPT } from "./lib/theme";

const title = "จัดแจง — จัดเอกสารให้พร้อมส่ง";
const description =
  "รวม แยก บีบอัด แปลง และจัดหน้า PDF บนอุปกรณ์ของคุณอย่างเป็นส่วนตัว";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const image = `${origin}/og-jadjang.png`;

  return {
    metadataBase: new URL(origin),
    title,
    description,
    applicationName: "จัดแจง",
    openGraph: {
      title,
      description,
      type: "website",
      locale: "th_TH",
      images: [{ url: image, width: 1731, height: 909, alt: "จัดแจง — จัดเอกสารให้พร้อมส่ง" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <head>
        {/* Applies a saved theme before the first paint. Without it the page
            renders in the system theme and then flips, which is worse than
            having no switcher at all. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        {/* Declared here rather than through metadata so they land in <head>,
            where a browser looks when deciding whether the app is installable. */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#4263eb" />
        <link rel="icon" href="/favicon.svg" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="จัดแจง" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body>{children}</body>
    </html>
  );
}
