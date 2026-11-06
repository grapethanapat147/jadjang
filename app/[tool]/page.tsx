import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Workspace } from "../Workspace";
import { siteMetadata } from "../site-metadata";
import { TOOLS, toolBySlug } from "../lib/tools";

type Params = { params: Promise<{ tool: string }> };

export function generateStaticParams() {
  return TOOLS.map((tool) => ({ tool: tool.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const tool = toolBySlug((await params).tool);
  if (!tool) return {};
  return siteMetadata({ title: `${tool.title} | จัดแจง`, description: tool.description, path: `/${tool.slug}` });
}

/** Each tool at its own address, so a search for that job can land on it directly. */
export default async function ToolPage({ params }: Params) {
  const tool = toolBySlug((await params).tool);
  if (!tool) notFound();
  return <Workspace initialTool={tool.id} toolPage />;
}
