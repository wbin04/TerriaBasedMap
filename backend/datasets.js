// Dataset management (non-UI): add, remove, opacity, layer toggles, ordering
(function(){
    'use strict';
    
    // Always use window.datasets as the single source of truth
    function getDatasets() { return window.datasets || []; }

    function setDatasets(arr) { window.datasets = arr || []; }

    function addDatasetToViewer(id, type, dataSource, model = null, position = null, name = null) {
        const viewer = window.viewer;
        const datasets = getDatasets(); // Get current datasets
        let existing = datasets.find(d => d.id === id && d.source === 'backend');
        let layers = [];
        if (dataSource) {
            const entities = dataSource.entities.values;
            const layerSet = new Set();
            entities.forEach(entity => {
                if (entity.properties && entity.properties.Layer) layerSet.add(entity.properties.Layer.getValue());
            });
            layers = Array.from(layerSet).map(layerName => ({ name: layerName, visible: true, color: '#3498db' }));
        }
        if (existing) {
            existing.name = name || existing.name || `Dataset ${id}`;
            existing.type = type || existing.type;
            existing.dataSource = dataSource;
            existing.model = model;
            existing.position = position;
            existing.visible = typeof existing.visible === 'boolean' ? existing.visible : true;
            existing.opacity = typeof existing.opacity === 'number' ? existing.opacity : 0.7;
            existing.layers = layers;
            applyDatasetOpacityToEntities(existing);
        } else {
            window.datasets.push({ id, source: 'backend', name: name || `Dataset ${id}`, type, dataSource, model, position, visible: true, opacity: 0.7, layers });
            applyDatasetOpacityToEntities(window.datasets[window.datasets.length - 1]);
        }
        if (dataSource) cacheEntitiesOriginalAppearance(dataSource);
        updateDataSourceZOrder();
        
        // Always render dataset list to show new dataset in UI
        if (window.renderDatasetList) {
            window.renderDatasetList();
        }
        
        // If compare mode is active, auto-assign new dataset to BOTH sides
        if (window.backendCompare && window.backendCompare.isCompareMode && window.backendCompare.isCompareMode()) {
            console.log(`Compare mode is active, auto-assigning dataset ${id} to BOTH sides`);
            if (window.leftDatasets) window.leftDatasets.add(id);
            if (window.rightDatasets) window.rightDatasets.add(id);
            // Update compare mode datasources to show the new dataset
            if (window.backendCompare.updateCompareModeDataSources) {
                window.backendCompare.updateCompareModeDataSources();
            }
            // Re-render UI again to show B button as active
            if (window.renderDatasetList) window.renderDatasetList();
        }
    }

    async function deleteDataset(id, source) {
        const datasets = getDatasets(); // Get current datasets
        const normalizedId = source === 'backend' ? parseInt(id) : id;
        console.log(`deleteDataset called: id=${id} (${typeof id}), source=${source}, normalizedId=${normalizedId} (${typeof normalizedId})`);
        console.log(`Current datasets:`, datasets.map(d => `${d.id} (${typeof d.id}) - source:${d.source}`));
        
        const idx = datasets.findIndex(d => d.id === normalizedId && d.source === source);
        if (idx === -1) {
            console.warn(`deleteDataset: Dataset not found - id=${id}, source=${source}`);
            console.warn(`  Looking for: id=${normalizedId} (${typeof normalizedId}), source=${source}`);
            console.warn(`  Available datasets:`, datasets.map(d => ({ id: d.id, source: d.source, name: d.name })));
            return;
        }
        const ds = datasets[idx];
        
        console.log(`deleteDataset: id=${id}, source=${source}, type=${ds.type}`);
        
        // Delete from backend server if source is 'backend'
        if (source === 'backend') {
            try {
                console.log(`  Deleting from server: /api/datasets/${normalizedId}`);
                const response = await fetch(`http://localhost:8000/api/datasets/${normalizedId}`, { 
                    method: 'DELETE' 
                });
                if (!response.ok) {
                    console.error(`  Server delete failed: ${response.status} ${response.statusText}`);
                    alert(`Failed to delete dataset from server: ${response.statusText}`);
                    return;
                }
                console.log(`  Successfully deleted from server`);
            } catch (error) {
                console.error(`  Server delete error:`, error);
                alert(`Failed to delete dataset from server: ${error.message}`);
                return;
            }
        }
        
        // Handle DVHC special case BEFORE removing from array
        if (ds.id === 'DVHC' && window.switchToNormalMode) {
            console.log(`  DVHC deletion: calling switchToNormalMode first`);
            window.switchToNormalMode();
        }
        
        // Remove from datasets array
        window.datasets.splice(idx, 1);
        
        // Remove dataSource from viewer
        if (ds.dataSource) {
            try { 
                ds.dataSource.show = false; 
                if (window.viewer.dataSources.contains(ds.dataSource)) {
                    window.viewer.dataSources.remove(ds.dataSource, true); 
                    console.log(`  Removed dataSource from viewer`);
                }
            } catch (e) {
                console.error(`  Failed to remove dataSource:`, e);
            }
        }
        
        // Remove model from viewer
        if (ds.model) {
            try { 
                window.viewer.scene.primitives.remove(ds.model); 
                console.log(`  Removed model from viewer`);
            } catch (e) {}
        }
        
        // Remove 3D Tilesets from viewer
        if (ds.tilesets && Array.isArray(ds.tilesets)) {
            ds.tilesets.forEach((tileset, idx) => {
                if (!tileset) return;
                try {
                    if (window.viewer.scene.primitives.contains(tileset)) {
                        window.viewer.scene.primitives.remove(tileset);
                        console.log(`  Removed tilesets[${idx}] from viewer`);
                    }
                    // Destroy to free memory
                    tileset.destroy();
                } catch (e) {
                    console.error(`  Failed to remove tileset ${idx}:`, e);
                }
            });
        }
        
        // Clean up compare mode clones/tilesets
        if (ds._leftClone) {
            try {
                if (window.leftViewer && window.leftViewer.dataSources.contains(ds._leftClone)) {
                    window.leftViewer.dataSources.remove(ds._leftClone, true);
                    console.log(`  Removed _leftClone from leftViewer`);
                }
            } catch (e) {}
            ds._leftClone = null;
        }
        
        if (ds._rightClone) {
            try {
                if (window.rightViewer && window.rightViewer.dataSources.contains(ds._rightClone)) {
                    window.rightViewer.dataSources.remove(ds._rightClone, true);
                    console.log(`  Removed _rightClone from rightViewer`);
                }
            } catch (e) {}
            ds._rightClone = null;
        }
        
        if (ds._leftTilesets && Array.isArray(ds._leftTilesets)) {
            ds._leftTilesets.forEach((tileset, idx) => {
                if (!tileset) return;
                try {
                    if (window.leftViewer && window.leftViewer.scene.primitives.contains(tileset)) {
                        window.leftViewer.scene.primitives.remove(tileset);
                    }
                    tileset.destroy();
                    console.log(`  Removed and destroyed _leftTilesets[${idx}]`);
                } catch (e) {}
            });
            ds._leftTilesets = null;
        }
        
        if (ds._rightTilesets && Array.isArray(ds._rightTilesets)) {
            ds._rightTilesets.forEach((tileset, idx) => {
                if (!tileset) return;
                try {
                    if (window.rightViewer && window.rightViewer.scene.primitives.contains(tileset)) {
                        window.rightViewer.scene.primitives.remove(tileset);
                    }
                    tileset.destroy();
                    console.log(`  Removed and destroyed _rightTilesets[${idx}]`);
                } catch (e) {}
            });
            ds._rightTilesets = null;
        }
        
        // Update UI to remove dataset from list
        if (window.renderDatasetList) {
            window.renderDatasetList();
        }
        
        // Request render to update map
        if (window.viewer) {
            window.viewer.scene.requestRender();
        }
        
        console.log(`  Dataset ${id} deleted successfully`);
    }

    function moveDataset(fromIndex, toIndex) {
        if (fromIndex === toIndex) return;
        const datasets = getDatasets();
        const [moved] = datasets.splice(fromIndex, 1);
        datasets.splice(toIndex, 0, moved);
        updateDataSourceZOrder();
    }

    function updateDataSourceZOrder() {
        const viewer = window.viewer;
        if (!viewer) return;
        const datasets = getDatasets();
        datasets.forEach(dataset => {
            if (dataset.dataSource) {
                try { if (!viewer.dataSources.contains(dataset.dataSource)) viewer.dataSources.add(dataset.dataSource); } catch (e) {}
                dataset.dataSource.show = !!dataset.visible;
            }
        });
        const ordered = [];
        for (let i = 0; i < datasets.length; i++) {
            const d = datasets[i];
            if (d.dataSource && d.visible && viewer.dataSources.contains(d.dataSource)) ordered.push(d.dataSource);
        }
        ordered.forEach(ds => { try { if (viewer.dataSources.contains(ds)) viewer.dataSources.remove(ds, false); } catch (e) {} });
        for (let i = 0; i < ordered.length; i++) { try { viewer.dataSources.add(ordered[i]); } catch (e) {} }
        viewer.scene.requestRender();
    }

    function cacheEntitiesOriginalAppearance(dataSource) {
        try {
            const now = Cesium.JulianDate.now();
            const entities = dataSource.entities.values;
            for (let i = 0; i < entities.length; i++) {
                const e = entities[i];
                if (e._cachedOriginalAppearance) continue;
                const ap = {};
                if (e.point) {
                    try { const color = e.point.color?.getValue(now); ap.point = { color: color ? color.clone() : null, pixelSize: e.point.pixelSize?.getValue(now) ?? null, outlineColor: e.point.outlineColor?.getValue(now)?.clone?.() ?? null, outlineWidth: e.point.outlineWidth?.getValue(now) ?? null }; } catch (err) { ap.point = null; }
                }
                if (e.polyline) { try { const matColor = e.polyline.material?.color?.getValue(now); ap.polyline = { materialColor: matColor ? matColor.clone() : null, width: e.polyline.width?.getValue(now) ?? null }; } catch (err) { ap.polyline = null; } }
                if (e.polygon) { try { const matColor = e.polygon.material?.color?.getValue(now); ap.polygon = { materialColor: matColor ? matColor.clone() : null, outlineColor: e.polygon.outlineColor?.getValue(now)?.clone?.() ?? null, outlineWidth: e.polygon.outlineWidth?.getValue(now) ?? null }; } catch (err) { ap.polygon = null; } }
                e._cachedOriginalAppearance = ap;
            }
        } catch (e) { console.warn('Failed to cache entity appearances:', e); }
    }

    function applyDatasetOpacityToEntities(dataset) {
        if (!dataset || !dataset.dataSource) return;
        const entities = dataset.dataSource.entities.values || [];
        entities.forEach(entity => {
            try {
                if (entity.polygon?.material instanceof Cesium.ColorMaterialProperty) { const color = entity.polygon.material.color.getValue(); entity.polygon.material = new Cesium.ColorMaterialProperty(color.withAlpha(dataset.opacity)); }
                if (entity.polyline?.material instanceof Cesium.ColorMaterialProperty) { const color = entity.polyline.material.color.getValue(); entity.polyline.material = new Cesium.ColorMaterialProperty(color.withAlpha(dataset.opacity)); }
                if (entity.point) { const color = entity.point.color.getValue(); entity.point.color = new Cesium.ConstantProperty(color.withAlpha(dataset.opacity)); }
            } catch (e) {}
        });
    }

    // Expose API
    window.backendDatasets = window.backendDatasets || {};
    window.backendDatasets.getDatasets = getDatasets;
    window.backendDatasets.setDatasets = setDatasets;
    window.backendDatasets.addDatasetToViewer = addDatasetToViewer;
    window.backendDatasets.deleteDataset = deleteDataset;
    window.backendDatasets.moveDataset = moveDataset;
    window.backendDatasets.updateDataSourceZOrder = updateDataSourceZOrder;
    window.backendDatasets.cacheEntitiesOriginalAppearance = cacheEntitiesOriginalAppearance;
    window.backendDatasets.applyDatasetOpacityToEntities = applyDatasetOpacityToEntities;
})();
