import { useState, useEffect, useMemo } from "react";
import { resolveMediaUrl } from "../../lib/mediaUrl";
import { LetterAvatar } from "./letter-avatar";
import { cn } from "./utils";
import { Dialog, DialogContent, DialogTitle } from "./dialog";

/** Square employee photo — matches the QR customer journey (`rounded-md` + light ring). */
export const employeePhotoFrameClass = "rounded-md ring-1 ring-border/50";

export type ProfileAvatarProps = {
  /** Raw URL from API (absolute, relative `/uploads/...`, or null). */
  src?: string | null;
  displayName: string;
  alt?: string;
  /** Outer size: e.g. `h-12 w-12`, `h-20 w-20 sm:h-24 sm:w-24`. Min size guards against 0×0 layout bugs. */
  className?: string;
  /** Use square tiles (e.g. employee pick grid); default is circular. */
  variant?: "round" | "square";
  /** Tap / click photo to open full-size viewer (default: true when a photo loads). */
  lightbox?: boolean;
};

/**
 * Profile / employee photo with API-relative URL resolution, `object-cover`, and load-error fallback.
 * This project uses Vite + React (not Next.js); use this instead of `next/image`.
 */
export function ProfileAvatar({
  src,
  displayName,
  alt,
  className,
  variant = "round",
  lightbox = true,
}: ProfileAvatarProps) {
  const resolved = useMemo(() => resolveMediaUrl(src), [src]);
  const [imgFailed, setImgFailed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [resolved]);

  const showPhoto = Boolean(resolved) && !imgFailed;
  const name = displayName?.trim() || "?";
  const isSquare = variant === "square";
  const canLightbox = lightbox && showPhoto;
  const [imgReady, setImgReady] = useState(false);

  useEffect(() => {
    setImgReady(false);
  }, [resolved]);

  const photoClassName = cn(
    "h-full w-full object-cover object-center caretip-marketing-img",
    imgReady && "caretip-marketing-img--ready",
  );

  const photoImg = (
    <img
      src={resolved}
      alt={alt ?? name}
      className={cn("pointer-events-none", photoClassName)}
      onLoad={() => setImgReady(true)}
      onError={() => setImgFailed(true)}
      loading="lazy"
      decoding="async"
    />
  );

  return (
    <>
      <div
        className={cn(
          "relative shrink-0 overflow-hidden bg-muted",
          isSquare ? "rounded-md" : "rounded-full",
          "min-h-8 min-w-8",
          canLightbox && "cursor-zoom-in",
          className
        )}
      >
        {showPhoto ? (
          canLightbox ? (
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              className={cn(
                "absolute inset-0 z-[1] h-full w-full p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isSquare ? "rounded-md" : "rounded-full"
              )}
              aria-label={`View ${name} profile photo full size`}
            >
              {!imgReady ? <span className="caretip-image-frame__shimmer" aria-hidden /> : null}
              {photoImg}
            </button>
          ) : (
            <>
              {!imgReady ? <span className="caretip-image-frame__shimmer" aria-hidden /> : null}
              <img
                src={resolved}
                alt={alt ?? name}
                className={cn("absolute inset-0", photoClassName)}
                onLoad={() => setImgReady(true)}
                onError={() => setImgFailed(true)}
                loading="lazy"
                decoding="async"
              />
            </>
          )
        ) : (
          <div className="absolute inset-0 flex h-full w-full items-stretch justify-stretch">
            <LetterAvatar
              name={name}
              size="full"
              className={cn(
                "h-full w-full min-h-0 min-w-0 text-2xl",
                isSquare ? "rounded-md" : "rounded-full"
              )}
            />
          </div>
        )}
      </div>

      {canLightbox ? (
        <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
          <DialogContent
            className="max-h-[min(96vh,900px)] w-[min(96vw,1200px)] max-w-[min(96vw,1200px)] translate-x-[-50%] translate-y-[-50%] gap-0 border-0 bg-transparent p-2 shadow-none sm:max-w-[min(96vw,1200px)]"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <DialogTitle className="sr-only">Profile photo: {name}</DialogTitle>
            <img
              src={resolved}
              alt={alt ?? name}
              className="mx-auto max-h-[min(90vh,900px)] w-full rounded-lg object-contain"
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

/** Employee / team-member photo — same square frame as the QR customer journey. */
export function EmployeeProfilePhoto(props: Omit<ProfileAvatarProps, "variant">) {
  const { className, ...rest } = props;
  return (
    <ProfileAvatar
      {...rest}
      variant="square"
      className={cn(employeePhotoFrameClass, "aspect-square", className)}
    />
  );
}
