import type { Metadata } from "next";
import { headers } from "next/headers";

export const SITE_TITLE = "จัดแจง — จัดเอกสารให้พร้อมส่ง";
export const SITE_DESCRIPTION =
  "รวม แยก บีบอัด แปลง ใส่เลขหน้า ลงลายเซ็น และจัดหน้า PDF บนอุปกรณ์ของคุณอย่างเป็นส่วนตัว";

/**
 * Metadata for any page of the site. The origin comes from the request, so
 * share images and the canonical link point at whichever host served them.
 */
export async function siteMetadata(page: { title: string; description: string; path: string }): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const image = `${origin}/og-jadjang.png`;

  return {
    metadataBase: new URL(origin),
    title: page.title,
    description: page.description,
    applicationName: "จัดแจง",
    alternates: { canonical: page.path },
    openGraph: {
      title: page.title,
      description: page.description,
      type: "website",
      locale: "th_TH",
      url: page.path,
      images: [{ url: image, width: 1731, height: 909, alt: SITE_TITLE }],
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
      images: [image],
    },
  };
}
