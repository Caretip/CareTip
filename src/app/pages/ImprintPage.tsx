import { useTranslation } from "react-i18next";

import { landingCopyVisible } from "@/components/landing/landingUi";
import { PublicLegalPageShell } from "@/components/public/PublicLegalPageShell";

const ODR_URL = "https://ec.europa.eu/consumers/odr/";

export function ImprintPage() {
  const { t } = useTranslation();

  const registerNumber = t("staticPages.imprint.registerNumber");
  const vatId = t("staticPages.imprint.vatId");
  const contactEmail = t("staticPages.imprint.contactEmail");

  return (
    <PublicLegalPageShell title={t("staticPages.imprint.title")}>
      <div className="space-y-6">
        <div>
          <h2>{t("staticPages.imprint.tmgTitle")}</h2>
          <p>
            <strong>{t("staticPages.imprint.companyName")}</strong>
            <br />
            {t("staticPages.imprint.addressLine1")}
            <br />
            {t("staticPages.imprint.addressLine2")}
            <br />
            {t("staticPages.imprint.addressCountry")}
          </p>
        </div>

        <div>
          <h3>{t("staticPages.imprint.directorsTitle")}</h3>
          <ul>
            <li>{t("staticPages.imprint.director0")}</li>
            <li>{t("staticPages.imprint.director1")}</li>
          </ul>
        </div>

        <div>
          <h3>{t("staticPages.imprint.contactTitle")}</h3>
          <p>
            {t("staticPages.imprint.contactEmailLabel")}
            <br />
            <a href={`mailto:${contactEmail}`} className="text-primary underline-offset-2 hover:underline">
              {contactEmail}
            </a>
          </p>
        </div>

        <div>
          <h3>{t("staticPages.imprint.registerTitle")}</h3>
          <p>{t("staticPages.imprint.registerBody")}</p>
          <p>
            <strong>{t("staticPages.imprint.registerCourtLabel")}</strong>
            <br />
            {t("staticPages.imprint.registerCourt")}
          </p>
          <p>
            <strong>{t("staticPages.imprint.registerNumberLabel")}</strong>
            {landingCopyVisible(registerNumber) ? (
              <>
                <br />
                {registerNumber}
              </>
            ) : null}
          </p>
        </div>

        <div>
          <h3>{t("staticPages.imprint.vatTitle")}</h3>
          <p>
            {t("staticPages.imprint.vatDescription")}
            {landingCopyVisible(vatId) ? (
              <>
                <br />
                {vatId}
              </>
            ) : null}
          </p>
        </div>

        <div>
          <h2>{t("staticPages.imprint.euDisputeTitle")}</h2>
          <p>{t("staticPages.imprint.euDisputeIntro")}</p>
          <p>
            <a
              href={ODR_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-primary underline-offset-2 hover:underline"
            >
              {ODR_URL}
            </a>
          </p>
          {landingCopyVisible(t("staticPages.imprint.euDisputeEmailNote")) ? (
            <p>{t("staticPages.imprint.euDisputeEmailNote")}</p>
          ) : null}
          {landingCopyVisible(t("staticPages.imprint.euDisputeBody")) ? (
            <p>{t("staticPages.imprint.euDisputeBody")}</p>
          ) : null}
        </div>

        {landingCopyVisible(t("staticPages.imprint.consumerDisputeTitle")) ? (
          <div>
            <h2>{t("staticPages.imprint.consumerDisputeTitle")}</h2>
            <p>{t("staticPages.imprint.consumerDisputeBody")}</p>
          </div>
        ) : null}
      </div>
    </PublicLegalPageShell>
  );
}
