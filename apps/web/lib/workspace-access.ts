/** Public showcase access. Set SUNDOWN_SHARED_ACCESS=false for private deployments. */
export const workspacePassword = "Sundown-Workspace-2026";
export function sharedAccessEnabled(
  env: Record<string, string | undefined> = process.env,
) {
  return env.SUNDOWN_SHARED_ACCESS !== "false";
}
