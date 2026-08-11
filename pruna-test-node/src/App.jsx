import { useEffect, useRef, useState } from "react";

import ImageToVideo from "./ImageToVideo.jsx";
import UploadCard from "./UploadCard.jsx";
import VideoPanel from "./VideoPanel.jsx";

const MODES = [
  { id: "tryon", label: "Try-On + Video" },
  { id: "video", label: "Image → Video" },
];

const PHASES = [
  { at: 0, label: "Uploading images…" },
  { at: 2500, label: "Starting generation…" },
  { at: 5000, label: "Generating try-on…" },
  { at: 20000, label: "Finalizing…" },
];

const TRYON_PROMPTS = [
  {
    id: "upper",
    label: "Upper Body",
    prompt: `Use the upper-body garment from Image 1 as the garment reference and apply it to the person in Image 2.

Replace ONLY the person's upper-body clothing with the exact upper-body garment from Image 1. Preserve the garment's original design, color, pattern, fabric texture, neckline, sleeves, fit, length, logos, prints, embroidery, and all visible details as accurately as possible.

STRICTLY preserve the person's existing lower-body clothing from Image 2 exactly as it is. Do NOT replace, modify, recolor, redesign, extend, or cover the pants, jeans, skirt, shorts, trousers, or any other lower-body garment.

The clothing transfer must stop naturally at the upper garment's actual hemline. Do not interpret Image 1 as a full outfit and do not transfer any lower-body clothing from Image 1.

Keep the person's identity, face, hair, skin tone, body shape, pose, hands, legs, proportions, background, lighting, camera angle, and framing unchanged.

Only one modification is allowed: replace the upper-body garment.

Priority:

1. Preserve the person and original image.
2. Preserve the lower-body clothing exactly.
3. Transfer only the upper-body garment from Image 1.
4. Maintain the exact appearance and details of the reference garment.
5. Produce a realistic, naturally fitted virtual try-on result.`,
  },
  {
    id: "lower",
    label: "Lower Body",
    prompt: `Use the lower-body garment from Image 1 as the garment reference and apply it to the person in Image 2.

Replace ONLY the person's lower-body clothing with the exact lower-body garment from Image 1. Preserve the garment's original design, color, pattern, fabric texture, waistband, fit, cut, length, pockets, stitching, prints, logos, and all visible details as accurately as possible.

STRICTLY preserve the person's existing upper-body clothing from Image 2 exactly as it is. Do NOT replace, modify, recolor, redesign, shorten, extend, or alter the shirt, T-shirt, top, blouse, jacket, sweater, kurta, or any other upper-body garment.

The clothing transfer must begin naturally at the reference lower garment's actual waistband. Do not interpret Image 1 as a full outfit and do not transfer any upper-body clothing from Image 1.

Preserve the natural layering between the existing upper garment and the new lower garment. If the original upper garment is tucked, untucked, or overlaps the waistband, maintain that appearance naturally.

Keep the person's identity, face, hair, skin tone, body shape, pose, hands, legs, proportions, footwear, accessories, background, lighting, shadows, camera angle, and framing unchanged.

Only one modification is allowed: replace the lower-body garment.

Priority:

1. Preserve the person and original image.
2. Preserve the upper-body clothing exactly.
3. Transfer only the lower-body garment from Image 1.
4. Maintain the exact appearance and details of the reference garment.
5. Maintain realistic waist alignment, fit, folds, draping, and body proportions.
6. Produce a photorealistic, naturally fitted virtual try-on result.`,
  },
  {
    id: "full",
    label: "Full Outfit",
    prompt: `Use the complete outfit from Image 1 as the clothing reference and apply it to the person in Image 2.

Replace the person's existing clothing with the COMPLETE outfit from Image 1, including BOTH the upper-body garment and lower-body garment. Treat the upper and lower garments as one coordinated outfit and transfer both together.

Preserve the reference outfit as accurately as possible, including its exact design, colors, patterns, prints, logos, embroidery, fabric texture, material appearance, neckline, collar, sleeves, cuffs, waistband, pockets, stitching, garment lengths, fit, cut, layering, proportions, and all other visible clothing details.

Do NOT mix the original clothing from Image 2 with the reference outfit. The final result must contain the upper-body AND lower-body garments from Image 1.

Maintain the correct relationship between both garments, including natural waist alignment, tucking or untucking, overlap, layering, garment lengths, folds, draping, and how the upper garment meets the lower garment.

Do NOT transfer the person, face, body, pose, background, or environment from Image 1. Image 1 must be used ONLY as the outfit reference.

STRICTLY preserve the person from Image 2: keep the exact same identity, face, facial features, hairstyle, hair color, skin tone, body shape, body proportions, pose, hands, arms, legs, expression, footwear, accessories, background, lighting, shadows, camera angle, framing, and image composition unchanged.

Do not unnecessarily expose, hide, reshape, crop, or regenerate body parts. Adapt the reference outfit naturally to the person's existing body and pose rather than changing the person to match the reference model.

ONLY the clothing should change.

Priority:

1. Preserve the person from Image 2 exactly.
2. Transfer BOTH upper and lower garments from Image 1.
3. Preserve the complete outfit's original appearance and coordination.
4. Maintain accurate garment boundaries, layering, proportions, and fit.
5. Preserve all non-clothing elements of Image 2.
6. Produce a photorealistic, naturally fitted virtual try-on result.`,
  },
  {
    id: "shoes",
    label: "Shoes",
    prompt: `Use ONLY the footwear from Image 1 as the reference and apply it to the person in Image 2.

Replace ONLY the person's existing footwear with the exact shoes, sneakers, boots, heels, sandals, slippers, or other footwear shown in Image 1.

Preserve the reference footwear as accurately as possible, including its exact type, design, shape, color, material, texture, sole, heel height, laces, straps, buckles, stitching, logos, patterns, decorations, and all other visible details.

STRICTLY ignore every other item from Image 1. Do NOT transfer any upper-body clothing, lower-body clothing, full outfit, bags, handbags, jewelry, watches, belts, hats, sunglasses, or any other accessories from the reference image.

Image 1 must be used ONLY as a footwear reference.

Keep ALL existing clothing on the person in Image 2 completely unchanged, including both upper-body and lower-body garments.

Preserve the person from Image 2 exactly: same identity, face, hairstyle, skin tone, body shape, body proportions, pose, hands, legs, feet position, expression, clothing, accessories, background, lighting, shadows, camera angle, framing, and image composition.

Fit the reference footwear naturally onto the person's existing feet without changing the person's pose or leg position. Maintain realistic foot alignment, shoe orientation, perspective, scale, contact with the ground, occlusion, lighting, and shadows.

If part of the footwear is naturally hidden by pants, a dress, or the person's pose, preserve realistic occlusion rather than altering the clothing or body to expose the footwear.

ONLY ONE MODIFICATION IS ALLOWED: replace the footwear.

Priority:

1. Preserve the person and original image exactly.
2. Preserve ALL existing clothing and accessories from Image 2.
3. Transfer ONLY the footwear from Image 1.
4. Do not transfer any other element from Image 1.
5. Preserve the exact appearance of the reference footwear.
6. Ensure realistic fit, perspective, ground contact, lighting, and shadows.
7. Produce a photorealistic virtual try-on result.`,
  },
  {
    id: "watch",
    label: "Watch",
    prompt: `Use ONLY the watch or wristwear from Image 1 as the reference and apply it to the person in Image 2.

Transfer ONLY the exact watch, smartwatch, wristband, bracelet-style watch, or other wristwear shown in Image 1. Apply it naturally to ONE clearly visible and suitable wrist of the person in Image 2.

Preserve the reference wristwear as accurately as possible, including its exact design, shape, size, color, material, watch case, dial, screen, bezel, crown, buttons, strap, band, buckle, clasp, texture, stitching, metallic finish, logos, markings, and all other visible details.

STRICTLY ignore every other element from Image 1. Do NOT transfer any upper-body clothing, lower-body clothing, footwear, bags, jewelry, necklaces, rings, earrings, sunglasses, hats, belts, or any other accessories from the reference image.

Image 1 must be used ONLY as the watch/wristwear reference.

Keep ALL existing clothing, footwear, and accessories on the person in Image 2 completely unchanged. If the person already has something on the selected wrist that conflicts with the new wristwear, replace ONLY the conflicting wrist item and leave everything else untouched.

Preserve the person from Image 2 exactly: same identity, face, hairstyle, skin tone, body shape, body proportions, pose, arm position, hand position, fingers, clothing, footwear, accessories, background, lighting, shadows, camera angle, framing, and composition.

Do NOT change the person's arm, hand, wrist, or pose to make the watch more visible. Fit the wristwear naturally around the existing wrist position.

Maintain realistic wrist alignment, strap wrapping, scale, perspective, orientation, contact with the skin, occlusion, reflections, lighting, and shadows. The wristwear must look physically worn on the wrist, not pasted, floating, oversized, distorted, or embedded into the skin.

Apply the wristwear to ONE wrist only. Do NOT duplicate it onto both wrists unless the reference itself clearly represents a matched pair intended to be worn together.

ONLY ONE MODIFICATION IS ALLOWED: add or replace the watch/wristwear.

Priority:

1. Preserve the person and Image 2 exactly.
2. Transfer ONLY the watch/wristwear from Image 1.
3. Do not transfer any other element from Image 1.
4. Preserve the exact appearance and details of the reference wristwear.
5. Keep all clothing, footwear, and unrelated accessories unchanged.
6. Ensure realistic wrist placement, scale, perspective, lighting, reflections, and shadows.
7. Produce a photorealistic and naturally worn result.`,
  },
  {
    id: "hat",
    label: "Hat",
    prompt: `Use ONLY the headwear from Image 1 as the reference and apply it to the person in Image 2.

Transfer ONLY the exact hat, cap, beanie, bucket hat, fedora, or other headwear shown in Image 1. Place it naturally and realistically on the person's existing head in Image 2.

Preserve the reference headwear as accurately as possible, including its exact type, shape, structure, size, color, material, fabric texture, brim, visor, crown, panels, seams, stitching, logos, text, embroidery, patterns, decorations, fasteners, and all other visible details.

STRICTLY ignore every other element from Image 1. Do NOT transfer any upper-body clothing, lower-body clothing, footwear, bags, watches, jewelry, sunglasses, belts, scarves, or any other accessories from the reference image.

Image 1 must be used ONLY as a headwear reference.

Keep ALL existing clothing, footwear, and unrelated accessories on the person in Image 2 completely unchanged.

STRICTLY preserve the person's identity and head: keep the exact same face, facial features, facial proportions, hairstyle, hair color, hair length, hairline, ears, skin tone, expression, head shape, and head orientation. Do NOT regenerate or alter the person's face or hairstyle.

Fit the headwear naturally onto the person's existing head without changing the person's pose or head position. The headwear must follow the exact angle, perspective, orientation, and scale of the person's head.

Allow only the minimum physically necessary interaction between the headwear and hair. Hair may be naturally occluded where the headwear covers it, but do NOT unnecessarily shorten, restyle, recolor, remove, or regenerate the hairstyle. Visible hair outside the headwear must remain consistent with Image 2.

Maintain realistic contact, depth, occlusion, fabric structure, lighting, highlights, and cast shadows so the headwear appears genuinely worn rather than pasted, floating, oversized, undersized, distorted, or embedded into the head.

Do NOT copy the reference person's head, hair, face, pose, or background from Image 1.

ONLY ONE MODIFICATION IS ALLOWED: add or replace the headwear.

Priority:

1. Preserve the person and Image 2 exactly.
2. Transfer ONLY the headwear from Image 1.
3. Preserve the person's face and hairstyle.
4. Do not transfer any other element from Image 1.
5. Preserve the exact design and appearance of the reference headwear.
6. Ensure realistic head fit, scale, perspective, hair interaction, lighting, and shadows.
7. Produce a photorealistic and naturally worn result.`,
  },
  {
    id: "glasses",
    label: "Glasses",
    prompt: `Use ONLY the glasses or eyewear from Image 1 as the reference and apply them naturally to the person in Image 2.

Transfer ONLY the exact glasses, eyeglasses, sunglasses, or eyewear shown in Image 1. Do not transfer any other element from the reference image.

Preserve the reference glasses as accurately as possible, including the exact frame shape, frame thickness, size, proportions, color, material, bridge design, nose pads, temples, hinges, lens shape, lens color or tint, transparency, gradient, reflective properties, logos, decorations, and all other visible details.

STRICTLY preserve the person's identity and face from Image 2. Keep the exact same facial structure, eyes, eyebrows, nose, lips, ears, skin tone, hairstyle, expression, head shape, head angle, gaze direction, and facial proportions.

Do NOT reshape, regenerate, beautify, smooth, distort, or otherwise modify the person's face to accommodate the glasses. Adapt the glasses to the person's existing face instead.

Position the glasses anatomically correctly: the bridge must rest naturally on the nose, the lenses must align correctly with the eyes, and the temples must extend naturally toward and around the ears according to the person's head angle.

Match the exact perspective, rotation, scale, and orientation of the person's face. If the head is turned or tilted, the glasses must follow the same 3D perspective naturally.

Maintain realistic contact points, occlusion, lens transparency, refraction, reflections, highlights, and subtle shadows. The glasses must appear genuinely worn rather than pasted, floating, crooked, oversized, undersized, or embedded into the face.

For transparent or prescription lenses, keep the person's eyes naturally visible through the lenses. For tinted or sunglass lenses, preserve the reference lens tint and opacity without unnecessarily changing the surrounding face or skin.

STRICTLY ignore all other elements from Image 1. Do NOT transfer clothing, footwear, hats, watches, jewelry, bags, hairstyles, facial characteristics, body features, or other accessories.

Keep everything else in Image 2 unchanged, including the person's clothing, accessories, body, pose, hands, background, lighting, shadows, camera angle, framing, and composition.

ONLY ONE MODIFICATION IS ALLOWED: add or replace the glasses.

Priority:

1. Preserve the person's identity and facial features exactly.
2. Transfer ONLY the glasses from Image 1.
3. Preserve the exact design and appearance of the reference glasses.
4. Maintain anatomically correct placement on the nose, eyes, and ears.
5. Match the person's head angle and facial perspective.
6. Preserve realistic lenses, reflections, transparency, contact, and shadows.
7. Do not modify any unrelated part of Image 2.
8. Produce a photorealistic, naturally worn result.`,
  },
];

