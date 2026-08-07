/**
 * Runtime checks for CareTip ShareService pure helpers.
 * Run: npx tsx scripts/share-service-runtime.ts
 */
import assert from "node:assert/strict";
import {
  isPublicHttpUrl,
  isShareCancellation,
  parseDataUriImage,
} from "../services/share/shareUtils";

function main() {
  const opts = {
    apiBaseUrl: "https://caretip.onrender.com",
    appPublicUrl: "https://caretip.de",
  };

  // Allowlisted public CareTip landings
  assert.equal(isPublicHttpUrl("https://caretip.de/acme/jane", opts), true);
  assert.equal(isPublicHttpUrl("https://www.caretip.de/tip/x", opts), true);
  assert.equal(isPublicHttpUrl("https://caretip.de/qr/employee/abc", opts), true);

  // Reject localhost / LAN / http
  assert.equal(isPublicHttpUrl("http://localhost:5173/tip", opts), false);
  assert.equal(isPublicHttpUrl("https://localhost/tip", opts), false);
  assert.equal(isPublicHttpUrl("https://127.0.0.1/tip", opts), false);
  assert.equal(isPublicHttpUrl("https://192.168.1.10/tip", opts), false);
  assert.equal(isPublicHttpUrl("http://caretip.de/acme", opts), false);

  // Reject staging / tunnels / Render API host
  assert.equal(isPublicHttpUrl("https://staging.caretip.de/x", opts), false);
  assert.equal(isPublicHttpUrl("https://caretip.onrender.com/public", opts), false);
  assert.equal(isPublicHttpUrl("https://foo.expo.dev/x", opts), false);
  assert.equal(isPublicHttpUrl("https://abc.ngrok-free.app/x", opts), false);

  // Reject API paths, auth, credentials, tokens, JWTs, signed URLs
  assert.equal(isPublicHttpUrl("https://caretip.de/api/employees/me", opts), false);
  assert.equal(isPublicHttpUrl("https://caretip.de/auth/login", opts), false);
  assert.equal(isPublicHttpUrl("https://user:pass@caretip.de/x", opts), false);
  assert.equal(isPublicHttpUrl("https://caretip.de/?access_token=abc", opts), false);
  assert.equal(isPublicHttpUrl("https://caretip.de/?refresh_token=abc", opts), false);
  assert.equal(isPublicHttpUrl("https://caretip.de/?token=abc", opts), false);
  assert.equal(
    isPublicHttpUrl(
      "https://caretip.de/?X-Amz-Signature=deadbeef&X-Amz-Credential=x",
      opts,
    ),
    false,
  );
  assert.equal(
    isPublicHttpUrl(
      "https://caretip.de/?jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig",
      opts,
    ),
    false,
  );

  // Reject arbitrary third-party hosts
  assert.equal(isPublicHttpUrl("https://evil.com/phish", opts), false);
  assert.equal(isPublicHttpUrl("file:///tmp/x.png", opts), false);
  assert.equal(isPublicHttpUrl("", opts), false);
  assert.equal(isPublicHttpUrl("not-a-url", opts), false);

  // Custom app public host from EXPO_PUBLIC_APP_URL (https only)
  assert.equal(
    isPublicHttpUrl("https://app.example.com/tip/1", {
      appPublicUrl: "https://app.example.com",
      apiBaseUrl: "https://api.example.com",
    }),
    true,
  );
  assert.equal(
    isPublicHttpUrl("https://api.example.com/tip/1", {
      appPublicUrl: "https://app.example.com",
      apiBaseUrl: "https://api.example.com",
    }),
    false,
  );

  const png = parseDataUriImage("data:image/png;base64,aGVsbG8=");
  assert.ok(png);
  assert.equal(png.mimeType, "image/png");
  assert.equal(png.extension, "png");
  assert.equal(png.base64, "aGVsbG8=");

  assert.equal(parseDataUriImage("data:text/plain;base64,YQ=="), null);
  assert.equal(parseDataUriImage("https://example.com/a.png"), null);

  assert.equal(isShareCancellation({ message: "User did not share" }), true);
  assert.equal(isShareCancellation({ message: "Sharing canceled" }), true);
  assert.equal(isShareCancellation({ message: "Network request failed" }), false);

  console.log("share-service-runtime: ok");
}

main();
