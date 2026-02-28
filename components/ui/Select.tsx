"use client";

interface SelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
}

/**
 * Custom select component with a label.
 * 
 * @param props - Component props.
 * @returns Select element.
 */
export function Select({ label, value, onChange, options }: SelectProps) {
  return (
    <div className="flex-1 min-w-28">
      <p className="text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">
        {label}
      </p>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700
                   rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-zinc-100 outline-none
                   focus:ring-2 focus:ring-red-500 focus:border-transparent transition cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
