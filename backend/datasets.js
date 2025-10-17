// Dataset management (non-UI): add, remove, opacity, layer toggles, ordering
(function(){
    'use strict';
    let datasets = [];

    function getDatasets() { return datasets; }

    function setDatasets(arr) { datasets = arr || []; window.datasets = datasets; }

    function addDatasetToViewer(id, type, dataSource, model = null, position = null, name = null) {
        const viewer = window.viewer;
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
            datasets.push({ id, source: 'backend', name: name || `Dataset ${id}`, type, dataSource, model, position, visible: true, opacity: 0.7, layers });
            applyDatasetOpacityToEntities(datasets[datasets.length - 1]);
        }
        window.datasets = datasets;
        if (dataSource) cacheEntitiesOriginalAppearance(dataSource);
        updateDataSourceZOrder();
    }

    function deleteDataset(id, source) {
        const normalizedId = source === 'backend' ? parseInt(id) : id;
        const idx = datasets.findIndex(d => d.id === normalizedId && d.source === source);
        if (idx === -1) return;
        const ds = datasets[idx];
        datasets.splice(idx, 1);
        if (ds.dataSource) {
            try { ds.dataSource.show = false; if (window.viewer.dataSources.contains(ds.dataSource)) window.viewer.dataSources.remove(ds.dataSource, true); } catch (e) {}
        }
        if (ds.model) try { window.viewer.scene.primitives.remove(ds.model); } catch (e) {}
        window.datasets = datasets;
        if (ds.id === 'DVHC' && window.switchToNormalMode) window.switchToNormalMode();
    }

    function moveDataset(fromIndex, toIndex) {
        if (fromIndex === toIndex) return;
        const [moved] = datasets.splice(fromIndex, 1);
        datasets.splice(toIndex, 0, moved);
        updateDataSourceZOrder();
    }

    function updateDataSourceZOrder() {
        const viewer = window.viewer;
        if (!viewer) return;
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
