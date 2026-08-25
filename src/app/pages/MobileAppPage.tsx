import React from "react";
import { Link } from 'react-router';
import { Smartphone, Bell, BarChart3, Shield, Download, Check, Star } from 'lucide-react';
import { Navigation } from '../components/Navigation';
import { Footer } from '../components/Footer';
import DeferredShaderBackground from '../components/ui/deferred-shader-background';

export function MobileAppPage() {
  const features = [
    "See new tips and earnings at a glance",
    "Push notifications for tips and payouts",
    "Biometric sign-in (Face ID / Touch ID)",
    "Quick access to QR codes and tip links",
    "Location and staff views (based on your account permissions)",
    "Dark mode support",
    "Secure session handling",
    "Stays in sync with the web dashboard",
  ];

  const reviews = [
    {
      name: "Sarah M.",
      rating: 5,
      text: "Our servers check tips on their phones before they leave, with no more guessing what came in that shift.",
    },
    {
      name: "Michael R.",
      rating: 5,
      text: "Notifications when a tip hits beat chasing the manager for cash-out totals.",
    },
    {
      name: "Jessica L.",
      rating: 5,
      text: "Clean layout for earnings. Easier than digging through group texts and spreadsheets.",
    },
  ];

  return (
    <div className="min-h-screen relative">
      <DeferredShaderBackground />
      <div className="relative z-10">
        <Navigation />
        
        <main className="min-h-[70vh] px-6 py-20">
          <div className="max-w-6xl mx-auto">
            <Link 
              to="/" 
              className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8"
            >
              <span className="text-sm">Back to Home</span>
            </Link>
            
            <div className="space-y-12">
              {/* Hero Section */}
              <div className="text-center space-y-6">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/10 border border-accent/20">
                  <Smartphone className="w-4 h-4 text-accent" />
                  <span className="text-sm font-semibold text-accent">Mobile Apps Available</span>
                </div>
                <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-foreground">
                  Tips &amp; earnings
                  <br />
                  in your pocket
                </h1>
                <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto">
                  Use the Caretip mobile app on iOS and Android to stay on top of tips, notifications, and payouts when you are away from the terminal.
                </p>

                {/* Download Buttons */}
                <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
                  <button className="px-8 py-4 bg-foreground text-background rounded-xl font-semibold hover:opacity-90 transition-all flex items-center justify-center gap-3">
                    <Download className="w-5 h-5" />
                    Download for iOS
                  </button>
                  <button className="px-8 py-4 bg-accent text-white rounded-xl font-semibold hover:bg-accent/90 transition-all flex items-center justify-center gap-3">
                    <Download className="w-5 h-5" />
                    Download for Android
                  </button>
                </div>

                <p className="text-sm text-muted-foreground">
                  Free download • Feature availability may vary by region and account type
                </p>
              </div>

              {/* Features Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-8">
                <div className="p-8 rounded-2xl bg-card border border-border">
                  <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center mb-4">
                    <Bell className="w-6 h-6 text-accent" />
                  </div>
                  <h3 className="text-2xl font-semibold text-foreground mb-3">Tip alerts</h3>
                  <p className="text-muted-foreground">
                    Get notified when new tips arrive or when payout status changes, so staff and leads are never guessing at end of shift.
                  </p>
                </div>

                <div className="p-8 rounded-2xl bg-card border border-border">
                  <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center mb-4">
                    <BarChart3 className="w-6 h-6 text-accent" />
                  </div>
                  <h3 className="text-2xl font-semibold text-foreground mb-3">Earnings at a glance</h3>
                  <p className="text-muted-foreground">
                    See recent activity, totals, and trends that matter for hospitality, shift by shift or week over week, depending on your access level.
                  </p>
                </div>

                <div className="p-8 rounded-2xl bg-card border border-border">
                  <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center mb-4">
                    <Shield className="w-6 h-6 text-accent" />
                  </div>
                  <h3 className="text-2xl font-semibold text-foreground mb-3">Secure &amp; private</h3>
                  <p className="text-muted-foreground">
                    Encryption in transit, secure sign-in, and optional biometrics help protect account access on shared devices behind the bar or in the office.
                  </p>
                </div>

                <div className="p-8 rounded-2xl bg-card border border-border">
                  <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center mb-4">
                    <Smartphone className="w-6 h-6 text-accent" />
                  </div>
                  <h3 className="text-2xl font-semibold text-foreground mb-3">Built for the floor</h3>
                  <p className="text-muted-foreground">
                    Native apps tuned for quick checks between tables, rushes, and handoffs, without opening a laptop.
                  </p>
                </div>
              </div>

              {/* Features List */}
              <div className="p-8 rounded-2xl bg-gradient-to-br from-accent/10 to-primary/10 border border-accent/20">
                <h2 className="text-3xl font-semibold text-foreground mb-8 text-center">
                  Everything you need between shifts
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto">
                  {features.map((feature, index) => (
                    <div key={index} className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
                        <Check className="w-4 h-4 text-accent" />
                      </div>
                      <span className="text-foreground">{feature}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* User Reviews */}
              <div>
                <h2 className="text-3xl font-semibold text-foreground mb-8 text-center">
                  What teams are saying
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {reviews.map((review, index) => (
                    <div key={index} className="p-6 rounded-xl bg-card border border-border">
                      <div className="flex items-center gap-1 mb-3">
                        {[...Array(review.rating)].map((_, i) => (
                          <Star key={i} className="w-4 h-4 fill-accent text-accent" />
                        ))}
                      </div>
                      <p className="text-muted-foreground text-sm mb-4">"{review.text}"</p>
                      <p className="text-foreground font-semibold text-sm">{review.name}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div className="text-center p-6 rounded-xl bg-card border border-border">
                  <p className="text-3xl font-bold text-accent mb-1">4.9</p>
                  <p className="text-sm text-muted-foreground">App Store Rating</p>
                </div>
                <div className="text-center p-6 rounded-xl bg-card border border-border">
                  <p className="text-3xl font-bold text-accent mb-1">500K+</p>
                  <p className="text-sm text-muted-foreground">Downloads</p>
                </div>
                <div className="text-center p-6 rounded-xl bg-card border border-border">
                  <p className="text-3xl font-bold text-accent mb-1">50K+</p>
                  <p className="text-sm text-muted-foreground">5-Star Reviews</p>
                </div>
                <div className="text-center p-6 rounded-xl bg-card border border-border">
                  <p className="text-3xl font-bold text-accent mb-1">150+</p>
                  <p className="text-sm text-muted-foreground">Countries</p>
                </div>
              </div>

              {/* CTA */}
              <div className="p-8 rounded-2xl bg-card border border-border text-center">
                <h3 className="text-2xl font-semibold text-foreground mb-3">
                  Ready to download?
                </h3>
                <p className="text-muted-foreground mb-6">
                  Bring Caretip with you, whether you run the room or run the numbers.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <button className="px-8 py-3 bg-foreground text-background rounded-lg font-semibold hover:opacity-90 transition-all">
                    Download for iOS
                  </button>
                  <button className="px-8 py-3 bg-accent text-white rounded-lg font-semibold hover:bg-accent/90 transition-all">
                    Download for Android
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
