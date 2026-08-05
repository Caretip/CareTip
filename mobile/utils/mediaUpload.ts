import { Alert, Image } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

/** Align with web `CLIENT_IMAGE_MAX_BYTES` / backend imageUploadValidation. */
export const CLIENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 0.82;

export type PickedMedia = {
  uri: string;
  mimeType: string;
  fileName: string;
  width?: number;
  height?: number;
};

export type MediaPickSource = "camera" | "gallery";

export class MediaUploadUserError extends Error {
  readonly code:
    | "CANCELLED"
    | "PERMISSION_DENIED"
    | "UNSUPPORTED_TYPE"
    | "TOO_LARGE"
    | "EMPTY"
    | "OFFLINE";

  constructor(
    code: MediaUploadUserError["code"],
    message: string,
  ) {
    super(message);
    this.name = "MediaUploadUserError";
    this.code = code;
  }
}

function guessMime(uri: string, declared?: string | null): string {
  const d = (declared ?? "").trim().toLowerCase();
  if (d && !d.includes("svg")) return d;
  const lower = uri.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic") || lower.endsWith(".heif")) return "image/heic";
  return "image/jpeg";
}

function assertAllowedMime(mime: string): void {
  if (/svg/i.test(mime)) {
    throw new MediaUploadUserError("UNSUPPORTED_TYPE", "SVG uploads are not allowed.");
  }
  if (!/^image\/(jpeg|jpg|png|gif|webp|heic|heif|avif)$/i.test(mime)) {
    throw new MediaUploadUserError(
      "UNSUPPORTED_TYPE",
      "Unsupported image type. Use JPEG, PNG, GIF, WebP, HEIC, or AVIF.",
    );
  }
}

async function measureBytes(uri: string): Promise<number> {
  try {
    const response = await fetch(uri);
    const blob = await response.blob();
    return blob.size;
  } catch {
    return 0;
  }
}

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      (error) => reject(error),
    );
  });
}

/**
 * Resize/compress for upload — converts to JPEG for consistent backend acceptance.
 * Backend still validates magic bytes / max 5 MB.
 */
export async function prepareImageForUpload(
  uri: string,
  opts?: { maxEdge?: number; quality?: number },
): Promise<PickedMedia> {
  const maxEdge = opts?.maxEdge ?? MAX_EDGE_PX;
  const quality = opts?.quality ?? JPEG_QUALITY;

  let actions: ImageManipulator.Action[] = [];
  try {
    const size = await getImageSize(uri);
    const longest = Math.max(size.width, size.height);
    if (longest > maxEdge) {
      actions =
        size.width >= size.height
          ? [{ resize: { width: maxEdge } }]
          : [{ resize: { height: maxEdge } }];
    }
  } catch {
    actions = [{ resize: { width: maxEdge } }];
  }

  let current = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: quality,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  let bytes = await measureBytes(current.uri);
  if (bytes > CLIENT_IMAGE_MAX_BYTES) {
    current = await ImageManipulator.manipulateAsync(
      current.uri,
      [{ resize: { width: Math.min(1280, maxEdge) } }],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
    );
    bytes = await measureBytes(current.uri);
  }

  if (bytes > CLIENT_IMAGE_MAX_BYTES) {
    throw new MediaUploadUserError("TOO_LARGE", "Image is too large (max 5 MB).");
  }
  if (bytes > 0 && bytes < 32) {
    throw new MediaUploadUserError("EMPTY", "Image file is empty.");
  }

  return {
    uri: current.uri,
    mimeType: "image/jpeg",
    fileName: `caretip-upload-${Date.now()}.jpg`,
    width: current.width,
    height: current.height,
  };
}

async function ensurePermission(source: MediaPickSource): Promise<void> {
  if (source === "camera") {
    const current = await ImagePicker.getCameraPermissionsAsync();
    const result = current.granted
      ? current
      : await ImagePicker.requestCameraPermissionsAsync();
    if (!result.granted) {
      throw new MediaUploadUserError(
        "PERMISSION_DENIED",
        "Camera permission is required to take a photo.",
      );
    }
    return;
  }

  const current = await ImagePicker.getMediaLibraryPermissionsAsync();
  const result = current.granted
    ? current
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!result.granted) {
    throw new MediaUploadUserError(
      "PERMISSION_DENIED",
      "Photo library permission is required to choose an image.",
    );
  }
}

export async function pickImageFromSource(
  source: MediaPickSource,
  opts?: { allowsEditing?: boolean; aspect?: [number, number] },
): Promise<PickedMedia> {
  await ensurePermission(source);

  const launch =
    source === "camera"
      ? ImagePicker.launchCameraAsync
      : ImagePicker.launchImageLibraryAsync;

  const result = await launch({
    mediaTypes: ["images"],
    allowsEditing: opts?.allowsEditing ?? true,
    aspect: opts?.aspect,
    quality: 1,
    exif: false,
  });

  if (result.canceled || !result.assets?.[0]) {
    throw new MediaUploadUserError("CANCELLED", "Cancelled");
  }

  const asset = result.assets[0];
  const mime = guessMime(asset.uri, asset.mimeType);
  assertAllowedMime(mime);

  return prepareImageForUpload(asset.uri);
}

export type MediaPickerLabels = {
  title: string;
  camera: string;
  gallery: string;
  cancel: string;
};

/** Native action sheet: Camera / Gallery / Cancel. Resolves null on cancel. */
export function promptMediaSource(labels: MediaPickerLabels): Promise<MediaPickSource | null> {
  return new Promise((resolve) => {
    Alert.alert(labels.title, undefined, [
      { text: labels.camera, onPress: () => resolve("camera") },
      { text: labels.gallery, onPress: () => resolve("gallery") },
      { text: labels.cancel, style: "cancel", onPress: () => resolve(null) },
    ]);
  });
}

export async function pickAndPrepareImage(opts?: {
  allowsEditing?: boolean;
  aspect?: [number, number];
  labels: MediaPickerLabels;
}): Promise<PickedMedia | null> {
  const source = await promptMediaSource(
    opts?.labels ?? {
      title: "Choose image",
      camera: "Camera",
      gallery: "Gallery",
      cancel: "Cancel",
    },
  );
  if (!source) return null;
  try {
    return await pickImageFromSource(source, {
      allowsEditing: opts?.allowsEditing,
      aspect: opts?.aspect,
    });
  } catch (error) {
    if (error instanceof MediaUploadUserError && error.code === "CANCELLED") {
      return null;
    }
    throw error;
  }
}
