// Shared navigation behaviour: hamburger menu, tap-to-open dropdown, current page highlight
document.addEventListener('DOMContentLoaded', function () {
    var toggle = document.querySelector('.nav-toggle');
    var panel = document.getElementById('site-nav');
    var dropdown = document.querySelector('.dropdown');
    var dropbtn = dropdown ? dropdown.querySelector('.dropbtn') : null;

    function setMenuOpen(open) {
        panel.classList.toggle('open', open);
        toggle.setAttribute('aria-expanded', open);
    }

    function setDropdownOpen(open) {
        dropdown.classList.toggle('open', open);
        dropbtn.setAttribute('aria-expanded', open);
    }

    if (toggle && panel) {
        toggle.addEventListener('click', function () {
            setMenuOpen(!panel.classList.contains('open'));
        });
    }

    if (dropbtn) {
        dropbtn.addEventListener('click', function (e) {
            e.stopPropagation();
            setDropdownOpen(!dropdown.classList.contains('open'));
        });
    }

    // Close menus when tapping outside the header or pressing Escape
    document.addEventListener('click', function (e) {
        if (e.target.closest('.site-header')) return;
        if (dropdown) setDropdownOpen(false);
        if (panel) setMenuOpen(false);
    });

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (dropdown) setDropdownOpen(false);
        if (panel) setMenuOpen(false);
    });

    // Highlight the link of the current page
    var page = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.panel a').forEach(function (link) {
        if (link.getAttribute('href') === page) {
            link.setAttribute('aria-current', 'page');
            var parentDropdown = link.closest('.dropdown');
            if (parentDropdown) {
                parentDropdown.querySelector('.dropbtn').setAttribute('aria-current', 'page');
            }
        }
    });
});
