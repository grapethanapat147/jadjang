import type { Metadata } from "next";
import "@fontsource-variable/anuphan";
import "./globals.css";
import { THEME_BOOT_SCRIPT } from "./lib/theme";
import { SITE_DESCRIPTION, SITE_TITLE, siteMetadata } from "./site-metadata";

export function generateMetadata(): Promise<Metadata> {
  return siteMetadata({ title: SITE_TITLE, description: SITE_DESCRIPTION, path: "/" });
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
