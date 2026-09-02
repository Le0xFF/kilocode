// kilocode_change - new file
import { cmd } from "./cmd"

export const RemoteCommand = cmd({
  command: "remote",
  describe: "enable remote connection for real-time session relay",
  builder: (yargs) => yargs,
  handler: async () => {
    console.log("Remote session relay is not available in this build. Sessions stay local.")
  },
})

export function buildInstanceAdvertisement(): { name: string; projectName: string; version?: string } {
  return { name: "", projectName: "" }
}