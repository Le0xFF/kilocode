import path from "path"

process.env.KILO_DB = ":memory:"
// kilocode_change - KILO_MODELS_PATH flag removed; tests write <cache>/models.json directly instead
process.env.KILO_DISABLE_MODELS_FETCH = "true"

// kilocode_change start - fail closed: core unit tests do not redirect XDG dirs, so KILO_DB
// is the only thing keeping them off the real ~/.local/share/kilo database. Verify the
// resolved path (env is read at flag import time, so this must stay after the env writes).
const { Database } = await import("../src/database/database")
const resolved = Database.path()
if (resolved !== ":memory:") {
  throw new Error(`unit test preload: database path must resolve to ":memory:", got "${resolved}"`)
}
// kilocode_change end
