// Compatibility shims to preserve old global function names used by frontend HTML
(function(){
    'use strict';
    // datasets
    window.toggleDataset = window.toggleDataset || function(id, source, checked) {
        // No-op if backendDatasets not ready
        try { if (window.backendDatasets && typeof window.backendDatasets.getDatasets === 'function') {
            const dsList = window.datasets || [];
            const normalizedId = source === 'backend' ? parseInt(id) : id;
            const ds = dsList.find(d => d.id === normalizedId && d.source === source);
            if (ds) { ds.visible = !!checked; if (ds.dataSource) ds.dataSource.show = !!checked; window.viewer && window.viewer.scene.requestRender(); }
        } } catch (e) {}
    };

    window.updateOpacity = window.updateOpacity || function(id, source, value) {
        try {
            const normalizedId = source === 'backend' ? parseInt(id) : id;
            const ds = (window.datasets || []).find(d => d.id === normalizedId && d.source === source);
            if (!ds) return;
            ds.opacity = value / 100;
            window.backendDatasets && window.backendDatasets.applyDatasetOpacityToEntities && window.backendDatasets.applyDatasetOpacityToEntities(ds);
            const el = document.getElementById(`opacity-value-${id}`);
            if (el) el.textContent = value + '%';
        } catch (e) { console.warn(e); }
    };

    window.deleteDataset = window.deleteDataset || function(id, source) {
        try { window.backendDatasets && window.backendDatasets.deleteDataset && window.backendDatasets.deleteDataset(id, source); } catch(e){}
        try { if (window.renderDatasetList) window.renderDatasetList(); } catch(e){}
    };

    window.toggleLayer = window.toggleLayer || function(datasetId, source, layerIdx) {
        try {
            const normalizedId = source === 'backend' ? parseInt(datasetId) : datasetId;
            const ds = (window.datasets || []).find(d => d.id === normalizedId && d.source === source);
            if (!ds || !ds.layers || !ds.layers[layerIdx]) return;
            const visible = document.getElementById(`layer-${datasetId}-${layerIdx}`) ? document.getElementById(`layer-${datasetId}-${layerIdx}`).checked : true;
            if (typeof ds.layers[layerIdx] === 'object') ds.layers[layerIdx].visible = visible;
            if (ds.dataSource) {
                const layerName = typeof ds.layers[layerIdx] === 'object' ? ds.layers[layerIdx].name : ds.layers[layerIdx];
                ds.dataSource.entities.values.forEach(entity => { try { if (entity.properties?.Layer?.getValue() === layerName) entity.show = visible; } catch(e){} });
                window.viewer && window.viewer.scene.requestRender();
            }
        } catch (e) { console.warn(e); }
    };

    window.changeLayerColor = window.changeLayerColor || function(datasetId, source, layerIdx, color) {
        try { if (window.backendDatasets && typeof window.backendDatasets.applyDatasetOpacityToEntities === 'function') { /* handled in datasets.changeLayerColor previously */ } } catch (e) {}
        try { const normalizedId = source === 'backend' ? parseInt(datasetId) : datasetId; const ds = (window.datasets||[]).find(d=>d.id===normalizedId && d.source===source); if (!ds) return; if (typeof ds.layers[layerIdx] === 'object') ds.layers[layerIdx].color = color; if (ds.dataSource) { const layerName = typeof ds.layers[layerIdx] === 'object' ? ds.layers[layerIdx].name : ds.layers[layerIdx]; const cesiumColor = Cesium.Color.fromCssColorString(color); ds.dataSource.entities.values.forEach(entity => { try { if (entity.properties?.Layer?.getValue() === layerName) { if (entity.polygon?.material instanceof Cesium.ColorMaterialProperty) { entity.polygon.material = new Cesium.ColorMaterialProperty(cesiumColor.withAlpha(ds.opacity)); } if (entity.polyline?.material instanceof Cesium.ColorMaterialProperty) { entity.polyline.material = new Cesium.ColorMaterialProperty(cesiumColor); } if (entity.point) { entity.point.color = new Cesium.ConstantProperty(cesiumColor); } } } catch(e){} }); window.viewer && window.viewer.scene.requestRender(); } } catch(e){console.warn(e);}    };

    window.moveDatasetUp = window.moveDatasetUp || function(index) { try { if (window.backendDatasets) window.backendDatasets.moveDataset(index, index+1); if (window.renderDatasetList) window.renderDatasetList(); } catch(e){} };
    window.moveDatasetDown = window.moveDatasetDown || function(index) { try { if (window.backendDatasets) window.backendDatasets.moveDataset(index, index-1); if (window.renderDatasetList) window.renderDatasetList(); } catch(e){} };

    // compare-related
    window.toggleCompareMode = window.toggleCompareMode || function() { try { if (window.toggleCompareMode) window.toggleCompareMode(); } catch(e){} };
    window.setDatasetSide = window.setDatasetSide || function(datasetId, side) { try { if (window.setDatasetSide) window.setDatasetSide(datasetId, side); } catch(e){} };
})();
