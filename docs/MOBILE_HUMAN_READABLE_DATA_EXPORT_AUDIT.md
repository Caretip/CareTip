# CareTip Mobile — Human-Readable Data Export

## Status legend

| Label | Meaning |
| --- | --- |
| **AUDITED** | Inspected; documented as-is |
| **IMPLEMENTED** | Changed in this task |
| **TESTED** | Covered by automated and/or documented manual checks |
| **NOT CHANGED** | Intentionally left alone |

---

## 1. Audit findings

### Employee (AUDITED)

| Item | Finding |
| --- | --- |
| Mobile entry | Settings → **Data & privacy** → **Download my data** |
| API | `GET /api/employees/me/export` |
| Auth | Verified email + role **EMPLOYEE**; scoped by authenticated `userId` |
| Payload | JSON: `exportedAt`, `profile{name,email,jobTitle,bio,avatar,monthlyGoal,accountCreatedAt}`, `tips[{id,amount,createdAt}]` (success tips only) |
| Isolation | Own employee row + own tips only; no client `userId` / `businessId` |
| Web | Same endpoint; browser downloads `caretip-my-data-YYYY-MM-DD.json` |
| Prior mobile UX | Re-wrote JSON to `caretip-data-export.json` and opened the native share sheet (felt like “raw JSON”) |

### Manager (AUDITED)

| Item | Finding |
| --- | --- |
| Personal “Download my data” | **Does not exist** on mobile manager settings |
| Manager settings privacy item | Opens **Privacy Policy** legal doc only (`/(app)/info/privacy`) |
| Related export | Business tip **CSV** via `GET /api/transactions/export` (venue analytics — **not** personal DSAR) |
| Employee endpoint reuse | **Not allowed** (`requireRole(EMPLOYEE)`); managers get 403 |
| Product decision | **No manager personal-data PDF invented** in this task |

### Backend / web contract (AUDITED · NOT CHANGED)

- Employee JSON export endpoint, headers, and payload semantics unchanged.
- Web employee download remains JSON.
- Async DSAR (`POST /api/me/export`) remains unused by mobile/web product UI.

---

## 2. Employee export — before / after

| | Before | After |
| --- | --- | --- |
| User-facing file | Raw JSON | Human-readable **PDF** |
| Filename | `caretip-data-export.json` | `caretip-my-data-YYYY-MM-DD.pdf` |
| Delivery | Native share sheet | Native share sheet (`sharePdf`) |
| Data source | Same API JSON | Same API JSON → on-device PDF render |
| Tip IDs in file | Present in JSON | **Omitted** from PDF (still in backend JSON) |
| Success copy | “Export ready to share” | “Your data export is ready. You can now save or share the PDF.” |

**IMPLEMENTED** · **TESTED** (helpers + typecheck + mobile-runtime)

---

## 3. Manager export — before / after

| | Before | After |
| --- | --- | --- |
| Personal data PDF | N/A | **Still N/A** |
| Change | — | **NOT CHANGED** |

Adding a manager personal export would need an authorized personal-data API (or explicit product scope). Reusing the employee endpoint or stuffing business-wide data into a “my data” PDF was rejected.

---

## 4. Existing backend / export contract

**NOT CHANGED**

```
GET /api/employees/me/export
Content-Type: application/json; charset=utf-8
Content-Disposition: attachment; filename="caretip-my-data-YYYY-MM-DD.json"
```

Mobile still **fetches** this JSON; it no longer presents JSON as the primary user file.

---

## 5. PDF structure

```
CareTip — My Data Export
Export date: <human-readable>

## My Profile
Name / Email / Job title / Bio / Monthly tip goal / Account created

## My Tips
Date | Tip amount
(rows; or “No tips recorded.”)

## Total Tips
€X.XX
```

- Dates: `en-GB` / `de-DE` long form  
- Money: CareTip `formatEur` (€) — export API has **no currency field**; product UI is euro-based  
- HTML escaped; multi-page via print engine; no raw JSON, no tip `id`

**IMPLEMENTED**

---

## 6. Filename change

`caretip-data-export.json` → **`caretip-my-data-YYYY-MM-DD.pdf`** (from `exportedAt`).

**IMPLEMENTED**

---

## 7. Success-message change

EN: *Your data export is ready. You can now save or share the PDF.*  
DE: *Ihr Datenexport ist bereit. Sie können die PDF jetzt speichern oder teilen.*

Does not claim CareTip auto-saved the file without the share sheet.

**IMPLEMENTED**

---

## 8. Security / tenant isolation

| Check | Result |
| --- | --- |
| Still uses authenticated `GET /api/employees/me/export` | Yes |
| Role gate still EMPLOYEE on backend | Yes (**NOT CHANGED**) |
| No client-supplied foreign userId/businessId | Yes |
| PDF built only from that response | Yes |
| Manager personal export not fabricated | Yes |
| GDPR deletion / retention / legal hold | **NOT CHANGED** |

**AUDITED** · **TESTED** (source assertions against route + service)

---

## 9. Tests performed and results

| Test | Result |
| --- | --- |
| `npm run typecheck` (mobile) | PASS |
| `npm run test:data-export` | PASS — PDF/HTML helpers, filename, no tip IDs, employee-only privacy-data |
| `npm run test:share` | PASS |
| `npm run test:mobile-runtime` | PASS (includes `test:data-export`) |
| Device PDF open / share | **Not claimed** — requires device with `expo-print` in the native binary |

---

## 10. Files changed

| File | Role |
| --- | --- |
| `mobile/package.json` / lockfile | `expo-print`, `test:data-export` |
| `mobile/services/api/employeeService.ts` | JSON fetch → PDF → `sharePdf` |
| `mobile/services/export/employeeDataExportTypes.ts` | Parse authorized payload |
| `mobile/services/export/buildEmployeeDataExportHtml.ts` | Human-readable HTML |
| `mobile/services/export/writeEmployeeDataExportPdf.ts` | `expo-print` + cache filename |
| `mobile/services/share/tempFiles.ts` | PDF cache cleanup helpers |
| `mobile/features/settings/sections/EmployeePrivacyDataSettingsScreen.tsx` | Locale + success toast |
| `mobile/i18n/locales/en.ts`, `de.ts` | Success copy |
| `mobile/scripts/data-export-pdf-runtime.ts` | Regression tests |
| `docs/MOBILE_HUMAN_READABLE_DATA_EXPORT_AUDIT.md` | This report |

---

## 11. Issues needing owner clarification (NOT CHANGED)

1. **Manager personal “Download my data”** — no authorized personal-data export on mobile today. Confirm product scope and endpoint before adding a PDF.
2. **Currency** — API has no currency field; PDF uses CareTip euro formatting. Confirm if multi-currency venues need an explicit field later.
3. **Web** — still JSON by design; mobile-only PDF was requested. Confirm if web should later match.
4. **Avatar URL** — omitted from PDF (not human-friendly). Confirm if a “Profile photo on file: Yes/No” line is desired.
5. **Native rebuild** — `expo-print` may require a custom/dev client rebuild if not already in the binary (Expo Go / stale clients).
