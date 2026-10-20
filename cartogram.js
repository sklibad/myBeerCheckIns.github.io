// Shared helpers for the cartogram pages (map1–3.html)

// Devices without a mouse (phones, tablets) cannot hover
var isTouchDevice = window.matchMedia('(hover: none)').matches;

function isSmallScreen() {
    return window.innerWidth <= 760;
}

// Popups never get wider than the screen
function popupMaxWidth() {
    return Math.min(500, window.innerWidth - 60);
}

function popupOptions() {
    return {
        maxWidth: popupMaxWidth(),
        minWidth: Math.min(200, popupMaxWidth()),
        autoPanPadding: [12, 12]
    };
}

// Highlight a district on hover (mouse) or while its popup is open (touch)
function addHoverHighlight(geoJsonLayer, weight) {
    var highlight = {
        fillColor: '#ff1601',
        color: '#881d00',
        weight: weight
    };

    geoJsonLayer.eachLayer(function (layer) {
        if (isTouchDevice) {
            layer.on('popupopen', function () {
                this.setStyle(highlight);
            });
            layer.on('popupclose', function () {
                geoJsonLayer.resetStyle(this);
            });
        } else {
            layer.on('mouseover', function () {
                this.setStyle(highlight);
            });
            layer.on('mouseout', function () {
                geoJsonLayer.resetStyle(this);
            });
        }
    });
}

// On small screens zoom so that the whole area is visible
function fitMapOnSmallScreen(map, geoJsonLayer) {
    if (isSmallScreen()) {
        map.fitBounds(geoJsonLayer.getBounds(), { padding: [8, 8], animate: false });
    }
}
