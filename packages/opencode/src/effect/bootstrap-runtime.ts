import { Layer, ManagedRuntime } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

import { Plugin } from "@/plugin"
// kilocode_change - LSP removed; no language-server bootstrap
import { Format } from "@/format"
// kilocode_change - session sharing feature removed; no ShareNext.node in bootstrap group
import { Vcs } from "@/project/vcs"
import { Snapshot } from "@/snapshot"
import { Config } from "@/config/config"
import * as Observability from "@opencode-ai/core/observability"
import { memoMap } from "@opencode-ai/core/effect/memo-map"

export const BootstrapLayer = AppNodeBuilder.build(
  LayerNode.group([Config.node, Plugin.node, Format.node, Vcs.node, Snapshot.node]), // kilocode_change - LSP + session sharing removed
).pipe(Layer.provide(Observability.layer))

export const BootstrapRuntime = ManagedRuntime.make(BootstrapLayer, { memoMap })
