/**
 * After «Свернуть» (a long comment, the description card), the page jumps back to where the
 * element starts if that is now above the screen (like YouTube): just below the header, or
 * below the player where it sticks to the top (phones). No animation: you land on what you
 * were reading at once.
 */
export function backToTop(el: HTMLElement | null) {
  if (!el) return;
  // Inside the phone's comment drawer it is the drawer that scrolls.
  const box = el.closest<HTMLElement>("[data-scroller]");
  if (box) {
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top - 12;
    if (top < 0) box.scrollBy({ top, behavior: "instant" });
    return;
  }
  const player = document.querySelector<HTMLElement>("[data-sticky-player]");
  const covered = player && getComputedStyle(player).position === "sticky" ? player.getBoundingClientRect().bottom : 64;
  const top = el.getBoundingClientRect().top - covered - 12;
  if (top < 0) window.scrollBy({ top, behavior: "instant" });
}

/**
 * Where the feed was left, so coming back to it (the back button, the video dragged down, the
 * logo from another page) lands on the same row instead of the top. Kept in memory only: a
 * reload starts at the top.
 */
const feed = { href: "/", y: 0 };

export function rememberFeed() {
  // The URL changes before the next page renders, so the jump to the top when leaving isn't recorded.
  if (location.pathname !== "/") return;
  feed.href = location.pathname + location.search;
  feed.y = scrollY;
}
addEventListener("scroll", rememberFeed, { passive: true });
// And at the click that leaves it (before the link navigates), in case the last scroll event
// hasn't arrived yet.
addEventListener("click", rememberFeed, { capture: true, passive: true });

export const feedPlace = () => feed;
