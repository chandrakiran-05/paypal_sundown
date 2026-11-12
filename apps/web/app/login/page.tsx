import { redirect } from "next/navigation";
import LoginForm from "../../components/login-form";
import { sharedAccessEnabled } from "../../lib/workspace-access";
export const dynamic = "force-dynamic";
export default function Login() {
  if (sharedAccessEnabled()) redirect("/overview");
  return <LoginForm workspacePassword={null} />;
}
