/**
 * Header component featuring the logo and application title.
 * 
 * @returns Header element.
 */
export function Header() {
  return (
    <header className="bg-red-600 shadow-md sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-2.5">
        <svg viewBox="0 0 24 24" className="w-7 h-7 fill-white flex-shrink-0">
          <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.3 31.3 0 0 0 0 12a31.3 31.3 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.3 31.3 0 0 0 24 12a31.3 31.3 0 0 0-.5-5.8zM9.7 15.5V8.5l6.3 3.5-6.3 3.5z" />
        </svg>
        <h1 className="text-white font-semibold text-lg tracking-tight">
          YouTube Downloader
        </h1>
      </div>
    </header>
  );
}
