import { RemoteAvatar, type RemoteAvatarTone } from "@/components/ui/RemoteAvatar";

type AvatarProps = {
  label: string;
  size?: number;
  tone?: RemoteAvatarTone;
  /** Remote photo URL when available — falls back to initials from `label`. */
  uri?: string | null;
  cacheBust?: number | string | null;
};

/**
 * Back-compat wrapper around {@link RemoteAvatar}.
 * Prefer importing `RemoteAvatar` / `BusinessLogo` in new code.
 */
export function Avatar({ label, size = 40, tone = "brand", uri, cacheBust }: AvatarProps) {
  return (
    <RemoteAvatar
      displayName={label}
      uri={uri}
      size={size}
      tone={tone}
      cacheBust={cacheBust}
    />
  );
}
