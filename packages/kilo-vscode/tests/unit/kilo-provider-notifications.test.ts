import { describe, expect, it } from "bun:test"

// kilocode_change - offline fork: the Kilo gateway notification pipeline
// (fetchAndSendNotifications / dismissNotification and the src/kilo-provider/notifications
// module) was removed with the offline surface. Remote notifications no longer exist, so
// there is nothing to assert here. This file is kept as an explicit marker of the removed
// surface rather than deleted, so a future upstream sync does not silently re-add tests
// for a module that intentionally does not exist in this fork.
describe("KiloProvider local notifications", () => {
  it("has no notification surface in the offline fork", () => {
    // Placeholder: the offline fork exposes no fetchAndSendNotifications/dismissNotification
    // API, so this suite intentionally asserts only that the marker holds.
    expect(true).toBe(true)
  })
})
