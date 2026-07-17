import { Link, useSearchParams } from "react-router";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState } from "react";
import "@/styles/bundles/marketing-pages.css";
import { PublicPageShell } from "@/components/public/PublicPageShell";
import { FaqPageHero } from "@/components/public/faq/FaqPageHero";
import { FaqAccordionItem } from "@/components/public/faq/FaqAccordionItem";
import { publicPagesBrandUi } from "@/components/public/publicPagesBrandUi";

function FaqAnswerWithLead({ lead, body }: { lead: string; body: string }) {
  return (
    <p className="caretip-faq-item-wise__answer">
      <strong className="font-semibold text-foreground">{lead}</strong> {body}
    </p>
  );
}

export function FAQPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const qFromUrl = searchParams.get("q") ?? "";
  const [searchQuery, setSearchQuery] = useState(qFromUrl);

  useEffect(() => {
    setSearchQuery(qFromUrl);
  }, [qFromUrl]);

  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const faqItems = useMemo(() => {
    const raw = t("staticPages.faq.items", { returnObjects: true });
    const items = Array.isArray(raw) ? raw : [];
    type RawFaqItem = {
      q: string;
      qBefore?: string;
      qBold?: string;
      a?: string;
      aLead?: string;
      aBody?: string;
    };
    const parsed = items.filter(
      (item): item is RawFaqItem =>
        typeof item === "object" &&
        item !== null &&
        "q" in item &&
        typeof (item as RawFaqItem).q === "string",
    );
    return parsed.map((item) => {
      const questionContent =
        item.qBefore && item.qBold ? (
          <>
            {item.qBefore}
            <strong className="font-bold">{item.qBold}</strong>
          </>
        ) : undefined;

      if (item.aLead && item.aBody) {
        return {
          question: item.q,
          questionContent,
          answer: `${item.aLead} ${item.aBody}`,
          answerContent: <FaqAnswerWithLead lead={item.aLead} body={item.aBody} />,
        };
      }
      return { question: item.q, questionContent, answer: item.a ?? "" };
    });
  }, [t]);

  const filteredFaqs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return faqItems;
    return faqItems.filter((f) => f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q));
  }, [searchQuery, faqItems]);

  useEffect(() => {
    setOpenIndex(filteredFaqs.length > 0 ? 0 : null);
  }, [searchQuery, filteredFaqs.length]);

  const setQuery = (v: string) => {
    setSearchQuery(v);
    const trimmed = v.trim();
    if (trimmed) setSearchParams({ q: trimmed }, { replace: true });
    else setSearchParams({}, { replace: true });
  };

  return (
    <PublicPageShell maxWidth="full" contentClassName="pb-0" className="bg-background">
      <main
        id="faq"
        className="caretip-faq-page caretip-faq-page--wise"
        aria-label={t("staticPages.faq.pageTitle")}
      >
        <FaqPageHero />

        <section className="caretip-faq-content" aria-label={t("faq.searchAria")}>
          <div className="caretip-faq-page__inner caretip-faq-content__inner">
            <div className="caretip-faq-search">
              <Search className="caretip-faq-search__icon" aria-hidden />
              <input
                id="faq-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("faq.searchPlaceholder")}
                autoComplete="off"
                aria-label={t("faq.searchAria")}
                className="caretip-faq-search__input"
              />
            </div>

            <div className="caretip-faq-list">
              {filteredFaqs.length === 0 ? (
                <p className="caretip-faq-empty">
                  {t("faq.noMatch")}{" "}
                  <button type="button" className="caretip-faq-empty__clear" onClick={() => setQuery("")}>
                    {t("faq.clearSearch")}
                  </button>
                </p>
              ) : (
                filteredFaqs.map((faq, index) => (
                  <FaqAccordionItem
                    key={faq.question}
                    question={faq.question}
                    questionContent={"questionContent" in faq ? faq.questionContent : undefined}
                    answer={faq.answer}
                    answerContent={"answerContent" in faq ? faq.answerContent : undefined}
                    isOpen={openIndex === index}
                    onToggle={() => setOpenIndex(openIndex === index ? null : index)}
                  />
                ))
              )}
            </div>
          </div>
        </section>

        <section className="caretip-faq-cta-wise" aria-labelledby="faq-cta-title">
          <div className="caretip-faq-page__inner caretip-faq-cta-wise__inner">
            <h2 id="faq-cta-title" className="caretip-faq-cta-wise__title">
              {t("staticPages.faq.ctaTitle")}
            </h2>
            <p className="caretip-faq-cta-wise__body">{t("staticPages.faq.ctaBody")}</p>
            <div className="caretip-faq-cta-wise__actions">
              <Link to="/contact" className={publicPagesBrandUi.ctaButtonPrimary}>
                {t("staticPages.faq.ctaButton")}
              </Link>
            </div>
          </div>
        </section>
      </main>
    </PublicPageShell>
  );
}
