import { Link } from 'react-router';
import { Calendar, Clock } from 'lucide-react';
import { Navigation } from '../components/Navigation';
import { Footer } from '../components/Footer';
import DeferredShaderBackground from '../components/ui/deferred-shader-background';

const blogPosts = [
  {
    title: "QR tipping 101: what guests see when they scan",
    excerpt:
      "Walk through the guest flow from camera open to receipt, plus small touches that reduce friction at checkout.",
    category: "Product",
    date: "March 15, 2026",
    readTime: "5 min read",
    featured: true,
  },
  {
    title: "How to roll out team tipping without confusing staff",
    excerpt:
      "From naming conventions to printed materials, a practical checklist for GMs launching digital tips across shifts.",
    category: "Operations",
    date: "March 10, 2026",
    readTime: "8 min read",
    featured: true,
  },
  {
    title: "Cashless tips and trust on the floor",
    excerpt:
      "Why transparent payout timing matters for morale, and how to communicate it in pre-shift lineups.",
    category: "Culture",
    date: "March 5, 2026",
    readTime: "6 min read",
    featured: false,
  },
  {
    title: "New in Caretip: richer reporting by location",
    excerpt:
      "Slice earnings by site and date range so finance and ops stay aligned without spreadsheet gymnastics.",
    category: "Product Updates",
    date: "February 28, 2026",
    readTime: "4 min read",
    featured: false,
  },
  {
    title: "Payouts explained: what happens after a guest pays",
    excerpt:
      "A plain-language overview of processors, settlement, and what your team can expect in the app.",
    category: "Education",
    date: "February 20, 2026",
    readTime: "7 min read",
    featured: false,
  },
  {
    title: "The future of gratuity in hospitality",
    excerpt:
      "Trends in contactless service, tip pooling, and how venues balance guest experience with staff equity.",
    category: "Industry",
    date: "February 15, 2026",
    readTime: "10 min read",
    featured: false,
  },
];

export function BlogPage() {
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
            
            <div className="space-y-8">
              <div className="space-y-4">
                <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-foreground">
                  Blog
                </h1>
                <p className="text-lg sm:text-xl text-muted-foreground">
                  Tips, insights, and updates from the Caretip team.
                </p>
              </div>

              <div className="pt-8">
                {/* Featured Posts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-12">
                  {blogPosts.filter(post => post.featured).map((post, index) => (
                    <div 
                      key={index}
                      className="group p-6 rounded-2xl bg-card border border-border hover:border-accent/50 transition-all cursor-pointer"
                    >
                      <div className="mb-4">
                        <span className="px-3 py-1 rounded-full bg-accent/20 text-accent text-xs font-semibold">
                          {post.category}
                        </span>
                      </div>
                      <h2 className="text-2xl font-semibold text-foreground mb-3 group-hover:text-accent transition-colors">
                        {post.title}
                      </h2>
                      <p className="text-muted-foreground mb-4">
                        {post.excerpt}
                      </p>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          <span>{post.date}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4" />
                          <span>{post.readTime}</span>
                        </div>
                      </div>
                      <button type="button" className="mt-4 inline-flex items-center text-accent font-medium text-sm">
                        Read More
                      </button>
                    </div>
                  ))}
                </div>

                {/* All Posts */}
                <div>
                  <h2 className="text-2xl font-semibold text-foreground mb-6">Recent Articles</h2>
                  <div className="grid grid-cols-1 gap-6">
                    {blogPosts.filter(post => !post.featured).map((post, index) => (
                      <div 
                        key={index}
                        className="group p-6 rounded-xl bg-card border border-border hover:border-accent/50 transition-all cursor-pointer flex flex-col sm:flex-row gap-6"
                      >
                        <div className="flex-1">
                          <div className="mb-3">
                            <span className="px-3 py-1 rounded-full bg-accent/10 text-accent text-xs font-semibold">
                              {post.category}
                            </span>
                          </div>
                          <h3 className="text-xl font-semibold text-foreground mb-2 group-hover:text-accent transition-colors">
                            {post.title}
                          </h3>
                          <p className="text-muted-foreground text-sm mb-4">
                            {post.excerpt}
                          </p>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-3 h-3" />
                              <span>{post.date}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Clock className="w-3 h-3" />
                              <span>{post.readTime}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center">
                          <button className="text-accent font-medium text-sm hover:underline">
                            Read Article →
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Newsletter Signup */}
                <div className="mt-12 p-8 rounded-2xl bg-gradient-to-br from-accent/10 to-primary/10 border border-accent/20 text-center">
                  <h3 className="text-2xl font-semibold text-foreground mb-3">
                    Stay in the loop
                  </h3>
                  <p className="text-muted-foreground mb-6">
                    Get the latest articles, tips, and product updates delivered to your inbox.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
                    <input
                      type="email"
                      placeholder="Enter your email"
                      className="flex-1 px-4 py-3 rounded-lg bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                    />
                    <button className="px-6 py-3 bg-accent text-white rounded-lg font-semibold hover:bg-accent/90 transition-all whitespace-nowrap">
                      Subscribe
                    </button>
                  </div>
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
