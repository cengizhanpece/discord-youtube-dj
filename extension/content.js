// Runs on youtube.com and music.youtube.com. Tells the background worker whenever the
// video in this tab changes (click, autoplay, next track, back/forward…).
//
// YouTube is a single-page app, so the page never reloads. We listen for its own
// navigation event and also poll the URL once a second, which also catches
// YouTube Music switching tracks on its own.

let lastVideoId = null;

function currentVideoId() {
  const url = new URL(location.href);
  if (url.pathname === '/watch') return url.searchParams.get('v');
  const shorts = url.pathname.match(/^\/shorts\/([\w-]{11})/);
  return shorts ? shorts[1] : null;
}

function check() {
  const id = currentVideoId();
  if (!id || id === lastVideoId) return;
  lastVideoId = id;
  chrome.runtime.sendMessage({ type: 'video', videoId: id }).catch(() => {
    // The extension was reloaded/updated; this old content script is orphaned.
    clearInterval(timer);
  });
}

// When the user switches the extension on while already watching something, play it right
// away — but only from the tab they're looking at, not every open YouTube tab.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enabled?.newValue === true && document.visibilityState === 'visible') {
    lastVideoId = null;
    check();
  }
});

document.addEventListener('yt-navigate-finish', check);
const timer = setInterval(check, 1000);
check();
