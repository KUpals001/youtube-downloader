import Image from "next/image";
import logo from "../.github/assets/images/logo.svg";

/**
 * Header component featuring the logo and application title.
 * 
 * @returns Header element.
 */
export function Header() {
  return (
    <header className="bg-red-600 shadow-md sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-2.5">
        <Image
          src={logo}
          alt="YouTube Downloader Logo"
          className="rounded-md h-8 w-8"
        />
        <h1 className="text-white font-semibold text-lg tracking-tight">
          YouTube Downloader
        </h1>
      </div>
    </header>
  );
}
