/** Optional shared workspace access, disabled unless explicitly enabled. */
export const workspacePassword = "Sundown-Workspace-2026";
export function sharedAccessEnabled(
  env: Record<string, string | undefined> = process.env,
) {
  return env.SUNDOWN_SHARED_ACCESS === "true";
}
