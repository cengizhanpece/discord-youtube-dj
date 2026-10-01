// Runs on youtube.com and music.youtube.com. Tells the background worker whenever the
// video in this tab changes (click, autoplay, next track, back/forward…).
//
// YouTube is a single-page app, so the page never reloads. A content script shares the
// page's DOM and URL (only JS variables are isolated), so it can watch navigation directly:
//
//   - Navigation API `currententrychange`: fires on every in-app URL change
//   - YouTube's own `yt-navigate-finish` DOM event
//   - `loadedmetadata` on any <video>: a new track started loading
//   - polling the URL once a second, as a fallback
//
// The events matter because Chrome throttles timers in background tabs (down to once a
// minute), and YouTube Music usually plays in a background tab while it skips tracks.

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
  try {
    chrome.runtime.sendMessage({ type: 'video', videoId: id }).catch(stop);
  } catch {
    // "Extension context invalidated": the extension was reloaded/updated and this
    // content script is orphaned. The new version injects a fresh one on next page load.
    stop();
  }
}

// Media events don't bubble, but capturing listeners on the document still see them.
const onMedia = (e) => { if (e.target instanceof HTMLVideoElement) check(); };

function stop() {
  clearInterval(timer);
  document.removeEventListener('yt-navigate-finish', check);
  document.removeEventListener('loadedmetadata', onMedia, true);
  globalThis.navigation?.removeEventListener('currententrychange', check);
}

// When the user switches the extension on while already watching something, play it right
// away — but only from the tab they're looking at, not every open YouTube tab.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enabled?.newValue === true && document.visibilityState === 'visible') {
    lastVideoId = null;
    check();
  }
});

globalThis.navigation?.addEventListener('currententrychange', check);
document.addEventListener('yt-navigate-finish', check);
document.addEventListener('loadedmetadata', onMedia, true);
const timer = setInterval(check, 1000);
check();
