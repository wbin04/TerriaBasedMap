// Admin-mode logic: switch modes, load models for viewport, draw polygons
(function(){
    'use strict';

    async function switchToAdminMode() {
        const viewer = window.viewer;
        if (!viewer) return;
        window.currentMode = 'admin';
        window.filterCategory = null;
        if (window.debounceTimer) { clearTimeout(window.debounceTimer); window.debounceTimer = null; }

        let dvhcDataset = (window.datasets || []).find(d => d.id === 'DVHC');
        if (!dvhcDataset) { console.warn('DVHC dataset not found'); return; }
        if (!dvhcDataset.dataSource) dvhcDataset.dataSource = new Cesium.CustomDataSource('DVHC');
        dvhcDataset.dataSource.entities.removeAll();

        (window.datasets || []).forEach(dataset => { if (dataset.source === 'backend' && dataset.dataSource && dataset.visible) { try { if (!viewer.dataSources.contains(dataset.dataSource)) viewer.dataSources.add(dataset.dataSource); } catch(e){} dataset.dataSource.show = true; } });

        await loadModelsForViewport();
        window.backendDatasets.updateDataSourceZOrder && window.backendDatasets.updateDataSourceZOrder();
        await new Promise(r => setTimeout(r,100));
        const entities = dvhcDataset.dataSource.entities.values;
        if (entities.length > 0) viewer.zoomTo(entities).catch(()=>{});
        viewer.camera.moveEnd.addEventListener(window.onCameraMove || (()=>{}));
    }

    function switchToNormalMode() {
        const viewer = window.viewer;
        window.currentMode = 'normal';
        window.filterCategory = null;
        if (window.debounceTimer) { clearTimeout(window.debounceTimer); window.debounceTimer = null; }
        try { viewer.camera.moveEnd.removeEventListener(window.onCameraMove || (()=>{})); } catch (e) {}

        const dvhcDataset = (window.datasets || []).find(d => d.id === 'DVHC');
        if (dvhcDataset && dvhcDataset.dataSource) { dvhcDataset.dataSource.entities.removeAll(); }
        viewer.scene.requestRender();
        (window.datasets || []).forEach(dataset => { if (dataset.source === 'backend' && dataset.dataSource && dataset.visible) { try { if (!viewer.dataSources.contains(dataset.dataSource)) viewer.dataSources.add(dataset.dataSource); } catch(e){} dataset.dataSource.show = true; } });
        viewer.scene.requestRender();
    }

    function getViewportInfo() {
        try {
            const viewer = window.viewer; if (!viewer) return null;
            const rect = viewer.camera.computeViewRectangle(); if (!rect) return null;
            const west = Cesium.Math.toDegrees(rect.west); const south = Cesium.Math.toDegrees(rect.south); const east = Cesium.Math.toDegrees(rect.east); const north = Cesium.Math.toDegrees(rect.north);
            const cameraPosition = viewer.camera.positionCartographic; const cameraHeight = cameraPosition ? cameraPosition.height : 100000;
            const viewportWidth = Math.abs(east - west); const viewportHeight = Math.abs(north - south);
            const zoomLevel = Math.max(1, Math.floor(360 / Math.max(viewportWidth, viewportHeight)));
            let lod = 'province'; if (cameraHeight < 200000) lod = 'ward';
            return { bbox: `${west},${south},${east},${north}`, zoom: Math.min(zoomLevel,100), lod, cameraHeight };
        } catch (e) { return null; }
    }

    async function loadModelsForViewport() {
        if (window.currentMode !== 'admin') return;
        const viewportInfo = getViewportInfo(); if (!viewportInfo) return;
        const { bbox, zoom, lod } = viewportInfo;
        let url = `http://localhost:8000/models?bbox=${bbox}&zoom=${zoom}&lod=${lod}`; if (window.filterCategory) url += `&category=${window.filterCategory}`;
        try {
            const resp = await fetch(url); const data = await resp.json(); const models = data.models || [];
            const dvhcDataset = (window.datasets || []).find(d => d.id === 'DVHC'); if (!dvhcDataset || !dvhcDataset.dataSource) { console.error('DVHC DataSource not found'); return; }
            dvhcDataset.dataSource.entities.removeAll();
            models.forEach((model, idx) => { try { window.processModel && window.processModel(model, idx, lod, dvhcDataset.dataSource); } catch(e){} });
            window.backendDatasets.cacheEntitiesOriginalAppearance && window.backendDatasets.cacheEntitiesOriginalAppearance(dvhcDataset.dataSource);
            window.backendDatasets.applyDatasetOpacityToEntities && window.backendDatasets.applyDatasetOpacityToEntities(dvhcDataset);
            if (!window.viewer.dataSources.contains(dvhcDataset.dataSource)) window.backendDatasets.updateDataSourceZOrder && window.backendDatasets.updateDataSourceZOrder();
            window.viewer.scene.requestRender();
        } catch (err) { console.error('loadModelsForViewport error', err); }
    }

    // Expose
    window.switchToAdminMode = switchToAdminMode;
    window.switchToNormalMode = switchToNormalMode;
    window.loadModelsForViewport = loadModelsForViewport;
    window.getViewportInfo = getViewportInfo;
})();
