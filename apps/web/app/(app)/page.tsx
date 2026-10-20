import { ClippingsHome } from "@/components/clippings/clippings-home.tsx";

export default function HomePage({ searchParams }: PageProps<"/">) {
  return <ClippingsHome searchParams={searchParams} />;
}
