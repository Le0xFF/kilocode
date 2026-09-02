// kilocode_change - new file
import { RemoteExitRpc } from "@/kilocode/cli/cmd/tui/remote-exit-rpc"

export function createWorkerRemoteExit(emit: (event: string, data: undefined) => void) {
  let registered = false

  const gone = () => {
    registered = false
  }

  return {
    ready() {
      registered = true
    },
    gone,
    shutdown: gone,
  }
}