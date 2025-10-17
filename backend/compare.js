// Compare mode: dual/overlay viewers, clones, slider
(function(){
    'use strict';
    let leftViewer = null, rightViewer = null, bothViewer = null, compareMode = false, compareSliderInitialized = false;
    const leftDatasets = new Set(), rightDatasets = new Set();

    function ensureCompareDOM() {
        const mainContainer = document.getElementById('cesiumContainer'); if (!mainContainer) return null;
        const parent = mainContainer.parentElement || document.body;
        let viewerContainer = document.getElementById('viewerContainer');
        if (!viewerContainer) {
            viewerContainer = document.createElement('div'); viewerContainer.id = 'viewerContainer'; parent.insertBefore(viewerContainer, mainContainer.nextSibling);
            viewerContainer.style.position = 'absolute'; viewerContainer.style.top = '0'; viewerContainer.style.left = '0'; viewerContainer.style.width = '100%'; viewerContainer.style.height = '100vh'; viewerContainer.style.zIndex = '997'; viewerContainer.style.display = 'none'; viewerContainer.style.pointerEvents = 'none';
        }
        let leftContainer = document.getElementById('leftContainer'); if (!leftContainer) { leftContainer = document.createElement('div'); leftContainer.id = 'leftContainer'; viewerContainer.appendChild(leftContainer); leftContainer.style.position = 'absolute'; leftContainer.style.top='0'; leftContainer.style.left='0'; leftContainer.style.width='100%'; leftContainer.style.height='100%'; leftContainer.style.zIndex='999'; leftContainer.style.pointerEvents='none'; leftContainer.style.overflow='hidden'; }
        let rightContainer = document.getElementById('rightContainer'); if (!rightContainer) { rightContainer = document.createElement('div'); rightContainer.id = 'rightContainer'; viewerContainer.appendChild(rightContainer); rightContainer.style.position='absolute'; rightContainer.style.top='0'; rightContainer.style.left='0'; rightContainer.style.width='100%'; rightContainer.style.height='100%'; rightContainer.style.zIndex='998'; rightContainer.style.pointerEvents='none'; rightContainer.style.overflow='hidden'; }
        let leftViewerDiv = document.getElementById('leftViewer'); if (!leftViewerDiv) { leftViewerDiv = document.createElement('div'); leftViewerDiv.id='leftViewer'; leftContainer.appendChild(leftViewerDiv); leftViewerDiv.style.width='100%'; leftViewerDiv.style.height='100%'; }
        let rightViewerDiv = document.getElementById('rightViewer'); if (!rightViewerDiv) { rightViewerDiv = document.createElement('div'); rightViewerDiv.id='rightViewer'; rightContainer.appendChild(rightViewerDiv); rightViewerDiv.style.width='100%'; rightViewerDiv.style.height='100%'; }
        let bothContainer = document.getElementById('bothContainer'); if (!bothContainer) { bothContainer = document.createElement('div'); bothContainer.id='bothContainer'; viewerContainer.insertBefore(bothContainer, viewerContainer.firstChild); bothContainer.style.position='absolute'; bothContainer.style.top='0'; bothContainer.style.left='0'; bothContainer.style.width='100%'; bothContainer.style.height='100%'; bothContainer.style.zIndex='996'; bothContainer.style.pointerEvents='none'; bothContainer.style.overflow='hidden'; }
        let bothViewerDiv = document.getElementById('bothViewer'); if (!bothViewerDiv) { bothViewerDiv = document.createElement('div'); bothViewerDiv.id='bothViewer'; bothContainer.appendChild(bothViewerDiv); bothViewerDiv.style.width='100%'; bothViewerDiv.style.height='100%'; }
        let slider = document.getElementById('compareSlider'); if (!slider) { slider = document.createElement('div'); slider.id='compareSlider'; const handle = document.createElement('div'); handle.id='compareHandle'; slider.appendChild(handle); viewerContainer.appendChild(slider); slider.style.position='absolute'; slider.style.top='0'; slider.style.left='50%'; slider.style.height='100%'; slider.style.zIndex='1000'; slider.style.display='none'; slider.style.pointerEvents='auto'; handle.style.pointerEvents='auto'; }
        return { viewerContainer, leftContainer, rightContainer, bothViewerDiv, leftViewerDiv, rightViewerDiv, slider };
    }

    function cloneDataSource(original, cloneSuffix) {
        if (!original) return null;
        try {
            const now = Cesium.JulianDate.now();
            const clone = new Cesium.CustomDataSource((original.name || 'DataSource') + (cloneSuffix ? ' ' + cloneSuffix : ' (clone)'));
            original.entities.values.forEach(e => {
                const ent = { name: e.name };
                try { if (e.position) ent.position = e.position.getValue(now); } catch(e){}
                if (e.point) { ent.point = {}; try { const color = e.point.color?.getValue(now); if (color) ent.point.color = new Cesium.ConstantProperty(color.clone()); } catch(e){} try { const px = e.point.pixelSize?.getValue(now); if (px !== undefined) ent.point.pixelSize = new Cesium.ConstantProperty(px); } catch(e){} }
                if (e.polyline) { ent.polyline = {}; try { const positions = e.polyline.positions?.getValue(now); if (positions) ent.polyline.positions = new Cesium.ConstantProperty(positions.slice()); } catch(e){} try { const width = e.polyline.width?.getValue(now); if (width !== undefined) ent.polyline.width = new Cesium.ConstantProperty(width); } catch(e){} try { const matColor = e.polyline.material?.color?.getValue(now); if (matColor) ent.polyline.material = new Cesium.ColorMaterialProperty(matColor.clone()); } catch(e){} }
                if (e.polygon) { ent.polygon = {}; try { const hierarchy = e.polygon.hierarchy?.getValue(now); const positions = hierarchy?.positions || hierarchy; if (positions) ent.polygon.hierarchy = new Cesium.ConstantProperty(new Cesium.PolygonHierarchy(positions.slice())); } catch(e){} try { const matColor = e.polygon.material?.color?.getValue(now); if (matColor) ent.polygon.material = new Cesium.ColorMaterialProperty(matColor.clone()); } catch(e){} try { const outline = e.polygon.outline?.getValue ? e.polygon.outline.getValue(now) : e.polygon.outline; if (outline !== undefined) ent.polygon.outline = outline; } catch(e){} }
                try { clone.entities.add(ent); } catch(e){}
            });
            return clone;
        } catch (e) { console.warn('Failed to clone DataSource:', e); return null; }
    }

    function syncImageryLayers(srcViewer, dstViewer) {
        try {
            if (!srcViewer || !dstViewer) return;
            const src = srcViewer.imageryLayers; const dst = dstViewer.imageryLayers; try { dst.removeAll(); } catch(e){}
            for (let i = 0; i < src.length; i++) {
                try { const srcLayer = src.get(i); const provider = srcLayer && srcLayer.imageryProvider ? srcLayer.imageryProvider : null; if (!provider) continue; const newLayer = dst.addImageryProvider(provider); if (typeof srcLayer.show !== 'undefined') newLayer.show = srcLayer.show; if (typeof srcLayer.alpha !== 'undefined') newLayer.alpha = srcLayer.alpha; if (typeof srcLayer.brightness !== 'undefined') newLayer.brightness = srcLayer.brightness; if (typeof srcLayer.contrast !== 'undefined') newLayer.contrast = srcLayer.contrast; } catch(e) { console.warn('syncImageryLayers: failed to copy a layer', e); }
            }
        } catch (e) { console.warn('syncImageryLayers failed:', e); }
    }

    function syncOverlayDataSourceOrder(overlayViewer) {
        try {
            if (!overlayViewer) return;
            const dsList = [];
            for (let i = 0; i < (window.datasets || []).length; i++) {
                const dataset = window.datasets[i]; let candidate = null;
                if (overlayViewer === leftViewer) { if (dataset._leftClone && overlayViewer.dataSources.contains(dataset._leftClone)) candidate = dataset._leftClone; else if (dataset.dataSource && overlayViewer.dataSources.contains(dataset.dataSource)) candidate = dataset.dataSource; }
                else if (overlayViewer === rightViewer) { if (dataset._rightClone && overlayViewer.dataSources.contains(dataset._rightClone)) candidate = dataset._rightClone; else if (dataset.dataSource && overlayViewer.dataSources.contains(dataset.dataSource)) candidate = dataset.dataSource; }
                else { if (dataset._leftClone && overlayViewer.dataSources.contains(dataset._leftClone)) candidate = dataset._leftClone; else if (dataset._rightClone && overlayViewer.dataSources.contains(dataset._rightClone)) candidate = dataset._rightClone; else if (dataset.dataSource && overlayViewer.dataSources.contains(dataset.dataSource)) candidate = dataset.dataSource; }
                if (candidate) dsList.push(candidate);
            }
            for (const ds of dsList) { try { if (overlayViewer.dataSources.contains(ds)) overlayViewer.dataSources.remove(ds, false); } catch (e) {} }
            for (let i = dsList.length - 1; i >= 0; i--) { const ds = dsList[i]; try { overlayViewer.dataSources.add(ds); } catch (e) { console.warn('syncOverlayDataSourceOrder: add failed', e); } }
        } catch (e) { console.warn('syncOverlayDataSourceOrder failed:', e); }
    }

    function updateCompareModeDataSources() {
        if (!compareMode) { (window.datasets || []).forEach(dataset => { if (dataset._leftClone) try { dataset._leftClone.show = false; } catch(e){} if (dataset._rightClone) try { dataset._rightClone.show = false; } catch(e){} if (dataset.dataSource) try { if (!window.viewer.dataSources.contains(dataset.dataSource)) window.viewer.dataSources.add(dataset.dataSource); } catch(e){} if (dataset.dataSource) dataset.dataSource.show = !!dataset.visible; }); window.viewer.scene.requestRender(); return; }
        if (!leftViewer || !rightViewer) return;
        (window.datasets || []).forEach(dataset => {
            const id = dataset.id; const wantLeft = leftDatasets.has(id); const wantRight = rightDatasets.has(id); if (!dataset.dataSource) return; if ((wantLeft || wantRight) && dataset.dataSource) { try { dataset.dataSource.show = false; } catch(e){} }
            const wantBoth = wantLeft && wantRight;
            if (wantBoth) {
                if (!dataset._leftClone) { dataset._leftClone = cloneDataSource(dataset.dataSource, '(L)'); try { if (dataset._leftClone && leftViewer && !leftViewer.dataSources.contains(dataset._leftClone)) leftViewer.dataSources.add(dataset._leftClone); } catch(e){} }
                else { try { if (leftViewer && !leftViewer.dataSources.contains(dataset._leftClone)) leftViewer.dataSources.add(dataset._leftClone); } catch(e){} }
                if (!dataset._rightClone) { dataset._rightClone = cloneDataSource(dataset.dataSource, '(R)'); try { if (dataset._rightClone && rightViewer && !rightViewer.dataSources.contains(dataset._rightClone)) rightViewer.dataSources.add(dataset._rightClone); } catch(e){} }
                else { try { if (rightViewer && !rightViewer.dataSources.contains(dataset._rightClone)) rightViewer.dataSources.add(dataset._rightClone); } catch(e){} }
                if (dataset._leftClone) dataset._leftClone.show = !!dataset.visible; if (dataset._rightClone) dataset._rightClone.show = !!dataset.visible;
            } else {
                if (wantLeft) { if (!dataset._leftClone) { dataset._leftClone = cloneDataSource(dataset.dataSource, '(L)'); try { if (dataset._leftClone && leftViewer && !leftViewer.dataSources.contains(dataset._leftClone)) leftViewer.dataSources.add(dataset._leftClone); } catch(e){} } else { try { if (leftViewer && !leftViewer.dataSources.contains(dataset._leftClone)) leftViewer.dataSources.add(dataset._leftClone); } catch(e){} } if (dataset._leftClone) dataset._leftClone.show = !!dataset.visible; } else { if (dataset._leftClone) dataset._leftClone.show = false; }
                if (wantRight) { if (!dataset._rightClone) { dataset._rightClone = cloneDataSource(dataset.dataSource, '(R)'); try { if (dataset._rightClone && rightViewer && !rightViewer.dataSources.contains(dataset._rightClone)) rightViewer.dataSources.add(dataset._rightClone); } catch(e){} } else { try { if (rightViewer && !rightViewer.dataSources.contains(dataset._rightClone)) rightViewer.dataSources.add(dataset._rightClone); } catch(e){} } if (dataset._rightClone) dataset._rightClone.show = !!dataset.visible; } else { if (dataset._rightClone) dataset._rightClone.show = false; }
            }
            if (!wantLeft && !wantRight) { try { if (dataset.dataSource && !window.viewer.dataSources.contains(dataset.dataSource)) window.viewer.dataSources.add(dataset.dataSource); } catch(e){} if (dataset.dataSource) dataset.dataSource.show = !!dataset.visible; }
        });
        window.viewer.scene.requestRender(); try { syncOverlayDataSourceOrder(leftViewer); } catch(e){} try { syncOverlayDataSourceOrder(rightViewer); } catch(e){}
    }

    function initCompareSlider() {
        ensureCompareDOM(); const slider = document.getElementById('compareSlider'); const handle = document.getElementById('compareHandle'); const leftContainer = document.getElementById('leftContainer'); const rightContainer = document.getElementById('rightContainer'); if (!slider || !handle || !leftContainer || !rightContainer) return; let isDragging=false; handle.addEventListener('mousedown', (e)=>{ isDragging=true; e.preventDefault(); }); handle.addEventListener('touchstart', (e)=>{ isDragging=true; e.preventDefault(); }); function moveHandler(clientX){ if(!compareMode) return; const container = document.getElementById('viewerContainer'); if (!container) return; const rect = container.getBoundingClientRect(); const x = clientX - rect.left; const position = Math.max(0, Math.min(1, x/rect.width)); slider.style.left = `${position*100}%`; leftContainer.style.clipPath = `inset(0 ${(1-position)*100}% 0 0)`; rightContainer.style.clipPath = `inset(0 0 0 ${position*100}%)`; leftContainer.style.pointerEvents = 'auto'; rightContainer.style.pointerEvents = 'none'; }
        document.addEventListener('mousemove', (e)=>{ if(!isDragging) return; moveHandler(e.clientX); }); document.addEventListener('touchmove', (e)=>{ if(!isDragging||!e.touches||e.touches.length===0) return; moveHandler(e.touches[0].clientX); }, { passive:false }); document.addEventListener('mouseup', ()=>{ isDragging=false; }); document.addEventListener('touchend', ()=>{ isDragging=false; });
    }

    function toggleCompareMode() {
        compareMode = !compareMode;
        const btn = document.getElementById('compareModeBtn'); const mainContainer = document.getElementById('cesiumContainer'); let dom = null;
        if (compareMode) dom = ensureCompareDOM(); else dom = { viewerContainer: document.getElementById('viewerContainer'), leftContainer: document.getElementById('leftContainer'), rightContainer: document.getElementById('rightContainer'), leftViewerDiv: document.getElementById('leftViewer'), rightViewerDiv: document.getElementById('rightViewer'), slider: document.getElementById('compareSlider') };
        const { viewerContainer, leftContainer, rightContainer, bothViewerDiv, leftViewerDiv, rightViewerDiv, slider } = dom || {};
        if (compareMode) {
            if (btn) { btn.classList.add('active'); btn.setAttribute('aria-pressed','true'); }
            if (slider) { slider.style.display='block'; slider.classList.add('active'); }
            if (viewerContainer) { viewerContainer.style.display='block'; viewerContainer.style.pointerEvents='auto'; }
            if (!leftViewer) { leftViewer = new Cesium.Viewer(leftViewerDiv, { terrainProvider: Cesium.CesiumTerrainProvider(), baseLayerPicker:false, geocoder:false, homeButton:false, sceneModePicker:false, navigationHelpButton:false, animation:false, timeline:false, fullscreenButton:false }); leftViewer.camera.moveEnd.addEventListener(()=>{ if (leftViewer) {/* sync elsewhere */} }); try { syncImageryLayers(window.viewer, leftViewer); } catch(e){} }
            if (!rightViewer) { rightViewer = new Cesium.Viewer(rightViewerDiv, { terrainProvider: Cesium.CesiumTerrainProvider(), baseLayerPicker:false, geocoder:false, homeButton:false, sceneModePicker:false, navigationHelpButton:false, animation:false, timeline:false, fullscreenButton:false }); rightViewer.camera.moveEnd.addEventListener(()=>{}); try { syncImageryLayers(window.viewer, rightViewer); } catch(e){} }
            if (!bothViewer) { bothViewer = new Cesium.Viewer(bothViewerDiv, { terrainProvider: Cesium.CesiumTerrainProvider(), baseLayerPicker:false, geocoder:false, homeButton:false, sceneModePicker:false, navigationHelpButton:false, animation:false, timeline:false, fullscreenButton:false }); bothViewer.camera.moveEnd.addEventListener(()=>{}); try { syncImageryLayers(window.viewer, bothViewer); } catch(e){} }
            // sync cameras
            try { const pos = window.viewer.camera.position.clone(); const dir = window.viewer.camera.direction.clone(); const up = window.viewer.camera.up.clone(); leftViewer.camera.setView({ destination: pos, orientation: { direction: dir, up: up } }); rightViewer.camera.setView({ destination: pos, orientation: { direction: dir, up: up } }); if (bothViewer) bothViewer.camera.setView({ destination: pos, orientation: { direction: dir, up: up } }); } catch(e){}
            if (leftContainer) leftContainer.style.clipPath = `inset(0 50% 0 0)`; if (rightContainer) rightContainer.style.clipPath = `inset(0 0 0 50%)`; if (leftContainer) leftContainer.style.pointerEvents='auto'; if (rightContainer) rightContainer.style.pointerEvents='none';
            (window.datasets || []).filter(d=>d.visible&&d.dataSource).forEach(d=>{ leftDatasets.add(d.id); rightDatasets.add(d.id); });
            if (!compareSliderInitialized) { initCompareSlider(); compareSliderInitialized = true; }
        } else {
            if (btn) { btn.classList.remove('active'); btn.setAttribute('aria-pressed','false'); }
            if (slider) { slider.style.display='none'; slider.classList.remove('active'); }
            if (viewerContainer) { viewerContainer.style.display='none'; viewerContainer.style.pointerEvents='none'; }
            (window.datasets || []).forEach(dataset => { if (dataset.dataSource && dataset.visible) { try { if (leftViewer && leftViewer.dataSources.contains(dataset.dataSource)) leftViewer.dataSources.remove(dataset.dataSource, false); } catch(e){} try { if (rightViewer && rightViewer.dataSources.contains(dataset.dataSource)) rightViewer.dataSources.remove(dataset.dataSource, false); } catch(e){} try { if (bothViewer && bothViewer.dataSources.contains(dataset.dataSource)) bothViewer.dataSources.remove(dataset.dataSource, false); } catch(e){} if (!window.viewer.dataSources.contains(dataset.dataSource)) window.viewer.dataSources.add(dataset.dataSource); dataset.dataSource.show = true; } if (dataset._leftClone) { try { leftViewer?.dataSources.remove(dataset._leftClone, false); } catch(e){} dataset._leftClone = null; } if (dataset._rightClone) { try { rightViewer?.dataSources.remove(dataset._rightClone, false); } catch(e){} dataset._rightClone = null; } }); try { if (bothViewer) { bothViewer.destroy(); bothViewer = null; } } catch(e){}
            leftDatasets.clear(); rightDatasets.clear();
        }
    }

    function setDatasetSide(datasetId, side) {
        const ds = (window.datasets || []).find(d => String(d.id) === String(datasetId)); const id = ds ? ds.id : datasetId;
        if (side === 'left') { leftDatasets.add(id); rightDatasets.delete(id); } else if (side === 'right') { rightDatasets.add(id); leftDatasets.delete(id); } else if (side === 'both') { leftDatasets.add(id); rightDatasets.add(id); }
        updateCompareModeDataSources();
        // render list via frontend
        if (window.renderDatasetList) window.renderDatasetList();
    }

    // Expose
    window.toggleCompareMode = toggleCompareMode;
    window.setDatasetSide = setDatasetSide;
    window.backendCompare = { ensureCompareDOM, updateCompareModeDataSources };
})();
