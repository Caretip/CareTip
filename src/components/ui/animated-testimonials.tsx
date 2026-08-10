import { useEffect, useRef, useState } from "react";
import { Quote, Star } from "lucide-react";
import { motion, useAnimation, useInView } from "motion/react";

import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface Testimonial {
  id: number;
  name: string;
  role: string;
  company: string;
  content: string;
  rating: number;
}

export interface AnimatedTestimonialsProps {
  title?: string;
  subtitle?: string;
  badgeText?: string;
  testimonials?: Testimonial[];
  autoRotateInterval?: number;
  trustedCompanies?: string[];
  trustedCompaniesTitle?: string;
  className?: string;
  sectionId?: string;
}

export function AnimatedTestimonials({
  title = "Loved by the community",
  subtitle = "Don't just take our word for it. See what developers and companies have to say about our starter template.",
  badgeText = "Trusted by developers",
  testimonials = [],
  autoRotateInterval = 6000,
  trustedCompanies = [],
  trustedCompaniesTitle = "Trusted by developers from companies worldwide",
  className,
  sectionId = "social-proof-testimonials",
}: AnimatedTestimonialsProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, amount: 0.2 });
  const controls = useAnimation();

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.2,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.5,
        ease: [0.22, 1, 0.36, 1] as const,
      },
    },
  };

  useEffect(() => {
    if (isInView) {
      void controls.start("visible");
    }
  }, [isInView, controls]);

  useEffect(() => {
    if (autoRotateInterval <= 0 || testimonials.length <= 1) return;

    const interval = setInterval(() => {
      setActiveIndex((current) => (current + 1) % testimonials.length);
    }, autoRotateInterval);

    return () => clearInterval(interval);
  }, [autoRotateInterval, testimonials.length]);

  if (testimonials.length === 0) {
    return null;
  }

  return (
    <section
      ref={sectionRef}
      id={sectionId}
      className={cn(
        "caretip-animated-testimonials overflow-hidden bg-muted/30 py-16 sm:py-20 lg:py-24",
        className,
      )}
    >
      <div className="mx-auto max-w-7xl px-4 md:px-6">
        <motion.div
          initial="hidden"
          animate={controls}
          variants={containerVariants}
          className="grid w-full grid-cols-1 gap-12 md:grid-cols-2 md:gap-16 lg:gap-24"
        >
          <motion.div variants={itemVariants} className="flex flex-col justify-center">
            <div className="space-y-6">
              {badgeText ? (
                <div className="inline-flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#e9781c] shadow-[0_0_0_3px_rgba(233,120,28,0.16)]"
                  />
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#e9781c]">
                    {badgeText}
                  </span>
                </div>
              ) : null}

              <h2 className="text-3xl font-bold tracking-tight leading-[1.2] text-foreground sm:text-4xl md:text-5xl">
                {title}
              </h2>

              {subtitle ? (
                <p className="max-w-[600px] text-muted-foreground md:text-xl/relaxed">{subtitle}</p>
              ) : null}

              <div className="flex items-center gap-3 pt-2">
                {testimonials.map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    className={cn(
                      "h-2.5 rounded-full transition-all duration-300",
                      activeIndex === index ? "w-10 bg-primary" : "w-2.5 bg-muted-foreground/30",
                    )}
                    aria-label={`View testimonial ${index + 1}`}
                    aria-current={activeIndex === index ? "true" : undefined}
                  />
                ))}
              </div>
            </div>
          </motion.div>

          <motion.div
            variants={itemVariants}
            className="relative mr-0 min-h-[300px] h-full md:mr-6 md:min-h-[400px]"
          >
            {testimonials.map((testimonial, index) => (
              <motion.div
                key={testimonial.id}
                className="absolute inset-0"
                initial={{ opacity: 0, x: 100 }}
                animate={{
                  opacity: activeIndex === index ? 1 : 0,
                  x: activeIndex === index ? 0 : 100,
                  scale: activeIndex === index ? 1 : 0.9,
                }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                style={{ zIndex: activeIndex === index ? 10 : 0 }}
                aria-hidden={activeIndex !== index}
              >
                <div className="flex h-full flex-col rounded-xl border bg-card p-6 shadow-lg sm:p-8">
                  <div className="mb-6 flex gap-2">
                    {Array.from({ length: testimonial.rating }, (_, i) => (
                      <Star key={i} className="h-5 w-5 fill-yellow-500 text-yellow-500" />
                    ))}
                  </div>

                  <div className="relative mb-6 flex-1">
                    <Quote
                      className="absolute -left-2 -top-2 h-8 w-8 rotate-180 text-primary/20"
                      aria-hidden
                    />
                    <p className="relative z-10 text-lg font-medium leading-relaxed text-foreground">
                      &ldquo;{testimonial.content}&rdquo;
                    </p>
                  </div>

                  <Separator className="my-4" />

                  <div>
                    <h3 className="font-semibold text-foreground">{testimonial.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {testimonial.role}, {testimonial.company}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}

            <div
              className="pointer-events-none absolute -bottom-6 -left-6 h-24 w-24 rounded-xl bg-primary/5"
              aria-hidden
            />
            <div
              className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-xl bg-primary/5"
              aria-hidden
            />
          </motion.div>
        </motion.div>

        {trustedCompanies.length > 0 ? (
          <motion.div
            variants={itemVariants}
            initial="hidden"
            animate={controls}
            className="mt-16 text-center sm:mt-24"
          >
            <h3 className="mb-8 text-sm font-medium text-muted-foreground">
              {trustedCompaniesTitle}
            </h3>
            <div className="flex flex-wrap justify-center gap-x-12 gap-y-8">
              {trustedCompanies.map((company) => (
                <div
                  key={company}
                  className="text-2xl font-semibold text-muted-foreground/50"
                >
                  {company}
                </div>
              ))}
            </div>
          </motion.div>
        ) : null}
      </div>
    </section>
  );
}
