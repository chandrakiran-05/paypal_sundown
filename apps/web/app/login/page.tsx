import LoginForm from "../../components/login-form";
import {
  workspacePassword,
  sharedAccessEnabled,
} from "../../lib/workspace-access";
export const dynamic = "force-dynamic";
export default function Login() {
  return (
    <LoginForm
      workspacePassword={sharedAccessEnabled() ? workspacePassword : null}
    />
  );
}
