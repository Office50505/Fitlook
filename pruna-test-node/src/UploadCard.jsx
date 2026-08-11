import { useEffect, useRef, useState } from "react";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 15 * 1024 * 1024;

export default function UploadCard({ title, hint, file, onChange, onReject, disabled }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function accept(candidate) {
    if (!candidate) return;
    if (!ALLOWED_TYPES.includes(candidate.type)) {
      onReject("Please choose a JPG, PNG or WEBP image.");
      return;
    }
    if (candidate.size > MAX_BYTES) {
      onReject(`"${candidate.name}" is larger than 15 MB.`);
      return;
    }
    onChange(candidate);
  }

  function clear() {
    if (inputRef.current) inputRef.current.value = "";
    onChange(null);
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        {title}
      </h2>

      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          accept(e.dataTransfer.files?.[0]);
        }}
        className={`flex min-h-[220px] w-full items-center justify-center overflow-hidden rounded-xl border-[1.5px] border-dashed transition disabled:cursor-not-allowed disabled:opacity-60 ${
          dragging
            ? "border-neutral-900 bg-neutral-100 dark:border-neutral-100 dark:bg-neutral-800"
            : "border-neutral-300 hover:border-neutral-500 dark:border-neutral-700 dark:hover:border-neutral-500"
        }`}
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={`${title} preview`}
            className="block max-h-80 w-full object-contain"
          />
        ) : (
          <span className="flex w-full flex-col gap-1.5 p-4 text-neutral-500 dark:text-neutral-400">
            <span className="text-2xl text-neutral-300 dark:text-neutral-600">+</span>
            <span className="text-sm">{hint}</span>
            <span className="text-xs opacity-80">JPG, PNG or WEBP · max 15 MB</span>
          </span>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => accept(e.target.files?.[0])}
      />

      {file && (
        <button
          type="button"
          onClick={clear}
          disabled={disabled}
          className="mt-2.5 w-full rounded-lg border border-neutral-200 py-1.5 text-[13px] text-neutral-500 hover:border-neutral-400 hover:text-neutral-900 disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          Remove
        </button>
      )}
    </div>
  );
}
