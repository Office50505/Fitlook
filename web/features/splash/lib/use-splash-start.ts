"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  onboardingStartSchema,
  type OnboardingStartValues
} from "@/features/splash/lib/onboarding.schema";

export interface UseSplashStartResult {
  handleStart: () => void;
}

export function useSplashStart(): UseSplashStartResult {
  const form = useForm<OnboardingStartValues>({
    resolver: zodResolver(onboardingStartSchema),
    defaultValues: {
      destination: "explore"
    }
  });

  const handleStart = form.handleSubmit(() => {
    window.location.assign("/explore");
  });

  return { handleStart };
}
