/** Named product routes share the operational shell. */
import Dashboard from "../../components/dashboard";
import { notFound } from "next/navigation";
export default async function Product({
  params,
}: {
  params: Promise<{ page: string }>;
}) {
  const { page } = await params;
  if (
    ![
      "overview",
      "plan",
      "parity",
      "readiness",
      "portfolio",
      "agent-demo",
      "passport",
    ].includes(page)
  )
    notFound();
  return <Dashboard page={page} />;
}
