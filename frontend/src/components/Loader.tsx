'use client';

interface LoaderProps {
  inline?: boolean;
  className?: string;
}

/**
 * Universal loading state. Full-screen by default; pass `inline` to fit a
 * container. Logo breathes; three dots fade in sequence beneath it.
 */
export function Loader({ inline = false, className = '' }: LoaderProps) {
  const wrapper = inline
    ? 'flex h-full w-full items-center justify-center py-12'
    : 'flex min-h-screen w-full items-center justify-center bg-gray-900';

  return (
    <div
      className={`${wrapper} ${className}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex flex-col items-center gap-4">
        <img
          src="/logo-light.png"
          alt=""
          aria-hidden="true"
          draggable={false}
          className="h-16 w-16 select-none animate-[breathing_2.4s_ease-in-out_infinite]"
        />
        <div aria-hidden="true" className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-[dotFade_1.4s_ease-in-out_infinite]" />
          <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-[dotFade_1.4s_ease-in-out_infinite] [animation-delay:200ms]" />
          <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-[dotFade_1.4s_ease-in-out_infinite] [animation-delay:400ms]" />
        </div>
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
