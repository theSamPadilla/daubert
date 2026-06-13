'use client';

import { useRef, useEffect } from 'react';

interface OtpInputProps {
  value: string;
  onChange: (val: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}

const LENGTH = 6;

export function OtpInput({ value, onChange, autoFocus = false, disabled = false }: OtpInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const cells = Array.from({ length: LENGTH }, (_, i) => value[i] ?? '');

  useEffect(() => {
    if (!autoFocus) return;
    const firstEmpty = cells.findIndex((c) => c === '');
    const target = firstEmpty === -1 ? LENGTH - 1 : firstEmpty;
    inputRefs.current[target]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  function update(nextCells: string[]) {
    onChange(nextCells.join(''));
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>, index: number) {
    if (disabled) return;
    const raw = e.target.value;
    const digit = raw.replace(/\D/g, '').slice(-1);
    if (raw && !digit) return; // non-digit dropped silently
    const next = [...cells];
    next[index] = digit;
    update(next);
    if (digit && index < LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (disabled) return;
    if (e.key === 'Backspace') {
      if (cells[index]) {
        const next = [...cells];
        next[index] = '';
        update(next);
      } else if (index > 0) {
        const next = [...cells];
        next[index - 1] = '';
        update(next);
        inputRefs.current[index - 1]?.focus();
      }
    }
    if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowRight' && index < LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    if (disabled) return;
    const digits = e.clipboardData.getData('text/plain').replace(/\D/g, '').slice(0, LENGTH);
    if (!digits) return;
    const next = [...cells];
    for (let i = 0; i < LENGTH; i++) {
      next[i] = digits[i] ?? '';
    }
    update(next);
    const focusAt = Math.min(digits.length, LENGTH - 1);
    inputRefs.current[focusAt]?.focus();
  }

  return (
    <div className="flex items-center gap-2.5">
      {cells.map((digit, index) => (
        <input
          key={index}
          ref={(el) => { inputRefs.current[index] = el; }}
          type="text"
          inputMode="numeric"
          pattern="\d*"
          maxLength={1}
          value={digit}
          onChange={(e) => handleChange(e, index)}
          onKeyDown={(e) => handleKeyDown(e, index)}
          onPaste={handlePaste}
          disabled={disabled}
          aria-label={`OTP digit ${index + 1}`}
          className={[
            'h-[52px] w-[52px] rounded-lg border text-center',
            'font-mono text-3xl tracking-wide text-ink',
            'bg-surface border-line-strong',
            'focus:outline-none focus:border-brand',
            'transition-colors',
            disabled ? 'opacity-40 cursor-not-allowed' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        />
      ))}
    </div>
  );
}
