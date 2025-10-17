// Utilities (non-UI) used by backend modules
(function(){
    'use strict';
    // Shared constants
    const HIGHLIGHT_COLORS = {
        point: Cesium.Color.YELLOW,
        polyline: Cesium.Color.YELLOW,
        polygon: Cesium.Color.YELLOW.withAlpha(0.7)
    };

    const layerColors = {};
    function getColorForLayer(layerName) {
        if (!layerColors[layerName]) {
            const hue = (Object.keys(layerColors).length * 137.508) % 360;
            layerColors[layerName] = Cesium.Color.fromHsl(hue / 360, 0.7, 0.5);
        }
        return layerColors[layerName];
    }

    function getGeometryType(entity) {
        if (!entity) return 'Unknown';
        if (entity.point) return 'Point';
        if (entity.polyline) return 'LineString';
        if (entity.polygon) return 'Polygon';
        if (entity.billboard) return 'Billboard';
        if (entity.model) return '3D Model';
        return 'Unknown';
    }

    function formatPropertyValue(value) {
        if (value === null || value === undefined) return '<em style="color: #adb5bd;">null</em>';
        if (typeof value === 'object') {
            if (value instanceof Date) return value.toLocaleString();
            return '<pre style="margin: 0; font-size: 11px; background: #f8f9fa; padding: 8px; border-radius: 4px; overflow-x: auto;">' + 
                   JSON.stringify(value, null, 2) + '</pre>';
        }
        if (typeof value === 'boolean') {
            return value ? '<span style="color: #28a745; font-weight: 600;">true</span>' : 
                          '<span style="color: #dc3545; font-weight: 600;">false</span>';
        }
        if (typeof value === 'number') {
            return '<span style="font-weight: 500;">' + value.toLocaleString() + '</span>';
        }
        if (typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'))) {
            return `<a href="${value}" target="_blank" style="color: #667eea; text-decoration: none; font-weight: 500;">${value}</a>`;
        }
        return String(value);
    }

    // Expose
    window.backendUtils = window.backendUtils || {};
    window.backendUtils.HIGHLIGHT_COLORS = HIGHLIGHT_COLORS;
    window.backendUtils.getColorForLayer = getColorForLayer;
    window.backendUtils.getGeometryType = getGeometryType;
    window.backendUtils.formatPropertyValue = formatPropertyValue;
})();
