// kilocode_change - bedrock/vertex auth helpers removed with the online cloud surface; only providerKey remains
import type { Auth } from "@/auth"

export function providerKey(providerID: string, auth: Auth.Info) {
  if (auth.type !== "api") return
  // kilocode_change start - amazon-bedrock/google-vertex access remain in the stored-auth surface and keep
  // structured credentials out of the generic provider key; their native loader branches were removed in Step 2
  if (providerID === "amazon-bedrock" && auth.metadata?.authType === "accessKey") return
  if (providerID === "google-vertex" && auth.metadata?.authType === "serviceAccount") return
  // kilocode_change end
  return auth.key
}