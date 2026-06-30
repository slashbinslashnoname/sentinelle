import type { ReactNode } from "react";

const MARS = "https://science.nasa.gov/wp-content/uploads/2024/03/pia04304-mars.jpg?w=1536";

// Full-bleed Mars background with a rounded white card (hero + form) on top.
export function AuthShell({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div
      className="grid h-full place-items-center bg-cover bg-center p-4"
      style={{ backgroundImage: `url(${MARS})` }}
    >
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 text-zinc-900 shadow-2xl ring-1 ring-black/5">
        <div className="mb-6 text-center">
          <div className="text-3xl">🛡️</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Sentinelle</h1>
          <p className="mt-1 text-sm text-zinc-500">Bitcoin invoicing gateway</p>
          <p className="mt-3 text-sm text-zinc-600">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
