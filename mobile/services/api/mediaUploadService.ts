import { API_ENDPOINTS } from "@/constants/endpoints";
import { appendImagePart, postMultipart } from "@/services/api/multipartUpload";
import type { PickedMedia } from "@/utils/mediaUpload";

/** Same contract as web `uploadMyBusinessLogo` — field `file`. */
export async function uploadBusinessLogo(
  media: PickedMedia,
): Promise<{ success: boolean; path: string }> {
  const form = new FormData();
  appendImagePart(form, "file", media);
  return postMultipart(API_ENDPOINTS.business.profileLogo, form);
}

/** Same contract as web `uploadEmployeeAvatar` — field `avatar`. */
export async function uploadEmployeeAvatar(
  media: PickedMedia,
): Promise<{ avatar: string }> {
  const form = new FormData();
  appendImagePart(form, "avatar", media);
  return postMultipart(API_ENDPOINTS.employees.meAvatar, form);
}
