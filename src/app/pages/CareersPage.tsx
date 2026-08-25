import { Link } from 'react-router';
import { MapPin, Clock, Briefcase, Heart, Zap, Users, Globe } from 'lucide-react';
import { Navigation } from '../components/Navigation';
import { Footer } from '../components/Footer';
import DeferredShaderBackground from '../components/ui/deferred-shader-background';

const openPositions = [
  {
    title: "Senior Full-Stack Engineer",
    department: "Engineering",
    location: "San Francisco, CA / Remote",
    type: "Full-time",
    description:
      "Ship reliable payments, QR flows, and dashboards for hospitality businesses using React, Node.js, and PostgreSQL.",
  },
  {
    title: "Product Designer",
    department: "Design",
    location: "Remote",
    type: "Full-time",
    description:
      "Craft clear guest tipping journeys and staff tools, from scan to payout, for busy restaurants and hotels.",
  },
  {
    title: "Customer Success Manager",
    department: "Customer Success",
    location: "New York, NY / Remote",
    type: "Full-time",
    description:
      "Help venues launch Caretip, train teams on QR tipping, and get the most from reporting and payouts.",
  },
  {
    title: "Marketing Manager",
    department: "Marketing",
    location: "Remote",
    type: "Full-time",
    description:
      "Tell the Caretip story to operators and GMs: fair tipping, happier staff, and modern guest checkout.",
  },
  {
    title: "Data Analyst",
    department: "Analytics",
    location: "San Francisco, CA",
    type: "Full-time",
    description:
      "Measure tip volume, conversion, and product usage so we improve the platform for businesses and employees.",
  },
];

const benefits = [
  {
    icon: Heart,
    title: "Comprehensive Health Coverage",
    description: "Medical, dental, and vision insurance for you and your family"
  },
  {
    icon: Globe,
    title: "Remote-First Culture",
    description: "Work from anywhere with flexible hours and unlimited PTO"
  },
  {
    icon: Zap,
    title: "Professional Growth",
    description: "Annual learning budget and conference attendance"
  },
  {
    icon: Users,
    title: "Team Events",
    description: "Regular team offsites and virtual gatherings"
  }
];

const values = [
  {
    title: "Hospitality first",
    description:
      "We build for people on the floor: servers, bartenders, housekeepers, and the managers who support them.",
  },
  {
    title: "Move fast, stay grounded",
    description:
      "We ship quickly, listen to venues, and iterate on real-world feedback from busy service environments.",
  },
  {
    title: "Transparency",
    description:
      "Clear pricing, honest timelines, and open communication with customers and teammates.",
  },
  {
    title: "Sustainable pace",
    description:
      "We care about outcomes and about keeping our team healthy for the long run.",
  },
];

export function CareersPage() {
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
            
            <div className="space-y-16">
              {/* Hero Section */}
              <div className="text-center space-y-6">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/10 border border-accent/20">
                  <Briefcase className="w-4 h-4 text-accent" />
                  <span className="text-sm font-semibold text-accent">We're Hiring!</span>
                </div>
                <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-foreground">
                  Join Our Team
                </h1>
                <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto">
                  Help us make digital tipping simple for guests and fair for staff. We are hiring people who care about hospitality and great product craft.
                </p>
              </div>

              {/* Company Values */}
              <div>
                <h2 className="text-3xl font-semibold text-foreground mb-8 text-center">
                  Our Values
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {values.map((value, index) => (
                    <div key={index} className="p-6 rounded-xl bg-card border border-border">
                      <h3 className="text-xl font-semibold text-foreground mb-2">{value.title}</h3>
                      <p className="text-muted-foreground">{value.description}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Benefits */}
              <div className="p-8 rounded-2xl bg-gradient-to-br from-accent/10 to-primary/10 border border-accent/20">
                <h2 className="text-3xl font-semibold text-foreground mb-8 text-center">
                  Benefits & Perks
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {benefits.map((benefit, index) => {
                    const Icon = benefit.icon;
                    return (
                      <div key={index} className="text-center">
                        <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center mx-auto mb-3">
                          <Icon className="w-6 h-6 text-accent" />
                        </div>
                        <h3 className="font-semibold text-foreground mb-2">{benefit.title}</h3>
                        <p className="text-sm text-muted-foreground">{benefit.description}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Open Positions */}
              <div>
                <h2 className="text-3xl font-semibold text-foreground mb-8 text-center">
                  Open Positions
                </h2>
                <div className="space-y-4">
                  {openPositions.map((position, index) => (
                    <div 
                      key={index}
                      className="group p-6 rounded-xl bg-card border border-border hover:border-accent/50 transition-all cursor-pointer"
                    >
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-xl font-semibold text-foreground group-hover:text-accent transition-colors">
                              {position.title}
                            </h3>
                            <span className="px-3 py-1 rounded-full bg-accent/10 text-accent text-xs font-semibold">
                              {position.department}
                            </span>
                          </div>
                          <p className="text-muted-foreground text-sm mb-3">{position.description}</p>
                          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                            <div className="flex items-center gap-2">
                              <MapPin className="w-4 h-4" />
                              <span>{position.location}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Clock className="w-4 h-4" />
                              <span>{position.type}</span>
                            </div>
                          </div>
                        </div>
                        <button className="flex items-center gap-2 px-6 py-3 bg-accent text-white rounded-lg font-semibold hover:bg-accent/90 transition-all whitespace-nowrap">
                          Apply Now
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div className="text-center p-6 rounded-xl bg-card border border-border">
                  <p className="text-3xl font-bold text-accent mb-1">50+</p>
                  <p className="text-sm text-muted-foreground">Team Members</p>
                </div>
                <div className="text-center p-6 rounded-xl bg-card border border-border">
                  <p className="text-3xl font-bold text-accent mb-1">15</p>
                  <p className="text-sm text-muted-foreground">Countries</p>
                </div>
                <div className="text-center p-6 rounded-xl bg-card border border-border">
                  <p className="text-3xl font-bold text-accent mb-1">100%</p>
                  <p className="text-sm text-muted-foreground">Remote-Friendly</p>
                </div>
                <div className="text-center p-6 rounded-xl bg-card border border-border">
                  <p className="text-3xl font-bold text-accent mb-1">4.9</p>
                  <p className="text-sm text-muted-foreground">Glassdoor Rating</p>
                </div>
              </div>

              {/* Don't See a Fit? */}
              <div className="p-8 rounded-2xl bg-card border border-border text-center">
                <h3 className="text-2xl font-semibold text-foreground mb-3">
                  Don't see the perfect role?
                </h3>
                <p className="text-muted-foreground mb-6">
                  We're always looking for talented people. Send us your resume and tell us how you can contribute to our mission.
                </p>
                <Link
                  to="/contact"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-accent text-white rounded-lg font-semibold hover:bg-accent/90 transition-all"
                >
                  Get in Touch
                </Link>
              </div>
            </div>
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
