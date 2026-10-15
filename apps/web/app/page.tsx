import { HealthStatus } from "../components/health-status";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">Clippings</h1>
      <HealthStatus />
    </main>
  );
}
