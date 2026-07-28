import { z } from "zod";

export const onboardingStartSchema = z.object({
  destination: z.literal("explore")
});

export type OnboardingStartValues = z.infer<typeof onboardingStartSchema>;
