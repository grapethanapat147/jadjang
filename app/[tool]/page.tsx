import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Workspace } from "../Workspace";
import { siteMetadata } from "../site-metadata";
import { JOBS, TOOLS, jobBySlug, toolBySlug } from "../lib/tools";

type Params = { params: Promise<{ tool: string }> };

export function generateStaticParams() {
  return [...TOOLS, ...JOBS].map((page) => ({ tool: page.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { tool: slug } = await params;
  const job = jobBySlug(slug);
  if (job) return siteMetadata({ title: `${job.title} | จัดแจง`, description: job.description, path: `/${job.slug}` });
  const tool = toolBySlug(slug);
  if (!tool) return {};
  return siteMetadata({ title: `${tool.title} | จัดแจง`, description: tool.description, path: `/${tool.slug}` });
}

/** Each tool at its own address, so a search for that job can land on it directly. */
export default async function ToolPage({ params }: Params) {
  const { tool: slug } = await params;
  const job = jobBySlug(slug);
  if (job) return <Workspace initialTool={job.tool} toolPage initialJob={job} />;
  const tool = toolBySlug(slug);
  if (!tool) notFound();
  return <Workspace initialTool={tool.id} toolPage />;
}
