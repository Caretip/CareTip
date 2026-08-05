import type { AxiosRequestHeaders } from "axios";
import { apiClient } from "@/services/api/client";
import type { PickedMedia } from "@/utils/mediaUpload";

/**
 * React Native FormData file part — must not set JSON Content-Type
 * (browser/RN sets multipart boundary automatically).
 */
export function appendImagePart(
  form: FormData,
  fieldName: string,
  media: PickedMedia,
): void {
  form.append(fieldName, {
    uri: media.uri,
    name: media.fileName,
    type: media.mimeType,
  } as unknown as Blob);
}

export async function postMultipart<T>(path: string, form: FormData): Promise<T> {
  const { data } = await apiClient.post<T>(path, form, {
    headers: {
      Accept: "application/json",
    },
    transformRequest: [
      (body, headers) => {
        const h = headers as AxiosRequestHeaders | undefined;
        if (h) {
          delete h["Content-Type"];
          delete h["content-type"];
        }
        return body;
      },
    ],
    // Large photos on slow networks
    timeout: Math.max(apiClient.defaults.timeout ?? 20_000, 60_000),
  });
  return data;
}
