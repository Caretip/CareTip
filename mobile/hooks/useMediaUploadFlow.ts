import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/hooks/useI18n";
import { useUserQueryKeys } from "@/services/api/queryKeys";
import { invalidateMediaSurfaces } from "@/services/api/invalidateUserQueries";
import {
  uploadBusinessLogo,
  uploadEmployeeAvatar,
} from "@/services/api/mediaUploadService";
import { showErrorToast, showSuccessToast } from "@/store/toastStore";
import { useUserStore } from "@/store/userStore";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import { requireOnline } from "@/utils/requireOnline";
import {
  MediaUploadUserError,
  pickAndPrepareImage,
  type PickedMedia,
} from "@/utils/mediaUpload";

type UploadKind = "businessLogo" | "employeeAvatar";

function isUserCancel(error: unknown): boolean {
  return error instanceof MediaUploadUserError && error.code === "CANCELLED";
}

function mediaErrorToastKey(code: MediaUploadUserError["code"]): string {
  switch (code) {
    case "PERMISSION_DENIED":
      return "settings.media.permissionDenied";
    case "TOO_LARGE":
      return "settings.media.tooLarge";
    case "UNSUPPORTED_TYPE":
      return "settings.media.unsupportedType";
    case "EMPTY":
      return "settings.media.empty";
    case "OFFLINE":
      return "errors.offline";
    default:
      return "settings.media.uploadError";
  }
}

/**
 * Camera/gallery → compress → existing multipart endpoint → invalidateMediaSurfaces.
 */
export function useMediaUploadFlow(kind: UploadKind) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const keys = useUserQueryKeys();
  const [uploading, setUploading] = useState(false);

  const run = useCallback(async () => {
    if (uploading) return;

    if (!(await requireOnline())) {
      showErrorToast(t("errors.offline"));
      return;
    }

    let media: PickedMedia | null = null;
    try {
      media = await pickAndPrepareImage({
        allowsEditing: kind === "employeeAvatar",
        aspect: kind === "employeeAvatar" ? [1, 1] : undefined,
        labels: {
          title: t("settings.media.chooseTitle"),
          camera: t("settings.media.camera"),
          gallery: t("settings.media.gallery"),
          cancel: t("common.cancel"),
        },
      });
    } catch (error) {
      if (isUserCancel(error)) return;
      if (error instanceof MediaUploadUserError) {
        showErrorToast(t(mediaErrorToastKey(error.code)));
        return;
      }
      showErrorToast(friendlyErrorMessage(error, t("settings.media.uploadError"), t));
      return;
    }

    if (!media) return;

    if (!(await requireOnline())) {
      showErrorToast(t("errors.offline"));
      return;
    }

    setUploading(true);
    try {
      if (kind === "businessLogo") {
        const result = await uploadBusinessLogo(media);
        if (result.path) {
          queryClient.setQueryData(keys.businessProfile, (prev: unknown) => {
            if (!prev || typeof prev !== "object") return prev;
            return { ...(prev as Record<string, unknown>), logo: result.path };
          });
        }
        await invalidateMediaSurfaces(queryClient, keys, { syncAuthUser: false });
        showSuccessToast(t("settings.media.logoUploaded"));
        return;
      }

      const result = await uploadEmployeeAvatar(media);
      if (result.avatar) {
        queryClient.setQueryData(keys.employeeMe, (prev: unknown) => {
          if (!prev || typeof prev !== "object") return prev;
          return { ...(prev as Record<string, unknown>), avatar: result.avatar };
        });
        const user = useUserStore.getState().user;
        if (user) {
          useUserStore.getState().setUser({ ...user, avatar: result.avatar });
        }
      }
      await invalidateMediaSurfaces(queryClient, keys, { syncAuthUser: true });
      showSuccessToast(t("settings.media.avatarUploaded"));
    } catch (error) {
      if (error instanceof MediaUploadUserError) {
        showErrorToast(t(mediaErrorToastKey(error.code)));
        return;
      }
      showErrorToast(friendlyErrorMessage(error, t("settings.media.uploadError"), t));
    } finally {
      setUploading(false);
    }
  }, [kind, keys, queryClient, t, uploading]);

  return { uploading, startUpload: run };
}
