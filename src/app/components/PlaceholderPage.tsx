import { Link } from 'react-router';
import { Sparkles } from 'lucide-react';
import { Navigation } from './Navigation';
import { Footer } from './Footer';
import AnimatedShaderBackground from './ui/animated-shader-background';

interface PlaceholderPageProps {
  title: string;
  description?: string;
}

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div className="min-h-screen relative">
      <AnimatedShaderBackground />
      <div className="relative z-10">
        <Navigation />

        <main className="flex min-h-[70vh] items-center justify-center px-6 py-20">
          <div className="mx-auto w-full max-w-xl text-center">
            <Link
              to="/"
              className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Back to Home
            </Link>

            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/15">
              <Sparkles className="h-8 w-8 text-primary" aria-hidden />
            </div>

            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.08] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
              <Sparkles className="h-3 w-3" aria-hidden />
              Coming soon
            </span>

            <h1 className="mt-5 font-hero-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl md:text-5xl">
              {title}
            </h1>
            {description ? (
              <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">
                {description}
              </p>
            ) : null}
            <p className="mt-5 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground/80">
              Currently in development
            </p>
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
