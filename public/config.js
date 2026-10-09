// Which multiplayer server this copy of the client talks to.
// - Served by server.js (same origin): leave empty.
// - Static hosting (GitHub Pages): uses PAGES_SERVER below. Quick-tunnel URLs are temporary, so update it
//   (or open the site with ?server=https://your-server) when the server moves.
// Solo "Play vs AI" never needs a server.
(function () {
  var PAGES_SERVER = 'https://examples-frames-fashion-subsequently.trycloudflare.com';
  var isStatic = /\.github\.io$/.test(location.hostname);
  window.FLAN_SERVER = window.FLAN_SERVER || (isStatic ? PAGES_SERVER : '');
})();
