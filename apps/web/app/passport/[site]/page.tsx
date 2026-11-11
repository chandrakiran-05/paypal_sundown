import Dashboard from "../../../components/dashboard";
import { notFound } from "next/navigation";
export default async function SitePassport({
  params,
}: {
  params: Promise<{ site: string }>;
}) {
  const { site } = await params;
  if (!/^(?:[1-9]|1[0-2])$/.test(site)) notFound();
  return <Dashboard page="passport" siteId={Number(site)} />;
}
