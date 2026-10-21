// Shared navigation behaviour: highlight the link of the current page
document.addEventListener('DOMContentLoaded', function () {
    var page = location.pathname.split('/').pop() || 'map4.html';
    document.querySelectorAll('.site-nav a').forEach(function (link) {
        if (link.getAttribute('href') === page) {
            link.setAttribute('aria-current', 'page');
        }
    });
});
