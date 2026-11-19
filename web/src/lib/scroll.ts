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
