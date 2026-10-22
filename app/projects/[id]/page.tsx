import type { Metadata } from "next";
import { WorkspaceView } from "@/components/projects/workspace/WorkspaceView";

export const metadata: Metadata = {
  title: "Project · VYXO",
  description: "A project workspace: private chat, files, reviewed changes, and a website preview.",
};

interface ProjectPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ brief?: string | string[] }>;
}

export default async function ProjectPage({ params, searchParams }: ProjectPageProps) {
  const { id } = await params;
  const query = await searchParams;
  // The description typed when the project was created. The workspace turns it into a first draft once.
  const brief = typeof query.brief === "string" ? query.brief.slice(0, 2000) : null;

  return (
    <section className="mx-auto flex h-full min-h-0 w-full max-w-[1320px] flex-col">
      <WorkspaceView key={id} projectId={id} brief={brief} />
    </section>
  );
}
