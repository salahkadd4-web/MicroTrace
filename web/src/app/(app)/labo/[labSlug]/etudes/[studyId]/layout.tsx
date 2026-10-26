import type { ReactNode } from "react";
import { DataNatureBanner } from "@/components/app/DataNatureBanner";
import { PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { loadStudy } from "./load-study";
import { StudyTabs } from "./StudyTabs";

export default async function StudyLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ labSlug: string; studyId: string }>;
}) {
  const { labSlug, studyId } = await params;
  const study = await loadStudy(labSlug, studyId);
  return (
    <>
      <PageHeader
        title={study.title}
        subtitle={`Projet : ${study.project.title}`}
        actions={study.archivedAt ? <Badge variant="secondary">Archivée</Badge> : undefined}
      />
      <DataNatureBanner nature={study.nature} />
      <StudyTabs labSlug={labSlug} studyId={study.id} />
      {children}
    </>
  );
}
