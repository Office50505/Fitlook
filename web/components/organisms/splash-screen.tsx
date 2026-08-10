"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Button } from "@/components/atoms/button";
import { useSplashStart } from "@/features/splash/lib/use-splash-start";

const features = [
  "Virtual AI Try-On",
  "Smart Digital Closet",
  "Personal AI Stylist"
] as const;

export interface SplashScreenProps {
  imageSrc: string;
}

export function SplashScreen({ imageSrc }: SplashScreenProps) {
  const { handleStart } = useSplashStart();

  return (
    <main className="relative isolate min-h-svh overflow-hidden bg-black text-white">
      <motion.div
        animate={{ opacity: 1, scale: 1 }}
        className="absolute inset-0"
        initial={{ opacity: 0, scale: 1.015 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      >
        <Image
          priority
          fill
          alt=""
          className="object-cover"
          sizes="100vw"
          src={imageSrc}
        />
      </motion.div>

      <section
        aria-labelledby="splash-title"
        className="relative z-10 grid min-h-svh place-items-center px-6"
      >
        <div className="sr-only">
          <h1 id="splash-title">Lookmefy</h1>
          <p>AI-powered fashion experience.</p>
          <ul>
            {features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </div>

        <motion.form
          animate={{ opacity: 1, y: 0 }}
          aria-label="Start Lookmefy"
          className="absolute left-1/2 top-[66.35%] z-20 -translate-x-1/2"
          initial={{ opacity: 0, y: 12 }}
          onSubmit={(event) => {
            event.preventDefault();
            handleStart();
          }}
          transition={{ delay: 0.34, duration: 0.65, ease: "easeOut" }}
        >
          <Button
            aria-label="Get started with Lookmefy"
            className="opacity-0 focus-visible:opacity-100 focus-visible:ring-offset-4 focus-visible:ring-offset-black/40"
            size="splash"
            type="submit"
            variant="splash"
          >
            Get Started
          </Button>
        </motion.form>
      </section>
    </main>
  );
}
