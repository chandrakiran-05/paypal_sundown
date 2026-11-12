import { redirect } from "next/navigation";
/** Preserve old bookmarks without maintaining a separate demo. */
export default function DemoRedirect() {
  redirect("/overview");
}
