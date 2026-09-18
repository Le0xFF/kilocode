export namespace BoardEnabled {
  // kilocode_change - offline fork: the shared agent board (Kilo Swarm) defaults to OFF;
  // upstream v7.7.4 flipped it on-by-default, which this fork must not inherit
  /**
   * Resolve the effective shared agent board state.
   *
   * The offline fork ships with the board disabled. It is enabled only by an
   * explicit opt-in: `shared_agent_board` set to `true` in config, or the
   * `KILO_EXPERIMENTAL_SHARED_AGENT_BOARD` flag set to a truthy boolean (the
   * umbrella `KILO_EXPERIMENTAL` does not enable it). The board stays fully
   * local — it stores messages in the session database and never contacts any
   * remote or gateway endpoint.
   */
  export function resolve(input: { config?: boolean; flag?: boolean }) {
    if (input.config === false || input.flag === false) return false
    return input.config === true || input.flag === true
  }

  export function on(cfg: { shared_agent_board?: boolean }, flags: { experimentalSharedAgentBoard?: boolean }) {
    return resolve({ config: cfg.shared_agent_board, flag: flags.experimentalSharedAgentBoard })
  }
}
