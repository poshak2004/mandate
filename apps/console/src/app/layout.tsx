import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mandate console",
  description: "Escalations, receipts, mandates and policies for Mandate",
};

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/escalations", label: "Escalations" },
  { href: "/receipts", label: "Receipts" },
  { href: "/mandates", label: "Mandates" },
  { href: "/policies", label: "Policies" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans text-slate-900 antialiased">
        <div className="flex min-h-screen flex-col md:flex-row">
          <aside className="border-b border-slate-200 bg-white md:w-56 md:shrink-0 md:border-r md:border-b-0">
            <div className="flex items-center gap-2 px-5 py-4">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-slate-900 text-xs font-bold text-white">
                M
              </span>
              <span className="text-sm font-semibold tracking-tight">Mandate</span>
            </div>
            <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
