import Link from "next/link";

export default function ExplorePage() {
  return (
    <main className="grid min-h-svh place-items-center bg-ink px-6 text-center text-white">
      <section className="max-w-md space-y-5">
        <p className="text-sm uppercase tracking-[0.34em] text-white/60">
          Explore Lookmefy
        </p>
        <h1 className="font-display text-5xl">Next screen ready.</h1>
        <p className="text-white/70">
          The splash CTA lands here while the remaining screens are implemented
          one at a time.
        </p>
        <Link
          className="inline-flex h-12 items-center justify-center rounded-pill bg-white px-8 text-sm font-medium uppercase tracking-[0.18em] text-ink"
          href="/"
        >
          Back
        </Link>
      </section>
    </main>
  );
}
