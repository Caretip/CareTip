import { motion } from 'motion/react';
import { Check } from 'lucide-react';
import { Link } from 'react-router';
import { GlowingEffect } from './ui/glowing-effect';

export function CTASection() {
  const benefits = [
    'Get started in seconds',
    'No setup fees',
    'Withdraw anytime',
  ];

  return (
    <section className="py-16 sm:py-24 px-6">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ y: 30, opacity: 0 }}
          whileInView={{ y: 0, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="relative"
        >
          <div className="relative rounded-3xl border border-accent/30 p-3">
            <GlowingEffect
              spread={50}
              glow={true}
              disabled={false}
              proximity={80}
              inactiveZone={0.01}
              borderWidth={2}
            />
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary to-accent/20 p-8 sm:p-12 md:p-16">
              {/* Decorative elements */}
              <div className="absolute top-0 right-0 w-64 h-64 bg-accent/20 rounded-full blur-3xl"></div>
              <div className="absolute bottom-0 left-0 w-64 h-64 bg-accent/10 rounded-full blur-3xl"></div>

              <div className="relative z-10 text-center space-y-6 sm:space-y-8">
                <div className="space-y-3 sm:space-y-4">
                  <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold text-white">
                    Ready to start receiving tips?
                  </h2>
                  <p className="text-base sm:text-xl text-white/80 max-w-2xl mx-auto">
                    Join thousands of employees who receive tips effortlessly and get paid directly to their bank account.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center">
                  <Link to="/auth">
                    <button className="group px-6 sm:px-8 py-3 sm:py-4 bg-white text-primary rounded-xl hover:bg-white/90 transition-all hover:shadow-2xl flex items-center justify-center gap-2 text-sm sm:text-base font-semibold">
                      Get Your Tipping Link
                    </button>
                  </Link>
                  <Link
                    to="/#how-it-works"
                    className="px-6 sm:px-8 py-3 sm:py-4 bg-white/10 text-white rounded-xl hover:bg-white/20 transition-all backdrop-blur-sm border border-white/20 text-sm sm:text-base font-semibold inline-flex items-center justify-center"
                  >
                    See How It Works
                  </Link>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 justify-center items-center pt-2 sm:pt-4">
                  {benefits.map((benefit) => (
                    <div key={benefit} className="flex items-center gap-2 text-white/90">
                      <Check className="w-4 h-4 sm:w-5 sm:h-5 text-accent" />
                      <span className="text-xs sm:text-sm">{benefit}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}