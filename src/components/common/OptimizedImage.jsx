import { useEffect, useRef } from 'react';

function highResolutionImageSource(src) {
  const value = String(src || '').trim();
  if (!/m\.media-amazon\.(?:com|in)\/images\//i.test(value)) return value;

  // Imported Amazon products often use 342–445px thumbnails. Requesting the
  // same CDN asset at 1200px keeps catalog imagery crisp on retina displays.
  return value.replace(/\._(?:AC_)?(?:SX|SY|SL)\d+_\.(?=(?:avif|jpe?g|png|webp)(?:[?#]|$))/i, '._AC_SL1200_.');
}

/**
 * @typedef {import('react').ImgHTMLAttributes<HTMLImageElement> & {
 *   eager?: boolean;
 *   fallbackSrc?: string;
 * }} OptimizedImageProps
 */

/**
 * Shared image primitive for consistent lazy loading and async decoding.
 *
 * @param {OptimizedImageProps} props
 */
export default function OptimizedImage({ eager = false, loading, decoding = 'async', fetchPriority, fallbackSrc = '/assets/hero2.png', src, onError, ...props }) {
  const fallbackApplied = useRef(false);
  const imageSrc = highResolutionImageSource(src);

  useEffect(() => {
    fallbackApplied.current = false;
  }, [imageSrc, fallbackSrc]);

  const handleError = (event) => {
    onError?.(event);
    if (fallbackApplied.current || !fallbackSrc || event.currentTarget.src.endsWith(fallbackSrc)) return;
    fallbackApplied.current = true;
    event.currentTarget.src = fallbackSrc;
  };

  return (
    <img
      src={imageSrc}
      loading={loading || (eager ? 'eager' : 'lazy')}
      decoding={decoding}
      fetchPriority={fetchPriority || (eager ? 'high' : 'auto')}
      onError={handleError}
      {...props}
    />
  );
}
