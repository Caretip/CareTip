import { useSyncExternalStore } from "react";
import {
  getMediaCacheGeneration,
  subscribeMediaCacheGeneration,
} from "@/utils/mediaCacheGeneration";

/** Subscribe to post-upload media cache busts for RemoteAvatar / BusinessLogo. */
export function useMediaCacheGeneration(): number {
  return useSyncExternalStore(
    subscribeMediaCacheGeneration,
    getMediaCacheGeneration,
    getMediaCacheGeneration,
  );
}
