import type { Metadata } from "next";
import { headers } from "next/headers";
import "@fontsource-variable/anuphan";
import "./globals.css";

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
      <body>{children}</body>
    </html>
  );
}
