export class BrandedQrNotFoundError extends Error {
  readonly code = "BRANDED_QR_NOT_FOUND" as const;

  constructor(message = "Branded QR not found") {
    super(message);
    this.name = "BrandedQrNotFoundError";
  }
}

export class BrandedQrRenderUnavailableError extends Error {
  readonly code = "BRANDED_QR_RENDER_UNAVAILABLE" as const;

  constructor(message = "Branded QR rendering is temporarily unavailable") {
    super(message);
    this.name = "BrandedQrRenderUnavailableError";
  }
}

export class BrandedQrRenderFailedError extends Error {
  readonly code = "BRANDED_QR_RENDER_FAILED" as const;

  constructor(message = "Branded QR render failed") {
    super(message);
    this.name = "BrandedQrRenderFailedError";
  }
}
