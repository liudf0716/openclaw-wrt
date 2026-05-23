import { Type } from "@sinclair/typebox";
import { DeviceIdField, TimeoutField, PortalTemplateField, PortalContentSchema } from "./common.js";

export const GeneratePortalPageSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    template: Type.Optional(PortalTemplateField),
    content: Type.Optional(PortalContentSchema),
    pageName: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          "Optional suggested file name. Returned as details.pageName and details.filePath for use in clawwrt_publish_portal_page.",
      }),
    ),
  },
  { additionalProperties: false },
);

export const PublishPortalPageSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    filePath: Type.String({
      minLength: 1,
      description:
        "Absolute file path to the portal HTML file produced by clawwrt_generate_portal_page (details.filePath). The file will be read and published to the router.",
    }),
    pageName: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          "Output file name under nginx web root. Use details.pageName from clawwrt_generate_portal_page, or omit to auto-generate.",
      }),
    ),
    webRoot: Type.Optional(
      Type.String({ minLength: 1, description: "Optional nginx web root override." }),
    ),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);
