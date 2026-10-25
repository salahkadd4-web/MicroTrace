import { PageHeader } from "@/components/app/PageHeader";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl p-6">
      <PageHeader
        title="MicroTrace Studio"
        subtitle="Prototype de recherche, pas un dispositif médical"
      />
    </main>
  );
}
