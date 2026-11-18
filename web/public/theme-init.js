// Applied before first paint: stored choice wins, otherwise follow the system.
(function () {
  var choice = "system";
  try { choice = localStorage.getItem("bal-theme") || "system"; } catch (e) {}
  var dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
