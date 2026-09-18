import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"

const root = "/media-local"

export const MediaModelInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
})

export const GeneratePayload = Schema.Struct({
  prompt: Schema.String,
  model: Schema.String.annotate({ description: "Model reference in providerID/modelID form" }),
  size: Schema.optional(Schema.String),
  n: Schema.optional(Schema.Number),
})

export class MediaLocalFailedError extends Schema.ErrorClass<MediaLocalFailedError>("MediaLocalFailedError")(
  { message: Schema.String },
  { httpApiStatus: 502 },
) {}

const ModelListResponse = Schema.Array(MediaModelInfo)

export const MediaLocalApi = HttpApi.make("kilocode")
  .add(
    HttpApiGroup.make("media-local")
      .add(
        HttpApiEndpoint.get("imgModels", `${root}/img/models`, {
          query: WorkspaceRoutingQuery,
          success: described(ModelListResponse, "Configured image generation models"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "media-local.img.models",
            summary: "List local image generation models",
            description: "List image generation models declared in the experimental config.",
          }),
        ),
        HttpApiEndpoint.post("imgGenerate", `${root}/img/generate`, {
          query: WorkspaceRoutingQuery,
          payload: GeneratePayload,
          success: described(Schema.Unknown, "Image generation response"),
          error: [HttpApiError.BadRequest, MediaLocalFailedError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "media-local.img.generate",
            summary: "Generate images via a local provider",
            description: "Proxy an image generation request to the configured local OpenAI-compatible provider.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "media-local",
          description: "Local media (image) proxy routes.",
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