export default function App() {
  const [mode, setMode] = useState("tryon");
  const [person, setPerson] = useState(null);
  const [product, setProduct] = useState(null);
  const [provider, setProvider] = useState("pruna");
  const [turbo, setTurbo] = useState(false);
  const [tryonCategory, setTryonCategory] = useState(TRYON_PROMPTS[0].id);
  const [tryonPrompt, setTryonPrompt] = useState(TRYON_PROMPTS[0].prompt);
  const [clothType, setClothType] = useState("upper");
  const [hdMode, setHdMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(PHASES[0].label);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const startedAt = useRef(0);
  const resultRef = useRef(null);

  /* One timer drives both the elapsed counter and the phase label. */
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => {
      const ms = Date.now() - startedAt.current;
      setElapsed(ms / 1000);
      const current = [...PHASES].reverse().find((p) => ms >= p.at);
      if (current) setPhase(current.label);
    }, 100);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [result]);

  const canGenerate = Boolean(person && product) && !busy;

  async function generate() {
    setError("");
    setResult(null);
    setBusy(true);
    setElapsed(0);
    setPhase(PHASES[0].label);
    startedAt.current = Date.now();

    const body = new FormData();
    body.append("person", person);
    body.append("product", product);
    body.append("provider", provider);
    if (provider === "pruna") {
      body.append("turbo", turbo ? "true" : "false");
      body.append("category", tryonCategory);
      body.append("prompt", tryonPrompt);
    } else {
      body.append("cloth_type", clothType);
      body.append("hd_mode", hdMode ? "true" : "false");
    }

    try {
      const response = await fetch("/api/tryon", { method: "POST", body });
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error("The server returned an unreadable response.");
      }
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || `Request failed (HTTP ${response.status}).`);
      }
      setResult(payload);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function tryAnother() {
    setResult(null);
    setError("");
    setPerson(null);
    setProduct(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="min-h-screen bg-neutral-50 px-5 pt-10 pb-20 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <main className="mx-auto max-w-3xl">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Virtual Try-On</h1>
          <p className="mt-1.5 text-sm text-neutral-500 dark:text-neutral-400">
            Local test harness for Pruna{" "}
            <code className="font-mono text-[13px]">p-image-try-on</code>
          </p>
        </header>

        <div className="mx-auto mb-6 flex w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900">
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setMode(item.id)}
              aria-pressed={mode === item.id}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                mode === item.id
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {mode === "video" && <ImageToVideo />}

        {mode === "tryon" && (
        <>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UploadCard
            title="Your Photo"
            hint="Click or drop a photo of a person"
            file={person}
            onChange={setPerson}
            onReject={setError}
            disabled={busy}
          />
          <UploadCard
            title="Product Image"
            hint="Click or drop a product image"
            file={product}
            onChange={setProduct}
            onReject={setError}
            disabled={busy}
          />
        </div>

        <div className="mt-5 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950">
          <label className="mb-2 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
            Provider
          </label>
          <div className="flex gap-2">
            {["pruna", "fitroom"].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProvider(p)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  provider === p
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "border border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                }`}
              >
                {p === "pruna" ? "Pruna" : "FitRoom"}
              </button>
            ))}
          </div>
        </div>

        {provider === "pruna" && (
          <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="tryon-prompt"
                className="text-xs font-medium text-neutral-600 dark:text-neutral-400"
              >
                Try-On Prompt
              </label>
              <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                Choose a preset or edit it
              </span>
            </div>
            <div className="mb-2.5 flex flex-wrap gap-2">
              {TRYON_PROMPTS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setTryonCategory(preset.id);
                    setTryonPrompt(preset.prompt);
                  }}
                  disabled={busy}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                    tryonCategory === preset.id
                      ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                      : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <textarea
              id="tryon-prompt"
              value={tryonPrompt}
              onChange={(e) => setTryonPrompt(e.target.value)}
              disabled={busy}
              rows={3}
              maxLength={5000}
              placeholder="Tell Pruna which garment from the product image to use…"
              className="w-full resize-y rounded-lg border border-neutral-200 bg-white p-2.5 text-[13px] leading-relaxed outline-none focus:border-neutral-400 disabled:opacity-60 dark:border-neutral-800 dark:bg-neutral-900"
            />
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          {provider === "pruna" && (
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={turbo}
              disabled={busy}
              onChange={(e) => setTurbo(e.target.checked)}
              className="peer sr-only"
            />
            <span className="relative h-6 w-10 shrink-0 rounded-full bg-neutral-300 transition peer-checked:bg-emerald-600 peer-focus-visible:ring-3 peer-focus-visible:ring-emerald-500/40 dark:bg-neutral-700">
              <span className="absolute top-[3px] left-[3px] h-[18px] w-[18px] rounded-full bg-white transition peer-checked:translate-x-4" />
            </span>
            <span className="flex flex-col">
              <span className="text-sm">Turbo Mode</span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                faster, slightly lower quality
              </span>
            </span>
          </label>
          )}

          {provider === "fitroom" && (
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-neutral-600 dark:text-neutral-400">Cloth Type</span>
              <select
                value={clothType}
                onChange={(e) => setClothType(e.target.value)}
                disabled={busy}
                className="rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-sm disabled:opacity-60 dark:border-neutral-800 dark:bg-neutral-950"
              >
                <option value="upper">Upper Body</option>
                <option value="lower">Lower Body</option>
                <option value="full_set">Full Body</option>
              </select>
            </label>

            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hdMode}
                disabled={busy}
                onChange={(e) => setHdMode(e.target.checked)}
                className="peer sr-only"
              />
              <span className="relative h-5 w-8 shrink-0 rounded-full bg-neutral-300 transition peer-checked:bg-blue-600 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500/40 dark:bg-neutral-700">
                <span className="absolute top-[2px] left-[2px] h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-3" />
              </span>
              <span>HD Mode</span>
            </label>
          </div>
          )}

          <button
            type="button"
            onClick={generate}
            disabled={!canGenerate}
            className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-neutral-100 dark:text-neutral-900"
          >
            Generate Try-On
          </button>
        </div>

        {busy && (
          <div className="mt-5 flex items-center gap-2.5 rounded-2xl border border-neutral-200 bg-white px-4 py-3.5 text-sm dark:border-neutral-800 dark:bg-neutral-900">
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900 dark:border-neutral-700 dark:border-t-neutral-100" />
            <span>{phase}</span>
            <span className="ml-auto tabular-nums text-neutral-500 dark:text-neutral-400">
              {elapsed.toFixed(1)}s
            </span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mt-5 rounded-2xl border border-red-300 bg-red-50 px-4 py-3.5 text-sm break-words text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          >
            {error}
          </div>
        )}

        {result && (
          <section
            ref={resultRef}
            className="mt-7 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <h2 className="mb-3 text-sm font-semibold">
              Result{typeof result.elapsed_seconds === "number" && ` · ${result.elapsed_seconds}s`}
            </h2>
            <img
              src={result.image_url}
              alt="Generated try-on result"
              className="block h-auto w-full rounded-xl bg-neutral-50 dark:bg-neutral-950"
            />
            <div className="mt-3.5 flex flex-wrap gap-2.5">
              <a
                href={result.image_url}
                download="tryon-result.jpg"
                className="grow rounded-lg bg-neutral-900 px-5 py-2.5 text-center text-sm font-medium text-white hover:opacity-90 sm:grow-0 dark:bg-neutral-100 dark:text-neutral-900"
              >
                Download Result
              </a>
              <a
                href={result.image_url}
                target="_blank"
                rel="noopener"
                className="grow rounded-lg border border-neutral-300 px-5 py-2.5 text-center text-sm font-medium hover:bg-neutral-100 sm:grow-0 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                Open Full Size
              </a>
              <button
                type="button"
                onClick={tryAnother}
                className="grow rounded-lg border border-neutral-300 px-5 py-2.5 text-sm font-medium hover:bg-neutral-100 sm:grow-0 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                Try Another
              </button>
            </div>
          </section>
        )}

        {result?.source_url && <VideoPanel sourceUrl={result.source_url} />}
        </>
        )}
      </main>
    </div>
  );
}
