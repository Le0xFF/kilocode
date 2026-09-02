// kilocode_change - new file
// The remote session relay was removed from this build; keep a stub test so the
// CLI command registration stays covered without pulling in deleted modules.

import { describe, expect, test } from "bun:test"
import { RemoteCommand } from "../../../../src/cli/cmd/remote"

describe("RemoteCommand (offline)", () => {
  test("declares the remote command", () => {
    expect(RemoteCommand.command).toBe("remote")
  })
})