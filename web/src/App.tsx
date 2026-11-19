import { Link, Outlet, Route, Routes, useLocation } from "react-router";
import { useEffect, useLayoutEffect } from "react";
import { Toaster } from "sonner";
import { Header } from "@/components/Header";
import { InstallPrompt } from "@/components/InstallPrompt";
import { setPage } from "@/lib/analytics";
import { feedPlace, rememberFeed } from "@/lib/scroll";
import { MiniPlayer } from "@/components/MiniPlayer";
import { StateBlock } from "@/components/StateBlock";
import { FooterThemeToggle } from "@/components/ThemeToggle";
import { Catalog } from "@/pages/Catalog";
import { Dance } from "@/pages/Dance";
import { Login, Register } from "@/pages/Login";
import { Me } from "@/pages/Me";
import { OgCard } from "@/pages/OgCard";
import { Profile } from "@/pages/Profile";

function Shell() {
  const { pathname, search } = useLocation();
  // A new page starts at the top; the feed, however you come back to it (the back button, the
  // video dragged down, the logo from another page), is where you left it. A reload starts over.
  useLayoutEffect(() => {
    const feed = feedPlace();
    window.scrollTo(0, feed.href === pathname + search ? feed.y : 0);
    rememberFeed();
    setPage(pathname);
  }, [pathname]);
  useEffect(rememberFeed, [search]);
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-bg focus:px-3 focus:py-2">
        К содержимому
      </a>
      <Header />
      {/* Phones: at least a screen tall, so the theme switch below stays out of sight while a page loads. */}
      <div id="main" className="max-sm:min-h-[calc(100dvh-64px)]">
        <Outlet />
      </div>
      <FooterThemeToggle />
      <InstallPrompt />
      <MiniPlayer />
      <Toaster
        position="bottom-center"
        offset={16}
        mobileOffset={{ bottom: "max(16px, env(safe-area-inset-bottom))" }}
        swipeDirections={["left", "right", "bottom"]}
        closeButton
        toastOptions={{
          unstyled: true,
          closeButtonAriaLabel: "Закрыть",
          // The toast itself is the pill, centred, with its ✕ inside on the right.
          classNames: {
            toast: "!right-0 !left-0 mx-auto flex !w-fit max-w-full items-center gap-1 rounded-full bg-ink py-1.5 pr-1.5 pl-4 font-sans text-sm text-bg shadow-lg",
            content: "py-1",
            closeButton: "order-last grid size-7 shrink-0 place-items-center rounded-full text-bg/70 hover:bg-bg/15 hover:text-bg [&_svg]:size-3.5",
            icon: "hidden",
          },
        }}
      />
    </>
  );
}

function NotFound() {
  return (
    <main className="mx-auto max-w-[1200px] px-3 sm:px-4 lg:px-6">
      <StateBlock className="mt-6" title="Страница не найдена" action={<Link to="/" className="text-accent underline underline-offset-4">К списку танцев</Link>} />
    </main>
  );
}

export function App() {
  return (
    <Routes>
      {import.meta.env.DEV ? <Route path="og-card" element={<OgCard />} /> : null}
      <Route element={<Shell />}>
        <Route index element={<Catalog />} />
        <Route path="dance/:slug" element={<Dance />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="me" element={<Me />} />
        {/* /@username (a route segment can't be part "@", part param, so the page checks the "@") */}
        <Route path=":handle" element={<Profile />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
