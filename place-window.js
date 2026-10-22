// The check-in map place view (map4.html?venue=… / ?brewery=…, optionally &checkin=<ID>) in a
// window over the current page (cartograms, statistics); closing it returns to the page exactly
// as it was. Every link with a data-place-window attribute opens this way on a plain click;
// Ctrl / middle click still opens it in a new tab.
var placeWindow = null;

function openPlaceWindow(url, title) {
    if (!placeWindow) {
        var backdrop = document.createElement('div');
        backdrop.className = 'place-window-backdrop';
        backdrop.hidden = true;
        backdrop.innerHTML = '<div class="place-window" role="dialog" aria-modal="true" aria-labelledby="place-window-title">' +
            '<div class="place-window-header"><span class="place-window-title" id="place-window-title"></span>' +
            '<button type="button" class="place-window-close" aria-label="Close and return">&times;</button></div>' +
            '<iframe class="place-window-frame" title="Check-in map"></iframe></div>';
        document.body.appendChild(backdrop);
        placeWindow = {
            backdrop: backdrop,
            title: backdrop.querySelector('.place-window-title'),
            frame: backdrop.querySelector('iframe')
        };
        backdrop.querySelector('.place-window-close').addEventListener('click', closePlaceWindow);
        backdrop.addEventListener('click', function (e) {
            if (e.target === backdrop) closePlaceWindow();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closePlaceWindow();
        });
        // Escape pressed inside the check-in map closes the window too (same origin), unless it
        // closes the check-in detail sheet there first (checked in the capture phase, before
        // the check-in map handles the key)
        placeWindow.frame.addEventListener('load', function () {
            try {
                var doc = placeWindow.frame.contentWindow.document;
                doc.addEventListener('keydown', function (e) {
                    var sheet = doc.getElementById('contentBox');
                    if (e.key === 'Escape' && !(sheet && sheet.classList.contains('open'))) closePlaceWindow();
                }, true);
            } catch (err) { /* not reachable: Escape works outside the frame only */ }
        });
    }
    placeWindow.title.textContent = title;
    placeWindow.frame.src = url;
    placeWindow.backdrop.hidden = false;
    placeWindow.backdrop.querySelector('.place-window-close').focus();
}

function closePlaceWindow() {
    if (!placeWindow || placeWindow.backdrop.hidden) return;
    placeWindow.backdrop.hidden = true;
    placeWindow.frame.src = 'about:blank';
}

document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('a[data-place-window]');
    if (!link || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openPlaceWindow(link.getAttribute('href'), link.textContent);
});
