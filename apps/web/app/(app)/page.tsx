import { HealthStatus } from "../components/health-status";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-180">
      <h1 className="py-4 typescale-headline-sm">Clippings</h1>
      <HealthStatus />
    </div>
  );
}
