import { motion } from "motion/react";
import { Star, MessageSquare, ThumbsUp, TrendingUp } from "lucide-react";
import { LandingBorderedCard } from "@/components/ui/landing-bordered-card";

export function FeedbackSection() {
  return (
    <section className="bg-white px-6 py-24">
      <div className="max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left: Content */}
          <motion.div
            initial={{ x: -30, opacity: 0 }}
            whileInView={{ x: 0, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="space-y-8 text-center md:text-left"
          >
            <div className="space-y-4">
              <span className="inline-block px-4 py-2 bg-primary/10 text-primary rounded-full text-sm font-semibold">
                Guest feedback
              </span>
              <h2 className="text-3xl md:text-5xl font-bold text-black">
                Turn feedback into
                <br />
                <span className="text-primary">better service</span>
              </h2>
              <p className="text-base md:text-lg leading-relaxed text-black/70 max-w-md mx-auto md:mx-0">
                Ratings after tipping so you can coach and reward fast.
              </p>
            </div>

            {/* Features */}
            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="caretip-marketing-icon-chip w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0">
                  <Star className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-black mb-1">
                    Five-star ratings
                  </h3>
                  <p className="text-black/70">
                    Quick scores across every shift.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="caretip-marketing-icon-chip w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0">
                  <MessageSquare className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-black mb-1">
                    Comments
                  </h3>
                  <p className="text-black/70">
                    Short notes that show what worked.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="caretip-marketing-icon-chip w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0">
                  <TrendingUp className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-black mb-1">
                    Actionable insights
                  </h3>
                  <p className="text-black/70">
                    Spot trends. Reward wins. Coach gaps.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Right: Visual */}
          <motion.div
            initial={{ x: 30, opacity: 0 }}
            whileInView={{ x: 0, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="relative"
          >
            {/* Feedback Cards Stack */}
            <div className="relative space-y-4">
              {/* Card 1 */}
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                whileInView={{ y: 0, opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.2 }}
                whileHover={{ y: -5 }}
              >
                <LandingBorderedCard cardClassName="p-6 shadow-[0_10px_30px_rgba(0,0,0,0.06)]">
                  <div className="mb-3 flex items-center gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star key={star} className="h-5 w-5 fill-primary text-primary" />
                    ))}
                  </div>
                  <p className="mb-3 text-base leading-relaxed text-black">
                    &ldquo;Mercy picked the perfect wine. Our anniversary dinner was unforgettable.&rdquo;
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-primary/10 ring-1 ring-black/[0.06]" />
                      <div>
                        <p className="text-sm font-medium text-black/70">Juliet M.</p>
                        <p className="text-xs text-black/50">2 hours ago</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-primary">
                      <ThumbsUp className="h-4 w-4" />
                      <span className="text-sm font-medium">12</span>
                    </div>
                  </div>
                </LandingBorderedCard>
              </motion.div>

              {/* Card 2 */}
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                whileInView={{ y: 0, opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.4 }}
                whileHover={{ y: -5 }}
              >
                <LandingBorderedCard cardClassName="p-6 shadow-[0_10px_30px_rgba(0,0,0,0.06)]">
                  <div className="mb-3 flex items-center gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        className={`h-5 w-5 ${
                          star <= 4 ? "fill-primary text-primary" : "text-black/20"
                        }`}
                      />
                    ))}
                  </div>
                  <p className="mb-3 text-base leading-relaxed text-black">
                    &ldquo;Attentive service. Marcus knew the menu cold.&rdquo;
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-primary/10 ring-1 ring-black/[0.06]" />
                      <div>
                        <p className="text-sm font-medium text-black/70">Maria S.</p>
                        <p className="text-xs text-black/50">5 hours ago</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-primary">
                      <ThumbsUp className="h-4 w-4" />
                      <span className="text-sm font-medium">8</span>
                    </div>
                  </div>
                </LandingBorderedCard>
              </motion.div>

              {/* Stats Badge */}
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                whileInView={{ scale: 1, opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.6 }}
                whileHover={{ y: -5 }}
                className="rounded-3xl border border-black/[0.06] bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.06)]"
              >
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="mb-1 text-sm text-black/60">Average Rating</p>
                    <p className="text-4xl font-bold text-black">N/A</p>
                  </div>
                  <div className="caretip-marketing-icon-chip flex h-16 w-16 items-center justify-center rounded-3xl">
                    <Star className="h-8 w-8" />
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <div>
                    <p className="text-black/60">Reviews</p>
                    <p className="font-semibold text-black">0</p>
                  </div>
                  <div className="h-8 w-px bg-primary/15" />
                  <div>
                    <p className="text-black/60">This Month</p>
                    <p className="font-semibold text-black">N/A</p>
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Decorative Elements */}
            <div className="absolute -z-10 top-0 right-0 h-64 w-64 rounded-full bg-primary/[0.07] blur-3xl" />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
