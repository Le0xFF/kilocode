import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { IndexingStatusInfo, IndexingWarningInfo } from "@/kilocode/indexing-event"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"

export { IndexingStatusInfo, IndexingStatusState, IndexingWarningInfo } from "@/kilocode/indexing-event"

const root = "/indexing"
const IndexingConsent = Schema.Struct({
  enabled: Schema.Boolean,
})

export const IndexingPaths = {
  status: `${root}/status`,
  consent: `${root}/consent`,
  models: `${root}/models`,
  warnings: `${root}/warnings`,
} as const

export const IndexingApi = HttpApi.make("indexing")
  .add(
    HttpApiGroup.make("indexing")
      .add(
        HttpApiEndpoint.get("status", IndexingPaths.status, {
          query: WorkspaceRoutingQuery,
          success: described(IndexingStatusInfo, "Indexing status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "indexing.status",
            summary: "Get indexing status",
            description: "Retrieve the current code indexing status for the active project.",
          }),
        ),
        HttpApiEndpoint.get("warnings", IndexingPaths.warnings, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(IndexingWarningInfo), "Indexing warnings"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "indexing.warnings",
            summary: "Get indexing warnings",
            description: "Retrieve code indexing warnings for the active project.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.get("models", IndexingPaths.models, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Schema.String), "Configured embedding model ids"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "indexing.models",
            summary: "List configured embedding models",
            description: "List the embedding models configured for local indexing providers.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.put("consent", IndexingPaths.consent, {
          query: WorkspaceRoutingQuery,
          payload: IndexingConsent,
          success: described(IndexingStatusInfo, "Indexing status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "indexing.consent",
            summary: "Set indexing consent",
            description: "Set machine-local code indexing consent for the active project.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "indexing",
          description: "Kilo indexing routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "kilo HttpApi",
      version: "0.0.1",
      description: "Kilo HttpApi surface.",
    }),
  )
