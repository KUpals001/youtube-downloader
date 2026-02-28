"use client";

interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: () => void;
}

/**
 * Custom checkbox component with a label.
 * 
 * @param props - Component props.
 * @returns Checkbox element.
 */
export function Checkbox({ label, checked, onChange }: CheckboxProps) {
  return (
    <label
      className="flex items-center gap-2.5 cursor-pointer select-none group"
      onClick={onChange}
    >
      <span
        className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${checked
            ? "bg-red-600 border-red-600"
            : "border-gray-300 dark:border-zinc-600 group-hover:border-red-400"
          }`}
      >
        {checked && (
          <svg
            className="w-2.5 h-2.5 text-white"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        )}
      </span>
      <span className="text-sm text-gray-700 dark:text-zinc-300">{label}</span>
    </label>
  );
}
