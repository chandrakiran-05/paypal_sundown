/** Shared document metadata and local system typography. */
import "./globals.css";
export const metadata = {
  title: "Sundown — Migrate with proof",
  description:
    "Legacy checkout → Orders v2 → agent-ready, with differential parity evidence.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
