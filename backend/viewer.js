// Viewer initialization and entity interaction helpers
(function(){
    'use strict';
    let viewer = null;
    function initializeMainViewer() {
        if (viewer) return;
        const cesiumContainer = document.getElementById('cesiumContainer');
        if (!cesiumContainer) { console.error('cesiumContainer not found in DOM'); return; }
        viewer = new Cesium.Viewer('cesiumContainer', {
            baseLayerPicker: true, geocoder: true, homeButton: true, sceneModePicker: true,
            navigationHelpButton: true, animation: false, timeline: false, fullscreenButton: true,
            vrButton: false, selectionIndicator: false, infoBox: false,
            requestRenderMode: false, maximumRenderTimeChange: Infinity
        });
        viewer.scene.globe.depthTestAgainstTerrain = false;
        viewer.scene.fog.enabled = true;
        viewer.scene.fog.density = 0.0001;
        window.viewer = viewer;
    }

    function initializeClickHandler(onFeatureSelected) {
        if (!viewer) { console.warn('Cannot initialize click handler: viewer not ready'); return; }
        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        handler.setInputAction(function(click) {
            const pickedObject = viewer.scene.pick(click.position);
            if (onFeatureSelected && typeof onFeatureSelected === 'function') {
                onFeatureSelected(pickedObject);
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }

    window.backendViewer = window.backendViewer || {};
    window.backendViewer.initializeMainViewer = initializeMainViewer;
    window.backendViewer.initializeClickHandler = initializeClickHandler;
    // expose viewer reference
    Object.defineProperty(window.backendViewer, 'viewer', { get: () => viewer });
})();
