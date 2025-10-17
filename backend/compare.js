// Compare mode: dual/overlay viewers, clones, slider
(function(){
    'use strict';
    let leftViewer = null, rightViewer = null, bothViewer = null, compareMode = false, compareSliderInitialized = false;
    const leftDatasets = new Set(), rightDatasets = new Set();
    
    // Expose compareMode state to global scope for access from other modules
    Object.defineProperty(window, 'compareMode', {
        get: function() { return compareMode; },
        set: function(value) { compareMode = value; }
    });
    
    // Expose viewers to global scope for cleanup operations
    Object.defineProperty(window, 'leftViewer', {
        get: function() { return leftViewer; }
    });
    Object.defineProperty(window, 'rightViewer', {
        get: function() { return rightViewer; }
    });
    
    // Expose dataset side assignments for toggle visibility access
    window.getCompareModeDatasets = function() {
        return { leftDatasets, rightDatasets };
    };

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
                if (e.polygon) { ent.polygon = {}; try { const hierarchy = e.polygon.hierarchy?.getValue(now); const positions = hierarchy?.positions || hierarchy; if (positions) ent.polygon.hierarchy = new Cesium.ConstantProperty(new Cesium.PolygonHierarchy(positions.slice())); } catch(e){} try { const matColor = e.polygon.material?.color?.getValue(now); if (matColor) ent.polygon.material = new Cesium.ColorMaterialProperty(matColor.clone()); } catch(e){} try { const outline = e.polygon.outline?.getValue ? e.polygon.outline.getValue(now) : e.polygon.outline; if (outline !== undefined) ent.polygon.outline = outline; } catch(e){} try { const outlineColor = e.polygon.outlineColor?.getValue(now); if (outlineColor) ent.polygon.outlineColor = new Cesium.ConstantProperty(outlineColor.clone()); } catch(e){} try { const outlineWidth = e.polygon.outlineWidth?.getValue(now); if (outlineWidth !== undefined) ent.polygon.outlineWidth = new Cesium.ConstantProperty(outlineWidth); } catch(e){} try { const heightRef = e.polygon.heightReference?.getValue ? e.polygon.heightReference.getValue(now) : e.polygon.heightReference; if (heightRef !== undefined) ent.polygon.heightReference = heightRef; } catch(e){} try { const classType = e.polygon.classificationType?.getValue ? e.polygon.classificationType.getValue(now) : e.polygon.classificationType; if (classType !== undefined) ent.polygon.classificationType = classType; } catch(e){} try { const zIdx = e.polygon.zIndex?.getValue ? e.polygon.zIndex.getValue(now) : e.polygon.zIndex; if (zIdx !== undefined) ent.polygon.zIndex = zIdx; } catch(e){} }
                try { clone.entities.add(ent); } catch(e){}
            });
            return clone;
        } catch (e) { console.warn('Failed to clone DataSource:', e); return null; }
    }

    function syncImageryLayers(srcViewer, dstViewer) {
        try {
            if (!srcViewer || !dstViewer) { console.warn('syncImageryLayers: missing viewer'); return; }
            const src = srcViewer.imageryLayers; 
            const dst = dstViewer.imageryLayers;
            
            // Remove all existing layers from destination
            try { 
                while (dst.length > 0) {
                    dst.remove(dst.get(0), false); 
                }
            } catch(e){ console.warn('Failed to remove default layers', e); }
            
            // Copy all layers from source in order
            for (let i = 0; i < src.length; i++) {
                try { 
                    const srcLayer = src.get(i); 
                    const provider = srcLayer && srcLayer.imageryProvider ? srcLayer.imageryProvider : null; 
                    if (!provider) continue; 
                    const newLayer = dst.addImageryProvider(provider); 
                    // Copy layer properties
                    if (typeof srcLayer.show !== 'undefined') newLayer.show = srcLayer.show; 
                    if (typeof srcLayer.alpha !== 'undefined') newLayer.alpha = srcLayer.alpha; 
                    if (typeof srcLayer.brightness !== 'undefined') newLayer.brightness = srcLayer.brightness; 
                    if (typeof srcLayer.contrast !== 'undefined') newLayer.contrast = srcLayer.contrast; 
                } catch(e) { console.warn('syncImageryLayers: failed to copy a layer', e); }
            }
            console.log(`Synced ${src.length} imagery layers to overlay viewer`);
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
        console.log('updateCompareModeDataSources called, compareMode:', compareMode);
        
        if (!compareMode) { 
            (window.datasets || []).forEach(dataset => { 
                // Handle DataSources
                if (dataset._leftClone) try { dataset._leftClone.show = false; } catch(e){} 
                if (dataset._rightClone) try { dataset._rightClone.show = false; } catch(e){} 
                if (dataset.dataSource) try { 
                    if (!window.viewer.dataSources.contains(dataset.dataSource)) window.viewer.dataSources.add(dataset.dataSource); 
                } catch(e){} 
                if (dataset.dataSource) dataset.dataSource.show = !!dataset.visible;
                
                // Handle 3D Tilesets - show original tilesets back in main viewer
                if (dataset.tilesets && Array.isArray(dataset.tilesets)) {
                    dataset.tilesets.forEach(tileset => {
                        if (tileset) {
                            tileset.show = !!dataset.visible;
                        }
                    });
                }
                
                // Hide left/right tilesets
                if (dataset._leftTilesets) {
                    dataset._leftTilesets.forEach(tileset => {
                        if (tileset) tileset.show = false;
                    });
                }
                if (dataset._rightTilesets) {
                    dataset._rightTilesets.forEach(tileset => {
                        if (tileset) tileset.show = false;
                    });
                }
            }); 
            window.viewer.scene.requestRender(); 
            return; 
        }
        
        if (!leftViewer || !rightViewer) { 
            console.warn('updateCompareModeDataSources: viewers not ready', {leftViewer, rightViewer}); 
            return; 
        }
        
        console.log('Processing datasets for compare mode...');
        (window.datasets || []).forEach(dataset => {
            const id = dataset.id; 
            const wantLeft = leftDatasets.has(id); 
            const wantRight = rightDatasets.has(id);
            const wantBoth = wantLeft && wantRight;
            
            // Handle DataSources (existing logic)
            if (dataset.dataSource) {
                console.log(`  Dataset ${id} (${dataset.name}): DataSource - wantLeft=${wantLeft}, wantRight=${wantRight}`);
                if ((wantLeft || wantRight)) { 
                    try { dataset.dataSource.show = false; } catch(e){} 
                }
                
                if (wantBoth) {
                    console.log(`    -> BOTH mode`);
                    if (!dataset._leftClone) { 
                        console.log(`    Creating left clone...`);
                        dataset._leftClone = cloneDataSource(dataset.dataSource, '(L)'); 
                        console.log(`    Left clone created:`, dataset._leftClone ? `${dataset._leftClone.entities.values.length} entities` : 'null');
                        try { if (dataset._leftClone && leftViewer && !leftViewer.dataSources.contains(dataset._leftClone)) leftViewer.dataSources.add(dataset._leftClone); } catch(e){ console.error('Failed to add left clone', e); } 
                    } else { 
                        try { if (leftViewer && !leftViewer.dataSources.contains(dataset._leftClone)) leftViewer.dataSources.add(dataset._leftClone); } catch(e){} 
                    }
                    if (!dataset._rightClone) { 
                        console.log(`    Creating right clone...`);
                        dataset._rightClone = cloneDataSource(dataset.dataSource, '(R)'); 
                        console.log(`    Right clone created:`, dataset._rightClone ? `${dataset._rightClone.entities.values.length} entities` : 'null');
                        try { if (dataset._rightClone && rightViewer && !rightViewer.dataSources.contains(dataset._rightClone)) rightViewer.dataSources.add(dataset._rightClone); } catch(e){ console.error('Failed to add right clone', e); } 
                    } else { 
                        try { if (rightViewer && !rightViewer.dataSources.contains(dataset._rightClone)) rightViewer.dataSources.add(dataset._rightClone); } catch(e){} 
                    }
                    if (dataset._leftClone) dataset._leftClone.show = !!dataset.visible; 
                    if (dataset._rightClone) dataset._rightClone.show = !!dataset.visible;
                } else {
                    if (wantLeft) { 
                        if (!dataset._leftClone) { 
                            dataset._leftClone = cloneDataSource(dataset.dataSource, '(L)'); 
                            try { if (dataset._leftClone && leftViewer && !leftViewer.dataSources.contains(dataset._leftClone)) leftViewer.dataSources.add(dataset._leftClone); } catch(e){} 
                        } else { 
                            try { if (leftViewer && !leftViewer.dataSources.contains(dataset._leftClone)) leftViewer.dataSources.add(dataset._leftClone); } catch(e){} 
                        } 
                        if (dataset._leftClone) dataset._leftClone.show = !!dataset.visible; 
                    } else { 
                        if (dataset._leftClone) dataset._leftClone.show = false; 
                    }
                    if (wantRight) { 
                        if (!dataset._rightClone) { 
                            dataset._rightClone = cloneDataSource(dataset.dataSource, '(R)'); 
                            try { if (dataset._rightClone && rightViewer && !rightViewer.dataSources.contains(dataset._rightClone)) rightViewer.dataSources.add(dataset._rightClone); } catch(e){} 
                        } else { 
                            try { if (rightViewer && !rightViewer.dataSources.contains(dataset._rightClone)) rightViewer.dataSources.add(dataset._rightClone); } catch(e){} 
                        } 
                        if (dataset._rightClone) dataset._rightClone.show = !!dataset.visible; 
                    } else { 
                        if (dataset._rightClone) dataset._rightClone.show = false; 
                    }
                }
                
                if (!wantLeft && !wantRight) { 
                    try { if (dataset.dataSource && !window.viewer.dataSources.contains(dataset.dataSource)) window.viewer.dataSources.add(dataset.dataSource); } catch(e){} 
                    if (dataset.dataSource) dataset.dataSource.show = !!dataset.visible; 
                }
            }
            
            // Handle 3D Tilesets (new logic for TREE datasets)
            if (dataset.tilesets && Array.isArray(dataset.tilesets)) {
                console.log(`  Dataset ${id} (${dataset.name}): Tilesets - wantLeft=${wantLeft}, wantRight=${wantRight}`);
                
                if (wantBoth) {
                    // For BOTH mode, load separate tilesets for each viewer
                    console.log(`    BOTH mode: Loading tilesets to LEFT and RIGHT viewers...`);
                    
                    // Hide original tilesets in main viewer (don't move them - causes issues)
                    dataset.tilesets.forEach((tileset, idx) => {
                        if (!tileset) return;
                        console.log(`      Hiding original tileset ${idx} in main viewer`);
                        tileset.show = false;
                    });
                    
                    // Check if this is a multi-tileset dataset (like TREES) or single tileset (like HATANG)
                    const isMultiTileset = dataset.districts && Array.isArray(dataset.districts);
                    
                    if (isMultiTileset) {
                        // Multi-tileset handling (TREES with multiple districts)
                        // Load new tilesets for left viewer (async)
                        if (!dataset._leftTilesets) {
                            console.log(`    Loading LEFT tilesets from URLs (multi-tileset)...`);
                            dataset._leftTilesets = [];
                            
                            (async () => {
                                for (const district of dataset.districts) {
                                    if (!district.tilesetUrl) continue;
                                    
                                    try {
                                        console.log(`      Loading left tileset for ${district.name} from ${district.tilesetUrl}`);
                                        const tileset = await Cesium.Cesium3DTileset.fromUrl(district.tilesetUrl, {
                                            skipLevelOfDetail: false,
                                            baseScreenSpaceError: 1024,
                                            skipScreenSpaceErrorFactor: 16,
                                            skipLevels: 1,
                                            immediatelyLoadDesiredLevelOfDetail: false,
                                            loadSiblings: false,
                                            cullWithChildrenBounds: true,
                                            maximumScreenSpaceError: 16,
                                            maximumMemoryUsage: 512
                                        });
                                        
                                        // Apply district color
                                        tileset.style = new Cesium.Cesium3DTileStyle({
                                            color: `color("${district.color}", 0.8)`,
                                            pointSize: 8
                                        });
                                        
                                        leftViewer.scene.primitives.add(tileset);
                                        tileset.show = !!dataset.visible;
                                        dataset._leftTilesets.push(tileset);
                                        
                                        console.log(`      ✓ Loaded left tileset for ${district.name}, visibility: ${tileset.show}`);
                                    } catch (error) {
                                        console.error(`      ✗ Failed to load left tileset for ${district.name}:`, error);
                                    }
                                }
                                console.log(`      LEFT viewer primitives count: ${leftViewer.scene.primitives.length}`);
                                leftViewer.scene.requestRender();
                            })();
                        } else {
                            // Already loaded, just show them
                            console.log(`    LEFT tilesets already loaded, showing ${dataset._leftTilesets.length} tilesets...`);
                            dataset._leftTilesets.forEach((tileset, idx) => {
                                if (tileset && !leftViewer.scene.primitives.contains(tileset)) {
                                    leftViewer.scene.primitives.add(tileset);
                                    console.log(`      Added left tileset ${idx} to left viewer`);
                                }
                                if (tileset) {
                                    tileset.show = !!dataset.visible;
                                    console.log(`      Left tileset ${idx} visibility: ${tileset.show}`);
                                }
                            });
                        }
                        
                        // Load new tilesets for right viewer (async)
                        if (!dataset._rightTilesets) {
                            console.log(`    Loading RIGHT tilesets from URLs (multi-tileset)...`);
                            dataset._rightTilesets = [];
                            
                            (async () => {
                                for (const district of dataset.districts) {
                                    if (!district.tilesetUrl) continue;
                                    
                                    try {
                                        console.log(`      Loading right tileset for ${district.name} from ${district.tilesetUrl}`);
                                        const tileset = await Cesium.Cesium3DTileset.fromUrl(district.tilesetUrl, {
                                            skipLevelOfDetail: false,
                                            baseScreenSpaceError: 1024,
                                            skipScreenSpaceErrorFactor: 16,
                                            skipLevels: 1,
                                            immediatelyLoadDesiredLevelOfDetail: false,
                                            loadSiblings: false,
                                            cullWithChildrenBounds: true,
                                            maximumScreenSpaceError: 16,
                                            maximumMemoryUsage: 512
                                        });
                                        
                                        // Apply district color
                                        tileset.style = new Cesium.Cesium3DTileStyle({
                                            color: `color("${district.color}", 0.8)`,
                                            pointSize: 8
                                        });
                                        
                                        rightViewer.scene.primitives.add(tileset);
                                        tileset.show = !!dataset.visible;
                                        dataset._rightTilesets.push(tileset);
                                        
                                        console.log(`      ✓ Loaded right tileset for ${district.name}, visibility: ${tileset.show}`);
                                    } catch (error) {
                                        console.error(`      ✗ Failed to load right tileset for ${district.name}:`, error);
                                    }
                                }
                                console.log(`      RIGHT viewer primitives count: ${rightViewer.scene.primitives.length}`);
                                rightViewer.scene.requestRender();
                            })();
                        } else {
                            // Already loaded, just show them
                            console.log(`    RIGHT tilesets already loaded, showing ${dataset._rightTilesets.length} tilesets...`);
                            dataset._rightTilesets.forEach((tileset, idx) => {
                                if (tileset && !rightViewer.scene.primitives.contains(tileset)) {
                                    rightViewer.scene.primitives.add(tileset);
                                    console.log(`      Added right tileset ${idx} to right viewer`);
                                }
                                if (tileset) {
                                    tileset.show = !!dataset.visible;
                                    console.log(`      Right tileset ${idx} visibility: ${tileset.show}`);
                                }
                            });
                        }
                    } else {
                        // Single tileset handling (HATANG or similar)
                        console.log(`    Single tileset mode: Loading from ${dataset.tilesetUrl}`);
                        
                        // Load left tileset
                        if (!dataset._leftTilesets && dataset.tilesetUrl) {
                            console.log(`    Loading LEFT tileset (single)...`);
                            dataset._leftTilesets = [];
                            
                            (async () => {
                                try {
                                    console.log(`      Loading left tileset from ${dataset.tilesetUrl}`);
                                    const tileset = await Cesium.Cesium3DTileset.fromUrl(dataset.tilesetUrl, {
                                        maximumScreenSpaceError: 16,
                                        maximumMemoryUsage: 512,
                                        cullWithChildrenBounds: true,
                                        skipLevelOfDetail: false,
                                        baseScreenSpaceError: 1024,
                                        skipScreenSpaceErrorFactor: 16,
                                        skipLevels: 1,
                                        immediatelyLoadDesiredLevelOfDetail: false,
                                        loadSiblings: false
                                    });
                                    
                                    tileset.style = new Cesium.Cesium3DTileStyle({
                                        show: true
                                    });
                                    
                                    leftViewer.scene.primitives.add(tileset);
                                    tileset.show = !!dataset.visible;
                                    dataset._leftTilesets.push(tileset);
                                    
                                    console.log(`      ✓ Loaded left tileset, visibility: ${tileset.show}`);
                                    leftViewer.scene.requestRender();
                                } catch (error) {
                                    console.error(`      ✗ Failed to load left tileset:`, error);
                                }
                            })();
                        } else if (dataset._leftTilesets) {
                            console.log(`    LEFT tileset already loaded, showing...`);
                            dataset._leftTilesets.forEach((tileset, idx) => {
                                if (tileset && !leftViewer.scene.primitives.contains(tileset)) {
                                    leftViewer.scene.primitives.add(tileset);
                                }
                                if (tileset) {
                                    tileset.show = !!dataset.visible;
                                }
                            });
                        }
                        
                        // Load right tileset
                        if (!dataset._rightTilesets && dataset.tilesetUrl) {
                            console.log(`    Loading RIGHT tileset (single)...`);
                            dataset._rightTilesets = [];
                            
                            (async () => {
                                try {
                                    console.log(`      Loading right tileset from ${dataset.tilesetUrl}`);
                                    const tileset = await Cesium.Cesium3DTileset.fromUrl(dataset.tilesetUrl, {
                                        maximumScreenSpaceError: 16,
                                        maximumMemoryUsage: 512,
                                        cullWithChildrenBounds: true,
                                        skipLevelOfDetail: false,
                                        baseScreenSpaceError: 1024,
                                        skipScreenSpaceErrorFactor: 16,
                                        skipLevels: 1,
                                        immediatelyLoadDesiredLevelOfDetail: false,
                                        loadSiblings: false
                                    });
                                    
                                    tileset.style = new Cesium.Cesium3DTileStyle({
                                        show: true
                                    });
                                    
                                    rightViewer.scene.primitives.add(tileset);
                                    tileset.show = !!dataset.visible;
                                    dataset._rightTilesets.push(tileset);
                                    
                                    console.log(`      ✓ Loaded right tileset, visibility: ${tileset.show}`);
                                    rightViewer.scene.requestRender();
                                } catch (error) {
                                    console.error(`      ✗ Failed to load right tileset:`, error);
                                }
                            })();
                        } else if (dataset._rightTilesets) {
                            console.log(`    RIGHT tileset already loaded, showing...`);
                            dataset._rightTilesets.forEach((tileset, idx) => {
                                if (tileset && !rightViewer.scene.primitives.contains(tileset)) {
                                    rightViewer.scene.primitives.add(tileset);
                                }
                                if (tileset) {
                                    tileset.show = !!dataset.visible;
                                }
                            });
                        }
                    }
                    
                } else if (wantLeft) {
                    // Show only in left viewer
                    console.log(`    LEFT mode: Showing tilesets in LEFT viewer only...`);
                    
                    // Hide original tilesets
                    dataset.tilesets.forEach(tileset => {
                        if (tileset) tileset.show = false;
                    });
                    
                    // Check if multi-tileset or single tileset
                    const isMultiTileset = dataset.districts && Array.isArray(dataset.districts) && dataset.districts.length > 1;
                    
                    if (isMultiTileset) {
                        // Multi-tileset dataset (TREES) - load from districts
                        if (!dataset._leftTilesets) {
                            console.log(`    Loading LEFT tilesets from URLs (multi-tileset)...`);
                            dataset._leftTilesets = [];
                        
                            (async () => {
                                for (const district of dataset.districts) {
                                    if (!district.tilesetUrl) continue;
                                
                                    try {
                                        console.log(`      Loading left tileset for ${district.name} from ${district.tilesetUrl}`);
                                        const tileset = await Cesium.Cesium3DTileset.fromUrl(district.tilesetUrl, {
                                            skipLevelOfDetail: false,
                                            baseScreenSpaceError: 1024,
                                            skipScreenSpaceErrorFactor: 16,
                                            skipLevels: 1,
                                            immediatelyLoadDesiredLevelOfDetail: false,
                                            loadSiblings: false,
                                            cullWithChildrenBounds: true,
                                            maximumScreenSpaceError: 16,
                                            maximumMemoryUsage: 512
                                        });
                                        
                                        tileset.style = new Cesium.Cesium3DTileStyle({
                                            color: `color("${district.color}", 0.8)`,
                                            pointSize: 8
                                        });
                                        
                                        leftViewer.scene.primitives.add(tileset);
                                        tileset.show = !!dataset.visible;
                                        dataset._leftTilesets.push(tileset);
                                        
                                        console.log(`      ✓ Loaded left tileset for ${district.name}, visibility: ${tileset.show}`);
                                    } catch (error) {
                                        console.error(`      ✗ Failed to load left tileset for ${district.name}:`, error);
                                    }
                                }
                                console.log(`      LEFT viewer primitives count: ${leftViewer.scene.primitives.length}`);
                                
                                leftViewer.scene.requestRender();
                            })();
                        } else if (dataset._leftTilesets) {
                            console.log(`    LEFT tilesets already loaded, showing ${dataset._leftTilesets.length} tilesets...`);
                            dataset._leftTilesets.forEach((tileset, idx) => {
                                if (tileset && !leftViewer.scene.primitives.contains(tileset)) {
                                    leftViewer.scene.primitives.add(tileset);
                                }
                                if (tileset) {
                                    tileset.show = !!dataset.visible;
                                }
                            });
                        }
                    } else {
                        // Single tileset dataset (HATANG) - load from tilesetUrl
                        const tilesetUrl = dataset.tilesetUrl || (dataset.districts && dataset.districts[0] && dataset.districts[0].tilesetUrl);
                        
                        if (!dataset._leftTilesets && tilesetUrl) {
                            console.log(`    Loading LEFT tileset from URL (single-tileset): ${tilesetUrl}`);
                            dataset._leftTilesets = [];
                            
                            (async () => {
                                try {
                                    const tileset = await Cesium.Cesium3DTileset.fromUrl(tilesetUrl, {
                                        skipLevelOfDetail: false,
                                        baseScreenSpaceError: 1024,
                                        skipScreenSpaceErrorFactor: 16,
                                        skipLevels: 1,
                                        immediatelyLoadDesiredLevelOfDetail: false,
                                        loadSiblings: false,
                                        cullWithChildrenBounds: true,
                                        maximumScreenSpaceError: 16,
                                        maximumMemoryUsage: 512
                                    });
                                    
                                    leftViewer.scene.primitives.add(tileset);
                                    tileset.show = !!dataset.visible;
                                    dataset._leftTilesets.push(tileset);
                                    
                                    console.log(`      ✓ Loaded left tileset, visibility: ${tileset.show}`);
                                    leftViewer.scene.requestRender();
                                } catch (error) {
                                    console.error(`      ✗ Failed to load left tileset:`, error);
                                }
                            })();
                        } else if (dataset._leftTilesets) {
                            console.log(`    LEFT tileset already loaded, showing...`);
                            dataset._leftTilesets.forEach((tileset, idx) => {
                                if (tileset && !leftViewer.scene.primitives.contains(tileset)) {
                                    leftViewer.scene.primitives.add(tileset);
                                }
                                if (tileset) {
                                    tileset.show = !!dataset.visible;
                                }
                            });
                        }
                    }
                    
                    // Hide right tilesets if they exist
                    if (dataset._rightTilesets) {
                        dataset._rightTilesets.forEach(tileset => {
                            if (tileset) tileset.show = false;
                        });
                    }
                    
                } else if (wantRight) {
                    // Show only in right viewer
                    console.log(`    RIGHT mode: Showing tilesets in RIGHT viewer only...`);
                    
                    // Hide original tilesets
                    dataset.tilesets.forEach(tileset => {
                        if (tileset) tileset.show = false;
                    });
                    
                    // Check if multi-tileset or single tileset
                    const isMultiTileset = dataset.districts && Array.isArray(dataset.districts) && dataset.districts.length > 1;
                    
                    if (isMultiTileset) {
                        // Multi-tileset dataset (TREES) - load from districts
                        if (!dataset._rightTilesets) {
                            console.log(`    Loading RIGHT tilesets from URLs (multi-tileset)...`);
                            dataset._rightTilesets = [];
                        
                            (async () => {
                                for (const district of dataset.districts) {
                                    if (!district.tilesetUrl) continue;
                                
                                    try {
                                        console.log(`      Loading right tileset for ${district.name} from ${district.tilesetUrl}`);
                                        const tileset = await Cesium.Cesium3DTileset.fromUrl(district.tilesetUrl, {
                                            skipLevelOfDetail: false,
                                            baseScreenSpaceError: 1024,
                                            skipScreenSpaceErrorFactor: 16,
                                            skipLevels: 1,
                                            immediatelyLoadDesiredLevelOfDetail: false,
                                            loadSiblings: false,
                                            cullWithChildrenBounds: true,
                                            maximumScreenSpaceError: 16,
                                            maximumMemoryUsage: 512
                                        });
                                        
                                        tileset.style = new Cesium.Cesium3DTileStyle({
                                            color: `color("${district.color}", 0.8)`,
                                            pointSize: 8
                                        });
                                        
                                        rightViewer.scene.primitives.add(tileset);
                                        tileset.show = !!dataset.visible;
                                        dataset._rightTilesets.push(tileset);
                                        
                                        console.log(`      ✓ Loaded right tileset for ${district.name}, visibility: ${tileset.show}`);
                                    } catch (error) {
                                        console.error(`      ✗ Failed to load right tileset for ${district.name}:`, error);
                                    }
                                }
                                console.log(`      RIGHT viewer primitives count: ${rightViewer.scene.primitives.length}`);
                                
                                rightViewer.scene.requestRender();
                            })();
                        } else if (dataset._rightTilesets) {
                            console.log(`    RIGHT tilesets already loaded, showing ${dataset._rightTilesets.length} tilesets...`);
                            dataset._rightTilesets.forEach((tileset, idx) => {
                                if (tileset && !rightViewer.scene.primitives.contains(tileset)) {
                                    rightViewer.scene.primitives.add(tileset);
                                }
                                if (tileset) {
                                    tileset.show = !!dataset.visible;
                                }
                            });
                        }
                    } else {
                        // Single tileset dataset (HATANG) - load from tilesetUrl
                        const tilesetUrl = dataset.tilesetUrl || (dataset.districts && dataset.districts[0] && dataset.districts[0].tilesetUrl);
                        
                        if (!dataset._rightTilesets && tilesetUrl) {
                            console.log(`    Loading RIGHT tileset from URL (single-tileset): ${tilesetUrl}`);
                            dataset._rightTilesets = [];
                            
                            (async () => {
                                try {
                                    const tileset = await Cesium.Cesium3DTileset.fromUrl(tilesetUrl, {
                                        skipLevelOfDetail: false,
                                        baseScreenSpaceError: 1024,
                                        skipScreenSpaceErrorFactor: 16,
                                        skipLevels: 1,
                                        immediatelyLoadDesiredLevelOfDetail: false,
                                        loadSiblings: false,
                                        cullWithChildrenBounds: true,
                                        maximumScreenSpaceError: 16,
                                        maximumMemoryUsage: 512
                                    });
                                    
                                    rightViewer.scene.primitives.add(tileset);
                                    tileset.show = !!dataset.visible;
                                    dataset._rightTilesets.push(tileset);
                                    
                                    console.log(`      ✓ Loaded right tileset, visibility: ${tileset.show}`);
                                    rightViewer.scene.requestRender();
                                } catch (error) {
                                    console.error(`      ✗ Failed to load right tileset:`, error);
                                }
                            })();
                        } else if (dataset._rightTilesets) {
                            console.log(`    RIGHT tileset already loaded, showing...`);
                            dataset._rightTilesets.forEach((tileset, idx) => {
                                if (tileset && !rightViewer.scene.primitives.contains(tileset)) {
                                    rightViewer.scene.primitives.add(tileset);
                                }
                                if (tileset) {
                                    tileset.show = !!dataset.visible;
                                }
                            });
                        }
                    }
                    
                    // Hide left tilesets if they exist
                    if (dataset._leftTilesets) {
                        dataset._leftTilesets.forEach(tileset => {
                            if (tileset) tileset.show = false;
                        });
                    }
                    
                } else {
                    // Show in main viewer only (not in compare mode or wantBoth)
                    console.log(`    Showing tilesets in MAIN viewer...`);
                    dataset.tilesets.forEach(tileset => {
                        if (tileset) tileset.show = !!dataset.visible;
                    });
                    
                    // Hide compare viewer tilesets
                    if (dataset._leftTilesets) {
                        dataset._leftTilesets.forEach(tileset => {
                            if (tileset) tileset.show = false;
                        });
                    }
                    if (dataset._rightTilesets) {
                        dataset._rightTilesets.forEach(tileset => {
                            if (tileset) tileset.show = false;
                        });
                    }
                }
            }
        });
        
        window.viewer.scene.requestRender(); 
        try { syncOverlayDataSourceOrder(leftViewer); } catch(e){} 
        try { syncOverlayDataSourceOrder(rightViewer); } catch(e){}
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
            if (!leftViewer) { 
                leftViewer = new Cesium.Viewer(leftViewerDiv, { 
                    terrainProvider: window.viewer.terrainProvider,
                    imageryProvider: false, // Don't add default imagery, we'll sync it
                    baseLayerPicker:false, geocoder:false, homeButton:false, 
                    sceneModePicker:false, navigationHelpButton:false, 
                    animation:false, timeline:false, fullscreenButton:false 
                }); 
                leftViewer.camera.moveEnd.addEventListener(()=>{ if (leftViewer) {/* sync elsewhere */} }); 
                try { syncImageryLayers(window.viewer, leftViewer); } catch(e){ console.warn('Failed to sync imagery to leftViewer', e); } 
            }
            if (!rightViewer) { 
                rightViewer = new Cesium.Viewer(rightViewerDiv, { 
                    terrainProvider: window.viewer.terrainProvider,
                    imageryProvider: false,
                    baseLayerPicker:false, geocoder:false, homeButton:false, 
                    sceneModePicker:false, navigationHelpButton:false, 
                    animation:false, timeline:false, fullscreenButton:false 
                }); 
                rightViewer.camera.moveEnd.addEventListener(()=>{}); 
                try { syncImageryLayers(window.viewer, rightViewer); } catch(e){ console.warn('Failed to sync imagery to rightViewer', e); } 
            }
            if (!bothViewer) { 
                bothViewer = new Cesium.Viewer(bothViewerDiv, { 
                    terrainProvider: window.viewer.terrainProvider,
                    imageryProvider: false,
                    baseLayerPicker:false, geocoder:false, homeButton:false, 
                    sceneModePicker:false, navigationHelpButton:false, 
                    animation:false, timeline:false, fullscreenButton:false 
                }); 
                bothViewer.camera.moveEnd.addEventListener(()=>{}); 
                try { syncImageryLayers(window.viewer, bothViewer); } catch(e){ console.warn('Failed to sync imagery to bothViewer', e); } 
            }
            // sync cameras
            try { 
                const pos = window.viewer.camera.position.clone(); 
                const dir = window.viewer.camera.direction.clone(); 
                const up = window.viewer.camera.up.clone(); 
                leftViewer.camera.setView({ destination: pos, orientation: { direction: dir, up: up } }); 
                rightViewer.camera.setView({ destination: pos, orientation: { direction: dir, up: up } }); 
                if (bothViewer) bothViewer.camera.setView({ destination: pos, orientation: { direction: dir, up: up } }); 
                console.log('Cameras synced to compare viewers');
            } catch(e){ console.error('Failed to sync cameras:', e); }
            
            // Set up camera sync listeners
            if (leftViewer && !leftViewer._compareCameraListener) {
                leftViewer._compareCameraListener = leftViewer.camera.moveEnd.addEventListener(() => {
                    if (compareMode && rightViewer) {
                        try {
                            const pos = leftViewer.camera.position.clone();
                            const dir = leftViewer.camera.direction.clone();
                            const up = leftViewer.camera.up.clone();
                            rightViewer.camera.setView({ destination: pos, orientation: { direction: dir, up: up } });
                        } catch(e) {}
                    }
                });
            }
            if (rightViewer && !rightViewer._compareCameraListener) {
                rightViewer._compareCameraListener = rightViewer.camera.moveEnd.addEventListener(() => {
                    if (compareMode && leftViewer) {
                        try {
                            const pos = rightViewer.camera.position.clone();
                            const dir = rightViewer.camera.direction.clone();
                            const up = rightViewer.camera.up.clone();
                            leftViewer.camera.setView({ destination: pos, orientation: { direction: dir, up: up } });
                        } catch(e) {}
                    }
                });
            }
            if (leftContainer) leftContainer.style.clipPath = `inset(0 50% 0 0)`; 
            if (rightContainer) rightContainer.style.clipPath = `inset(0 0 0 50%)`; 
            if (leftContainer) leftContainer.style.pointerEvents='auto'; 
            if (rightContainer) rightContainer.style.pointerEvents='none';
            
            console.log('Container setup:');
            console.log('  leftContainer clipPath:', leftContainer?.style.clipPath, 'z-index:', leftContainer?.style.zIndex);
            console.log('  rightContainer clipPath:', rightContainer?.style.clipPath, 'z-index:', rightContainer?.style.zIndex);
            console.log('  leftContainer pointerEvents:', leftContainer?.style.pointerEvents);
            console.log('  rightContainer pointerEvents:', rightContainer?.style.pointerEvents);
            
            // Auto-assign ALL visible datasets to BOTH sides (including tree datasets with tilesets)
            const allDatasets = (window.datasets || []).filter(d => d.visible);
            console.log(`Compare mode ON: assigning ${allDatasets.length} visible datasets to BOTH sides`);
            
            allDatasets.forEach(d=>{ 
                leftDatasets.add(d.id); 
                rightDatasets.add(d.id); 
                console.log(`  - Dataset ${d.id} (${d.name}) assigned to BOTH`);
            });
            
            // Auto-load datasets that don't have dataSource yet
            const datasetsWithoutDataSource = (window.datasets || []).filter(d=>!d.dataSource && d.source === 'backend');
            if (datasetsWithoutDataSource.length > 0) {
                console.log(`Auto-loading ${datasetsWithoutDataSource.length} datasets without dataSource...`);
                datasetsWithoutDataSource.forEach(async (d) => {
                    console.log(`  - Loading Dataset ${d.id} (${d.name})...`);
                    try {
                        if (window.loadFileFromServer && typeof window.loadFileFromServer === 'function') {
                            await window.loadFileFromServer(d.id, d.name);
                        }
                    } catch (e) {
                        console.error(`Failed to load dataset ${d.id}:`, e);
                    }
                });
            }
            
            console.log('leftDatasets:', Array.from(leftDatasets));
            console.log('rightDatasets:', Array.from(rightDatasets));
            
            // Update datasources for compare mode
            updateCompareModeDataSources();
            
            // Force render all viewers
            try {
                window.viewer.scene.requestRender();
                leftViewer.scene.requestRender();
                rightViewer.scene.requestRender();
                if (bothViewer) bothViewer.scene.requestRender();
                console.log('All viewers render requested');
            } catch(e) {
                console.error('Failed to request render:', e);
            }
            
            // Re-render dataset list to show B buttons as active
            if (window.renderDatasetList) {
                console.log('Calling renderDatasetList to update UI...');
                window.renderDatasetList();
            } else {
                console.warn('window.renderDatasetList not available!');
            }
            if (!compareSliderInitialized) { initCompareSlider(); compareSliderInitialized = true; }
        } else {
            if (btn) { btn.classList.remove('active'); btn.setAttribute('aria-pressed','false'); }
            if (slider) { slider.style.display='none'; slider.classList.remove('active'); }
            if (viewerContainer) { viewerContainer.style.display='none'; viewerContainer.style.pointerEvents='none'; }
            
            // Clear dataset assignments FIRST
            leftDatasets.clear(); 
            rightDatasets.clear();
            
            // Then update data sources to move everything back to main viewer
            updateCompareModeDataSources();
            
            // Cleanup clones and right tilesets
            (window.datasets || []).forEach(dataset => { 
                if (dataset._leftClone) { 
                    try { leftViewer?.dataSources.remove(dataset._leftClone, false); } catch(e){} 
                    dataset._leftClone = null; 
                } 
                if (dataset._rightClone) { 
                    try { rightViewer?.dataSources.remove(dataset._rightClone, false); } catch(e){} 
                    dataset._rightClone = null; 
                }
                
                // Cleanup left tilesets (loaded separately for compare mode)
                if (dataset._leftTilesets && Array.isArray(dataset._leftTilesets)) {
                    dataset._leftTilesets.forEach(tileset => {
                        if (tileset) {
                            try {
                                if (leftViewer && leftViewer.scene.primitives.contains(tileset)) {
                                    leftViewer.scene.primitives.remove(tileset);
                                }
                                // Destroy the tileset to free memory
                                tileset.destroy();
                            } catch(e) {
                                console.warn('Failed to cleanup left tileset:', e);
                            }
                        }
                    });
                    dataset._leftTilesets = null;
                }
                
                // Cleanup right tilesets (loaded separately for compare mode)
                if (dataset._rightTilesets && Array.isArray(dataset._rightTilesets)) {
                    dataset._rightTilesets.forEach(tileset => {
                        if (tileset) {
                            try {
                                if (rightViewer && rightViewer.scene.primitives.contains(tileset)) {
                                    rightViewer.scene.primitives.remove(tileset);
                                }
                                // Destroy the tileset to free memory
                                tileset.destroy();
                            } catch(e) {
                                console.warn('Failed to cleanup right tileset:', e);
                            }
                        }
                    });
                    dataset._rightTilesets = null;
                }
            }); 
            
            try { if (bothViewer) { bothViewer.destroy(); bothViewer = null; } } catch(e){}
            
            // Re-render dataset list to update UI
            if (window.renderDatasetList) {
                window.renderDatasetList();
            }
        }
    }

    function setDatasetSide(datasetId, side) {
        console.log(`setDatasetSide called: datasetId=${datasetId}, side=${side}`);
        const ds = (window.datasets || []).find(d => String(d.id) === String(datasetId)); 
        const id = ds ? ds.id : datasetId;
        
        console.log(`  Found dataset:`, ds ? `${ds.name} (${ds.id})` : 'NOT FOUND');
        console.log(`  Before: leftDatasets=${Array.from(leftDatasets)}, rightDatasets=${Array.from(rightDatasets)}`);
        
        if (side === 'left') { 
            leftDatasets.add(id); 
            rightDatasets.delete(id); 
            console.log(`  Action: Added to LEFT, removed from RIGHT`);
        } 
        else if (side === 'right') { 
            rightDatasets.add(id); 
            leftDatasets.delete(id);
            console.log(`  Action: Added to RIGHT, removed from LEFT`);
        } 
        else if (side === 'both') { 
            leftDatasets.add(id); 
            rightDatasets.add(id);
            console.log(`  Action: Added to BOTH`);
        }
        
        console.log(`  After: leftDatasets=${Array.from(leftDatasets)}, rightDatasets=${Array.from(rightDatasets)}`);
        
        updateCompareModeDataSources();
        // render list via frontend
        if (window.renderDatasetList) window.renderDatasetList();
    }

    // Expose
    window.toggleCompareMode = toggleCompareMode;
    window.setDatasetSide = setDatasetSide;
    window.leftDatasets = leftDatasets;
    window.rightDatasets = rightDatasets;
    window.backendCompare = { 
        ensureCompareDOM, 
        updateCompareModeDataSources,
        _toggleCompareMode: toggleCompareMode,
        _setDatasetSide: setDatasetSide,
        getLeftDatasets: () => leftDatasets,
        getRightDatasets: () => rightDatasets,
        isCompareMode: () => compareMode
    };
})();
