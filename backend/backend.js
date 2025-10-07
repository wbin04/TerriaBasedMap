// Complete backend.js with layer ordering functionality
// See frontend.html for the updated CSS styles

// Cesium Token
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJjMmU1Zjc0Ny1kMTZhLTRhYmMtOGFjYi1hOWU1MjlhYmEzNmQiLCJpZCI6MzE5NTA2LCJpYXQiOjE3NTMyNDMwODB9.k4KeeDH7fAto4Orfeva9-sJuvQTLoSELhItVYsochBs';

window.addEventListener('unhandledrejection', function(evt) {
    try {
        console.error('Unhandled Promise rejection captured:', evt.reason || evt);
    } catch (e) { /* ignore */ }
});

// Declare viewer globally but initialize after DOM is ready
let viewer = null;

// Initialize main viewer after DOM is loaded
function initializeMainViewer() {
    if (viewer) return; // Already initialized
    
    const cesiumContainer = document.getElementById('cesiumContainer');
    if (!cesiumContainer) {
        console.error('cesiumContainer not found in DOM');
        return;
    }
    
    viewer = new Cesium.Viewer('cesiumContainer', {
        terrainProvider: Cesium.CesiumTerrainProvider(),
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

let datasets = [];
let selectedEntity = null;
let originalEntityAppearance = null;
let compareMode = false;
let leftDatasets = new Set();
let rightDatasets = new Set();
let leftBaseLayer = null;
let rightBaseLayer = null;

// Dual-viewer compare mode variables (from backend_new.js)
let leftViewer = null;
let rightViewer = null;
let bothViewer = null;
let syncingCamera = false;
let compareSliderInitialized = false;

// Cleanup overlay viewers before page unload to prevent appendChild errors on refresh
window.addEventListener('beforeunload', function() {
    try {
        if (leftViewer && !leftViewer.isDestroyed()) {
            leftViewer.destroy();
            leftViewer = null;
        }
    } catch (e) { console.warn('Error destroying leftViewer:', e); }
    try {
        if (rightViewer && !rightViewer.isDestroyed()) {
            rightViewer.destroy();
            rightViewer = null;
        }
    } catch (e) { console.warn('Error destroying rightViewer:', e); }
    try { if (bothViewer && !bothViewer.isDestroyed()) { bothViewer.destroy(); bothViewer = null; } } catch (e) { console.warn('Error destroying bothViewer:', e); }
});

async function loadDatasetsFromAPI(initialLoad = true) {
    try {
        const response = await fetch('http://localhost:8000/api/datasets');
        if (response.ok) {
            const serverList = await response.json();
            if (initialLoad) {
                // Clear all backend datasets on initial page load to prevent persistence across reloads
                if (serverList.length > 0) {
                    console.log('Clearing all backend datasets from server on initial page load...');
                    const deletePromises = serverList.map(sd => 
                        fetch(`http://localhost:8000/api/datasets/${sd.id}`, { method: 'DELETE' })
                            .catch(err => console.warn(`Failed to delete dataset ${sd.id}:`, err))
                    );
                    await Promise.all(deletePromises);
                    console.log('All backend datasets cleared (initial load)');
                }

                // Start with only UI datasets to avoid carrying over previously uploaded backend datasets
                datasets = datasets.filter(d => d.source === 'ui'); // Keep only UI datasets if any
            } else {
                // On non-initial loads (e.g. after upload), fetch fresh server list and merge
                // Merge serverList entries into our datasets array while preserving any
                // existing dataset objects (including their DataSource and layers).
                serverList.forEach(sd => {
                    const sdIdStr = String(sd.id);
                    const existingIndex = datasets.findIndex(d => String(d.id) === sdIdStr && d.source === 'backend');
                    if (existingIndex >= 0) {
                        // Merge metadata into existing dataset rather than replacing it
                        const existing = datasets[existingIndex];
                        existing.name = sd.name || existing.name;
                        existing.type = sd.type || existing.type;
                        // Preserve existing.visible/opactiy if already set; otherwise take server value or default
                        existing.visible = (typeof existing.visible === 'boolean') ? existing.visible : (sd.visible !== undefined ? sd.visible : true);
                        existing.opacity = (typeof existing.opacity === 'number') ? existing.opacity : (sd.opacity !== undefined ? sd.opacity : 0.7);
                        // Keep any layer info we've already extracted from the DataSource; otherwise use server layers
                        existing.layers = (existing.layers && existing.layers.length > 0) ? existing.layers : (sd.layers || []);
                        // Keep existing.dataSource as-is (do not null it out)
                    } else {
                        // Add placeholder dataset; actual DataSource will be loaded when requested
                        datasets.push({ id: sd.id, source: 'backend', name: sd.name || `Dataset ${sd.id}`, type: sd.type || 'UNKNOWN', dataSource: null, visible: sd.visible !== undefined ? sd.visible : true, opacity: sd.opacity !== undefined ? sd.opacity : 0.7, layers: sd.layers || [] });
                    }
                });
            }

            window.datasets = datasets;

            renderDatasetList();
            updateDataSourceZOrder();
        }
    } catch (error) {
        console.error('Failed to load datasets:', error);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    // Initialize main viewer first
    initializeMainViewer();
    
    // Initialize click handler
    initializeClickHandler();
    
    // Initialize UI event listeners (file input, search, etc.)
    initializeUIEventListeners();
    
    // Then load datasets
    loadDatasetsFromAPI();
    // Ensure compare button positioned correctly initially
    try { updateCompareButtonPosition(); } catch (e) { /* ignore */ }
});

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

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('active');
    // Reposition compare button when sidebar toggles
    try { updateCompareButtonPosition(); } catch (e) { /* ignore */ }
}

// Recompute position on window resize in case layout changes
window.addEventListener('resize', function() {
    try { updateCompareButtonPosition(); } catch (e) { /* ignore */ }
});

// Position the compare button responsively relative to the sidebar and toggle button
function updateCompareButtonPosition() {
    const toggleBtn = document.querySelector('.toggle-btn');
    const compareBtn = document.getElementById('compareModeBtn');
    const sidebar = document.getElementById('sidebar');
    if (!compareBtn || !toggleBtn) return;

    const sidebarOpen = sidebar && sidebar.classList.contains('active');

    if (sidebarOpen) {
        // When sidebar is open, place compare button a bit to the right of the sidebar (inside the content area)
        compareBtn.style.left = (sidebar.offsetWidth + 30) + 'px';
    } else {
        // When closed, sit near the toggle button
        const rect = toggleBtn.getBoundingClientRect();
        // Place compare button to the right of the toggle button
        compareBtn.style.left = (rect.left + rect.width + 12) + 'px';
    }
}

function switchTab(tabName) {
    const tabs = document.querySelectorAll('.tab-btn');
    const panels = document.querySelectorAll('.tab-panel');
    tabs.forEach(tab => tab.classList.remove('active'));
    panels.forEach(panel => panel.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById(tabName + '-panel').classList.add('active');
}

// Initialize UI event listeners after DOM is ready
function initializeUIEventListeners() {
    // File input handler
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.addEventListener('change', function(e) {
            const files = e.target.files;
            for (let file of files) {
                uploadFile(file);
            }
            e.target.value = '';
        });
    }

    // Search input handler
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', function(e) {
            const searchTerm = e.target.value.toLowerCase();
            const categories = document.querySelectorAll('.category-item');
            categories.forEach(category => {
                const title = category.querySelector('.category-title').textContent.toLowerCase();
                const desc = category.querySelector('.category-description').textContent.toLowerCase();
                if (title.includes(searchTerm) || desc.includes(searchTerm)) {
                    category.style.display = 'block';
                } else {
                    category.style.display = 'none';
                }
            });
        });
    }
}

async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    try {
        const response = await fetch('http://localhost:8000/api/upload', {
            method: 'POST',
            body: formData
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Upload failed');
        }
    const result = await response.json();
    // Load file content and add to viewer
    await loadFileFromServer(result.dataset.id, result.dataset.name);
    // Refresh dataset list without clearing server datasets (not initial load)
    await loadDatasetsFromAPI(false);
    } catch (error) {
        console.error('Upload error:', error);
        alert('Upload failed: ' + error.message);
    }
}

async function loadFileFromServer(datasetId, datasetName) {
    try {
        const response = await fetch(`http://localhost:8000/api/files/${datasetId}`);
        if (!response.ok) throw new Error('Failed to load file from server');
        const data = await response.json();
        await processFileContent(data.content, data.type.toLowerCase(), datasetId, datasetName);
    } catch (error) {
        console.error('Load file error:', error);
        alert('Failed to load file: ' + error.message);
    }
}

async function processFileContent(content, fileExtension, datasetId, datasetName) {
    try {
        let dataSource = null;
        let layerType = fileExtension.toUpperCase();
        switch(fileExtension) {
            case 'geojson':
            case 'json':
                let geojsonData = JSON.parse(content);
                dataSource = new Cesium.GeoJsonDataSource(datasetName);
                await dataSource.load(geojsonData, { clampToGround: true });
                const entities = dataSource.entities.values;
                entities.forEach(entity => {
                    let layerName = 'Default';
                    if (entity.properties && entity.properties.Layer) {
                        layerName = entity.properties.Layer.getValue();
                    }
                    const layerColor = getColorForLayer(layerName);
                    if (entity.polyline) {
                        entity.polyline.material = new Cesium.ColorMaterialProperty(layerColor);
                        entity.polyline.width = new Cesium.ConstantProperty(2);
                    }
                    if (entity.polygon) {
                        entity.polygon.material = new Cesium.ColorMaterialProperty(layerColor.withAlpha(0.6));
                        entity.polygon.outline = new Cesium.ConstantProperty(true);
                        entity.polygon.outlineColor = new Cesium.ConstantProperty(layerColor);
                        entity.polygon.outlineWidth = new Cesium.ConstantProperty(2);
                        entity.polygon.classificationType = Cesium.ClassificationType.TERRAIN;
                        entity.polygon.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
                    }
                    if (entity.point) {
                        entity.point.color = new Cesium.ConstantProperty(layerColor);
                        entity.point.pixelSize = new Cesium.ConstantProperty(8);
                        entity.point.outlineColor = new Cesium.ConstantProperty(Cesium.Color.WHITE);
                        entity.point.outlineWidth = new Cesium.ConstantProperty(2);
                    }
                    if (entity.billboard) {
                        entity.billboard.color = new Cesium.ConstantProperty(layerColor);
                    }
                });
                break;
            case 'kml':
                dataSource = await Cesium.KmlDataSource.load(content, {
                    camera: viewer.scene.camera,
                    canvas: viewer.scene.canvas
                });
                break;
            case 'kmz':
                const blob = new Blob([content], { type: 'application/vnd.google-earth.kmz' });
                dataSource = await Cesium.KmlDataSource.load(blob, {
                    camera: viewer.scene.camera,
                    canvas: viewer.scene.canvas
                });
                break;
            case 'czml':
                dataSource = await Cesium.CzmlDataSource.load(JSON.parse(content));
                break;
            case 'gpx':
                dataSource = await Cesium.GpxDataSource.load(content);
                break;
            default:
                alert('Unsupported file format: ' + fileExtension);
                return;
        }
        if (dataSource) {
            addDatasetToViewer(datasetId, layerType, dataSource, null, null, datasetName);
            viewer.flyTo(dataSource);
        }
    } catch (error) {
        console.error('Error processing file:', error);
        alert('Error processing file: ' + error.message);
    }
}

function addDatasetToViewer(id, type, dataSource, model = null, position = null, name = null) {
    let existing = datasets.find(d => d.id === id && d.source === 'backend');
    let layers = [];
    if (dataSource) {
        const entities = dataSource.entities.values;
        const layerSet = new Set();
        entities.forEach(entity => {
            if (entity.properties && entity.properties.Layer) {
                layerSet.add(entity.properties.Layer.getValue());
            }
        });
        layers = Array.from(layerSet).map(layerName => ({ name: layerName, visible: true, color: '#3498db' }));
        console.log(`Dataset ${id} (${name}): Found ${entities.length} entities, ${layers.length} layers:`, layers);
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
    // Ensure entities use the dataset's opacity
    applyDatasetOpacityToEntities(existing);
    } else {
        datasets.push({
            id, source: 'backend', name: name || `Dataset ${id}`, type, dataSource, model, position,
            visible: true, opacity: 0.7, layers
        });
        // Apply opacity to newly added dataset (last pushed)
        const newDs = datasets[datasets.length - 1];
        applyDatasetOpacityToEntities(newDs);
    }
    window.datasets = datasets;
    if (dataSource) cacheEntitiesOriginalAppearance(dataSource);
    updateDataSourceZOrder();
    renderDatasetList();
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
                try {
                    const color = e.point.color?.getValue(now);
                    ap.point = {
                        color: color ? color.clone() : null,
                        pixelSize: e.point.pixelSize?.getValue(now) ?? null,
                        outlineColor: e.point.outlineColor?.getValue(now)?.clone() ?? null,
                        outlineWidth: e.point.outlineWidth?.getValue(now) ?? null
                    };
                } catch (err) { ap.point = null; }
            }
            if (e.polyline) {
                try {
                    const matColor = e.polyline.material?.color?.getValue(now);
                    ap.polyline = {
                        materialColor: matColor ? matColor.clone() : null,
                        width: e.polyline.width?.getValue(now) ?? null
                    };
                } catch (err) { ap.polyline = null; }
            }
            if (e.polygon) {
                try {
                    const matColor = e.polygon.material?.color?.getValue(now);
                    ap.polygon = {
                        materialColor: matColor ? matColor.clone() : null,
                        outlineColor: e.polygon.outlineColor?.getValue(now)?.clone() ?? null,
                        outlineWidth: e.polygon.outlineWidth?.getValue(now) ?? null
                    };
                } catch (err) { ap.polygon = null; }
            }
            e._cachedOriginalAppearance = ap;
        }
    } catch (e) {
        console.warn('Failed to cache entity appearances:', e);
    }
}

// Apply dataset.opacity to all entities in a dataset's DataSource
function applyDatasetOpacityToEntities(dataset) {
    if (!dataset || !dataset.dataSource) return;
    const entities = dataset.dataSource.entities.values || [];
    entities.forEach(entity => {
        try {
            if (entity.polygon?.material instanceof Cesium.ColorMaterialProperty) {
                const color = entity.polygon.material.color.getValue();
                entity.polygon.material = new Cesium.ColorMaterialProperty(color.withAlpha(dataset.opacity));
            }
            if (entity.polyline?.material instanceof Cesium.ColorMaterialProperty) {
                const color = entity.polyline.material.color.getValue();
                entity.polyline.material = new Cesium.ColorMaterialProperty(color.withAlpha(dataset.opacity));
            }
            if (entity.point) {
                const color = entity.point.color.getValue();
                entity.point.color = new Cesium.ConstantProperty(color.withAlpha(dataset.opacity));
            }
        } catch (e) {
            // ignore entities that don't match expected shapes
        }
    });
}

function renderDatasetList() {
    const listContainer = document.getElementById('datasetList');
    if (!listContainer) {
        return;
    }
    listContainer.innerHTML = '';
    const displayDatasets = [...datasets].reverse();
    displayDatasets.forEach((dataset, displayIndex) => {
        const actualIndex = datasets.length - 1 - displayIndex;
        const item = document.createElement('div');
        item.className = 'dataset-item';
        item.dataset.datasetId = dataset.id;
        item.dataset.datasetSource = dataset.source;
        item.dataset.actualIndex = actualIndex;
        item.draggable = true;
        let layersHtml = '';
        if (dataset.layers && dataset.layers.length > 0) {
            const layerCount = dataset.layers.length;
            layersHtml = `
                <div class="layer-toggle" onclick="toggleLayerListSafe('${dataset.id}')">
                    <span class="layer-toggle-icon">▶</span>
                    <span class="layer-toggle-text">Layers (${layerCount})</span>
                </div>
                <div class="layer-list collapsed" id="layer-list-${dataset.id}">${dataset.layers.map((layerNameOrObj, idx) => {
                    const layerName = typeof layerNameOrObj === 'string' ? layerNameOrObj : layerNameOrObj.name;
                    const layerVisible = typeof layerNameOrObj === 'string' ? true : layerNameOrObj.visible;
                    const layerColor = getLayerColor(dataset, idx);
                    return `<div class="layer-item">
                        <input type="checkbox" id="layer-${dataset.id}-${idx}" ${layerVisible ? 'checked' : ''} onchange="toggleLayerSafe('${dataset.id}', '${dataset.source}', ${idx})">
                        <input type="color" id="color-${dataset.id}-${idx}" value="${layerColor}" onchange="changeLayerColorSafe('${dataset.id}', '${dataset.source}', ${idx}, this.value)" style="width: 30px; height: 20px; border: none; cursor: pointer; margin-right: 8px;">
                        <label for="layer-${dataset.id}-${idx}" style="flex: 1; cursor: pointer;">${layerName}</label>
                    </div>`;
                }).join('')}</div>`;
        }
        
        // Compare mode buttons
        let compareButtonsHtml = '';
        if (compareMode) {
            const isLeft = leftDatasets.has(dataset.id);
            const isRight = rightDatasets.has(dataset.id);
            const isBoth = isLeft && isRight;
            compareButtonsHtml = `
                <div class="compare-controls">
                    <button class="compare-btn ${isLeft && !isBoth ? 'active' : ''}" onclick="setDatasetSideSafe('${dataset.id}', 'left')" title="Show on left">L</button>
                    <button class="compare-btn ${isBoth ? 'active' : ''}" onclick="setDatasetSideSafe('${dataset.id}', 'both')" title="Show on both">B</button>
                    <button class="compare-btn ${isRight && !isBoth ? 'active' : ''}" onclick="setDatasetSideSafe('${dataset.id}', 'right')" title="Show on right">R</button>
                </div>`;
        }
        
        const canMoveUp = displayIndex > 0;
        const canMoveDown = displayIndex < displayDatasets.length - 1;
        item.innerHTML = `
            <div class="dataset-header">
                <div class="dataset-reorder-controls">
                    <button class="reorder-btn" ${!canMoveUp ? 'disabled' : ''} onclick="moveDatasetUpSafe(${actualIndex})" title="Move up">▲</button>
                    <button class="reorder-btn" ${!canMoveDown ? 'disabled' : ''} onclick="moveDatasetDownSafe(${actualIndex})" title="Move down">▼</button>
                </div>
                <div class="dataset-controls">
                    <label class="toggle-switch">
                        <input type="checkbox" ${dataset.visible ? 'checked' : ''} onchange="toggleDatasetSafe('${dataset.id}', '${dataset.source}', this.checked)">
                        <span class="toggle-slider"></span>
                    </label>
                    <button class="delete-btn" onclick="deleteDatasetSafe('${dataset.id}', '${dataset.source}')">🗑️</button>
                </div>
            </div>
            <div class="dataset-name-row">
                <div class="dataset-name" title="Drag to reorder">${dataset.name}</div>
                ${compareButtonsHtml}
            </div>
            <div style="font-size: 11px; color: #95a5a6; margin-bottom: 10px;">Type: ${dataset.type} | Layer ${displayIndex + 1} of ${datasets.length}</div>
            <div class="opacity-control">
                <label>Opacity: <span id="opacity-value-${dataset.id}">${Math.round(dataset.opacity * 100)}%</span></label>
                <input type="range" min="0" max="100" value="${dataset.opacity * 100}" oninput="updateOpacitySafe('${dataset.id}', '${dataset.source}', this.value)">
            </div>${layersHtml}`;
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('drop', handleDrop);
        item.addEventListener('dragend', handleDragEnd);
        listContainer.appendChild(item);
    });
}

async function toggleDataset(id, source, checked) {
    const normalizedId = source === 'backend' ? parseInt(id) : id;
    const dataset = datasets.find(d => d.id === normalizedId && d.source === source);
    if (!dataset) return;
    if (source === 'backend' && typeof checked !== 'undefined') {
        try {
            const response = await fetch(`http://localhost:8000/api/datasets/${normalizedId}/toggle`, { method: 'PUT' });
            if (response.ok) {
                checked = (await response.json()).visible;
            }
        } catch (error) {
            console.error('Toggle dataset error:', error);
            return;
        }
    }
    dataset.visible = checked;
    if (id === 'DVHC') {
        if (checked) {
            switchToAdminMode();
        } else {
            switchToNormalMode();
        }
        return;
    }
    if (dataset.dataSource) {
        dataset.dataSource.show = checked;
    }
    if (dataset.model) {
        dataset.model.show = checked;
    }
    viewer.scene.requestRender();
}

async function updateOpacity(id, source, value) {
    const normalizedId = source === 'backend' ? parseInt(id) : id;
    const dataset = datasets.find(d => d.id === normalizedId && d.source === source);
    if (!dataset) return;
    if (source === 'backend') {
        try {
            const response = await fetch(`http://localhost:8000/api/datasets/${normalizedId}/opacity`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ opacity: value / 100 })
            });
            if (response.ok) {
                const result = await response.json();
                dataset.opacity = result.opacity;
            }
        } catch (error) {
            console.error('Update opacity error:', error);
            return;
        }
    } else {
        dataset.opacity = value / 100;
    }
    document.getElementById(`opacity-value-${id}`).textContent = value + '%';
    const entitiesToUpdate = dataset.dataSource ? dataset.dataSource.entities.values : [];
    entitiesToUpdate.forEach(entity => {
        if (entity.polygon?.material instanceof Cesium.ColorMaterialProperty) {
            const color = entity.polygon.material.color.getValue();
            entity.polygon.material = new Cesium.ColorMaterialProperty(color.withAlpha(dataset.opacity));
        }
        if (entity.polyline?.material instanceof Cesium.ColorMaterialProperty) {
            const color = entity.polyline.material.color.getValue();
            entity.polyline.material = new Cesium.ColorMaterialProperty(color.withAlpha(dataset.opacity));
        }
        if (entity.point) {
            const color = entity.point.color.getValue();
            entity.point.color = new Cesium.ConstantProperty(color.withAlpha(dataset.opacity));
        }
    });
}

async function toggleLayer(datasetId, source, layerIdx) {
    const normalizedId = source === 'backend' ? parseInt(datasetId) : datasetId;
    const dataset = datasets.find(d => d.id === normalizedId && d.source === source);
    if (!dataset || !dataset.layers || !dataset.layers[layerIdx]) return;
    const visible = document.getElementById(`layer-${datasetId}-${layerIdx}`).checked;
    
    // Update local state for all datasets
    if (typeof dataset.layers[layerIdx] === 'object') {
        dataset.layers[layerIdx].visible = visible;
    }
    
    // Update DataSource entities for backend datasets
    if (source === 'backend' && dataset.dataSource) {
        const layerName = typeof dataset.layers[layerIdx] === 'object' ? dataset.layers[layerIdx].name : dataset.layers[layerIdx];
        dataset.dataSource.entities.values.forEach(entity => {
            if (entity.properties?.Layer?.getValue() === layerName) {
                entity.show = visible;
            }
        });
        viewer.scene.requestRender();
    }
    
    // Handle DVHC special case
    if (datasetId === 'DVHC') {
        filterCategory = layerIdx === 0 ? (visible ? null : 'ward') : (visible ? null : 'province');
        loadModelsForViewport();
    }
}

async function deleteDataset(id, source) {
    const normalizedId = source === 'backend' ? parseInt(id) : id;
    const datasetIndex = datasets.findIndex(d => d.id === normalizedId && d.source === source);
    if (datasetIndex === -1) return;
    const dataset = datasets[datasetIndex];
    if (source === 'backend') {
        try {
            const response = await fetch(`http://localhost:8000/api/datasets/${normalizedId}`, { method: 'DELETE' });
            if (!response.ok) return;
        } catch (error) {
            console.error('Delete dataset error:', error);
            return;
        }
    }
    datasets.splice(datasetIndex, 1);
    if (dataset.dataSource) {
        dataset.dataSource.show = false;
        if (viewer.dataSources.contains(dataset.dataSource)) {
            viewer.dataSources.remove(dataset.dataSource, true);
        }
    }
    if (dataset.model) {
        viewer.scene.primitives.remove(dataset.model);
    }
    if (id === 'DVHC') {
        switchToNormalMode();
    }
    renderDatasetList();
    viewer.scene.requestRender();
}

let draggedItem = null;

function handleDragStart(e) {
    draggedItem = this;
    this.style.opacity = '0.4';
    e.dataTransfer.effectAllowed = 'move';
    this.classList.add('dragging');
}

function handleDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }
    if (draggedItem !== this) {
        const draggedIndex = parseInt(draggedItem.dataset.actualIndex);
        const targetIndex = parseInt(this.dataset.actualIndex);
        moveDataset(draggedIndex, targetIndex);
    }
    return false;
}

function handleDragEnd(e) {
    this.style.opacity = '1';
    this.classList.remove('dragging');
}

function moveDatasetUp(currentIndex) {
    if (currentIndex >= datasets.length - 1) return;
    moveDataset(currentIndex, currentIndex + 1);
}

function moveDatasetDown(currentIndex) {
    if (currentIndex <= 0) return;
    moveDataset(currentIndex, currentIndex - 1);
}

function moveDataset(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    const [movedDataset] = datasets.splice(fromIndex, 1);
    datasets.splice(toIndex, 0, movedDataset);
    updateDataSourceZOrder();
    renderDatasetList();
    console.log(`Moved dataset from index ${fromIndex} to ${toIndex}`);
}

function updateDataSourceZOrder() {
    // Ensure all visible datasets are present in the main viewer and visible state is correct
    datasets.forEach(dataset => {
        if (dataset.dataSource) {
            try {
                if (!viewer.dataSources.contains(dataset.dataSource)) {
                    viewer.dataSources.add(dataset.dataSource);
                }
            } catch (e) {
                console.warn('updateDataSourceZOrder: failed to ensure datasource present', e);
            }
            dataset.dataSource.show = !!dataset.visible;
        }
    });

    // Build a list of DataSources in the desired visual order (datasets[0] should be bottom)
    const ordered = [];
    for (let i = 0; i < datasets.length; i++) {
        const d = datasets[i];
        if (d.dataSource && d.visible && viewer.dataSources.contains(d.dataSource)) {
            ordered.push(d.dataSource);
        }
    }

    // Remove then re-add in forward order so that DataSources corresponding to higher-index
    // datasets are added last and therefore rendered on top.
    ordered.forEach(ds => {
        try { if (viewer.dataSources.contains(ds)) viewer.dataSources.remove(ds, false); } catch (e) {}
    });
    for (let i = 0; i < ordered.length; i++) {
        const ds = ordered[i];
        try { viewer.dataSources.add(ds); } catch (e) { console.warn('updateDataSourceZOrder: add failed', e); }
    }

    // Force a render update
    viewer.scene.requestRender();
}

function saveOriginalAppearance(entity) {
    if (entity._cachedOriginalAppearance) {
        const cache = entity._cachedOriginalAppearance;
        const clone = {};
        if (cache.point) clone.point = { ...cache.point };
        if (cache.polyline) clone.polyline = { ...cache.polyline };
        if (cache.polygon) clone.polygon = { ...cache.polygon };
        return clone;
    }
    const appearance = {};
    const now = Cesium.JulianDate.now();
    if (entity.point) {
        appearance.point = {
            color: entity.point.color?.getValue(now)?.clone?.() ?? null,
            pixelSize: entity.point.pixelSize?.getValue(now) ?? null,
            outlineColor: entity.point.outlineColor?.getValue(now)?.clone?.() ?? null,
            outlineWidth: entity.point.outlineWidth?.getValue(now) ?? null
        };
    }
    if (entity.polyline) {
        appearance.polyline = {
            material: entity.polyline.material?.color?.getValue(now)?.clone?.() ?? null,
            width: entity.polyline.width?.getValue(now) ?? null
        };
    }
    if (entity.polygon) {
        appearance.polygon = {
            material: entity.polygon.material?.color?.getValue(now)?.clone?.() ?? null,
            outlineColor: entity.polygon.outlineColor?.getValue(now)?.clone?.() ?? null,
            outlineWidth: entity.polygon.outlineWidth?.getValue(now) ?? null
        };
    }
    return appearance;
}

function restoreOriginalAppearance(entity, appearance) {
    const ap = entity._cachedOriginalAppearance || appearance;
    if (!ap) return;
    if (ap.point && entity.point) {
        if (ap.point.color) entity.point.color = new Cesium.ConstantProperty(ap.point.color);
        if (ap.point.pixelSize !== null && ap.point.pixelSize !== undefined) entity.point.pixelSize = new Cesium.ConstantProperty(ap.point.pixelSize);
        if (ap.point.outlineColor) entity.point.outlineColor = new Cesium.ConstantProperty(ap.point.outlineColor);
        if (ap.point.outlineWidth !== null && ap.point.outlineWidth !== undefined) entity.point.outlineWidth = new Cesium.ConstantProperty(ap.point.outlineWidth);
    }
    if (ap.polyline && entity.polyline) {
        if (ap.polyline.materialColor) entity.polyline.material = new Cesium.ColorMaterialProperty(ap.polyline.materialColor);
        if (ap.polyline.width !== null && ap.polyline.width !== undefined) entity.polyline.width = new Cesium.ConstantProperty(ap.polyline.width);
    }
    if (ap.polygon && entity.polygon) {
        if (ap.polygon.materialColor) entity.polygon.material = new Cesium.ColorMaterialProperty(ap.polygon.materialColor);
        if (ap.polygon.outlineColor) entity.polygon.outlineColor = new Cesium.ConstantProperty(ap.polygon.outlineColor);
        if (ap.polygon.outlineWidth !== null && ap.polygon.outlineWidth !== undefined) entity.polygon.outlineWidth = new Cesium.ConstantProperty(ap.polygon.outlineWidth);
    }
}

function highlightEntity(entity) {
    if (entity.point) {
        entity.point.color = new Cesium.ConstantProperty(HIGHLIGHT_COLORS.point);
        entity.point.pixelSize = new Cesium.ConstantProperty(15);
        entity.point.outlineColor = new Cesium.ConstantProperty(Cesium.Color.BLACK);
        entity.point.outlineWidth = new Cesium.ConstantProperty(3);
    }
    if (entity.polyline) {
        entity.polyline.material = new Cesium.ColorMaterialProperty(HIGHLIGHT_COLORS.polyline);
        entity.polyline.width = new Cesium.ConstantProperty(5);
    }
    if (entity.polygon) {
        entity.polygon.material = new Cesium.ColorMaterialProperty(HIGHLIGHT_COLORS.polygon);
        entity.polygon.outlineColor = new Cesium.ConstantProperty(HIGHLIGHT_COLORS.polyline);
        entity.polygon.outlineWidth = new Cesium.ConstantProperty(4);
    }
}

function getGeometryType(entity) {
    if (entity.point) return 'Point';
    if (entity.polyline) return 'LineString';
    if (entity.polygon) return 'Polygon';
    if (entity.billboard) return 'Billboard';
    if (entity.model) return '3D Model';
    return 'Unknown';
}

function calculateGeometryStats(entity) {
    const stats = {};
    if (entity.position) {
        const cartographic = Cesium.Cartographic.fromCartesian(entity.position.getValue(Cesium.JulianDate.now()));
        stats.latitude = Cesium.Math.toDegrees(cartographic.latitude).toFixed(6);
        stats.longitude = Cesium.Math.toDegrees(cartographic.longitude).toFixed(6);
        stats.altitude = cartographic.height.toFixed(2);
    }
    if (entity.polyline?.positions) {
        const positions = entity.polyline.positions.getValue(Cesium.JulianDate.now());
        stats.vertices = positions.length;
        let totalLength = 0;
        for (let i = 0; i < positions.length - 1; i++) {
            totalLength += Cesium.Cartesian3.distance(positions[i], positions[i + 1]);
        }
        stats.length = (totalLength / 1000).toFixed(3);
    }
    if (entity.polygon?.hierarchy) {
        const hierarchy = entity.polygon.hierarchy.getValue(Cesium.JulianDate.now());
        const positions = hierarchy.positions;
        stats.vertices = positions.length;
        let area = 0;
        for (let i = 0; i < positions.length; i++) {
            const j = (i + 1) % positions.length;
            const cart1 = Cesium.Cartographic.fromCartesian(positions[i]);
            const cart2 = Cesium.Cartographic.fromCartesian(positions[j]);
            area += (cart2.longitude - cart1.longitude) * (cart2.latitude + cart1.latitude);
        }
        area = Math.abs(area / 2.0);
        stats.area = (area * Math.pow(6371, 2)).toFixed(3);
    }
    return stats;
}

// Initialize click handler after viewer is ready
function initializeClickHandler() {
    if (!viewer) {
        console.warn('Cannot initialize click handler: viewer not ready');
        return;
    }
    
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction(function(click) {
        const pickedObject = viewer.scene.pick(click.position);
        if (selectedEntity && originalEntityAppearance) {
            restoreOriginalAppearance(selectedEntity, originalEntityAppearance);
            selectedEntity = null;
            originalEntityAppearance = null;
        }
        if (Cesium.defined(pickedObject) && Cesium.defined(pickedObject.id)) {
            const entity = pickedObject.id;
            originalEntityAppearance = saveOriginalAppearance(entity);
            selectedEntity = entity;
            viewer.scene.requestRender();
            highlightEntity(entity);
            viewer.scene.requestRender();
            showFeatureInfo(entity);
        } else {
            closeFeatureInfo();
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

function showFeatureInfo(entity) {
    const infoPanel = document.getElementById('featureInfo');
    const contentDiv = document.getElementById('featureInfoContent');
    const titleDiv = document.getElementById('featureTitle');
    contentDiv.innerHTML = '';
    const geomType = getGeometryType(entity);
    titleDiv.innerHTML = `Feature Information <span class="feature-type-badge">${geomType}</span>`;
    const stats = calculateGeometryStats(entity);
    if (Object.keys(stats).length > 0) {
        let statsHtml = '<div class="feature-geometry-info"><div class="geometry-stats">';
        if (stats.latitude) statsHtml += `<div class="stat-item"><div class="stat-label">Latitude</div><div class="stat-value">${stats.latitude}°</div></div>`;
        if (stats.longitude) statsHtml += `<div class="stat-item"><div class="stat-label">Longitude</div><div class="stat-value">${stats.longitude}°</div></div>`;
        if (stats.altitude) statsHtml += `<div class="stat-item"><div class="stat-label">Altitude</div><div class="stat-value">${stats.altitude} m</div></div>`;
        if (stats.length) statsHtml += `<div class="stat-item"><div class="stat-label">Length</div><div class="stat-value">${stats.length} km</div></div>`;
        if (stats.area) statsHtml += `<div class="stat-item"><div class="stat-label">Area</div><div class="stat-value">${stats.area} km²</div></div>`;
        if (stats.vertices) statsHtml += `<div class="stat-item"><div class="stat-label">Vertices</div><div class="stat-value">${stats.vertices}</div></div>`;
        statsHtml += '</div></div>';
        contentDiv.innerHTML = statsHtml;
    }
    let hasProperties = false;
    if (entity.properties) {
        const propertyNames = entity.properties.propertyNames || [];
        if (propertyNames.length > 0) {
            hasProperties = true;
            propertyNames.forEach(propertyName => {
                try {
                    const property = entity.properties[propertyName];
                    const value = property ? property.getValue(Cesium.JulianDate.now()) : null;
                    if (value !== undefined && value !== null) {
                        const propDiv = document.createElement('div');
                        propDiv.className = 'feature-property';
                        propDiv.innerHTML = `<div class="property-key">${propertyName}</div><div class="property-value">${formatPropertyValue(value)}</div>`;
                        contentDiv.appendChild(propDiv);
                    }
                } catch (error) {
                    console.error(`Error reading property ${propertyName}:`, error);
                }
            });
        }
    }
    if (!hasProperties) {
        const basicInfo = [];
        if (entity.name) basicInfo.push({ key: 'Name', value: entity.name });
        if (entity.id && typeof entity.id === 'string') basicInfo.push({ key: 'ID', value: entity.id });
        if (entity.description) {
            const desc = entity.description.getValue ? entity.description.getValue(Cesium.JulianDate.now()) : entity.description;
            if (desc) basicInfo.push({ key: 'Description', value: desc });
        }
        if (basicInfo.length > 0) {
            basicInfo.forEach(info => {
                const propDiv = document.createElement('div');
                propDiv.className = 'feature-property';
                propDiv.innerHTML = `<div class="property-key">${info.key}</div><div class="property-value">${formatPropertyValue(info.value)}</div>`;
                contentDiv.appendChild(propDiv);
            });
        } else {
            contentDiv.innerHTML += '<div style="padding: 20px; text-align: center; color: #6c757d;">No properties available</div>';
        }
    }
    infoPanel.classList.add('active');
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

function closeFeatureInfo() {
    const infoPanel = document.getElementById('featureInfo');
    infoPanel.classList.remove('active');
    if (selectedEntity && originalEntityAppearance) {
        restoreOriginalAppearance(selectedEntity, originalEntityAppearance);
        selectedEntity = null;
        originalEntityAppearance = null;
    }
}

let currentMode = 'normal';
let filterCategory = null;
let debounceTimer = null;
const MOVE_DELAY = 50;

function onCameraMove() {
    if (currentMode !== 'admin') return;
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
        loadModelsForViewport();
    }, MOVE_DELAY);
}

async function switchToAdminMode() {
    console.log('Switching to admin mode');
    if (!viewer) return;
    currentMode = 'admin';
    filterCategory = null;
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    
    // Create or get DVHC dataset with its own DataSource
    let dvhcDataset = datasets.find(d => d.id === 'DVHC');
    if (!dvhcDataset) {
        // This shouldn't happen if loadAdminData was called, but handle it gracefully
        console.warn('DVHC dataset not found, it should be created by loadAdminData first');
        return;
    }
    
    console.log('DVHC dataset found:', dvhcDataset);
    
    // Create a new DataSource for DVHC if it doesn't exist
    if (!dvhcDataset.dataSource) {
        dvhcDataset.dataSource = new Cesium.CustomDataSource('DVHC');
        console.log('Created new DVHC DataSource:', dvhcDataset.dataSource);
    } else {
        console.log('DVHC DataSource already exists:', dvhcDataset.dataSource);
    }
    
    // Clear the DVHC DataSource
    const clearedCount = dvhcDataset.dataSource.entities.values.length;
    dvhcDataset.dataSource.entities.removeAll();
    console.log(`Cleared ${clearedCount} entities from DVHC DataSource`);
    
    // Restore backend datasets visibility
    datasets.forEach(dataset => {
        if (dataset.source === 'backend' && dataset.dataSource && dataset.visible) {
            if (!viewer.dataSources.contains(dataset.dataSource)) {
                viewer.dataSources.add(dataset.dataSource);
            }
            dataset.dataSource.show = true;
        }
    });
    
    await loadModelsForViewport();
    
    // Update z-order after loading DVHC data
    updateDataSourceZOrder();
    
    await new Promise(resolve => setTimeout(resolve, 100));
    const entities = dvhcDataset.dataSource.entities.values;
    if (entities.length > 0) {
        console.log(`Flying to ${entities.length} loaded DVHC entities`);
        viewer.zoomTo(entities, new Cesium.HeadingPitchRange(0.0, Cesium.Math.toRadians(-90.0), 0.0)).catch((error) => {
            console.error('FlyTo failed:', error);
        });
    }
    viewer.camera.moveEnd.addEventListener(onCameraMove);
}

function switchToNormalMode() {
    console.log('Switching to normal mode - clearing admin entities');
    currentMode = 'normal';
    filterCategory = null;
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    viewer.camera.moveEnd.removeEventListener(onCameraMove);
    
    // Clear DVHC DataSource instead of viewer.entities
    const dvhcDataset = datasets.find(d => d.id === 'DVHC');
    if (dvhcDataset && dvhcDataset.dataSource) {
        const entityCount = dvhcDataset.dataSource.entities.values.length;
        dvhcDataset.dataSource.entities.removeAll();
        console.log(`Cleared ${entityCount} DVHC entities from DataSource`);
    }
    
    viewer.scene.requestRender();
    
    // Restore backend datasets
    datasets.forEach(dataset => {
        if (dataset.source === 'backend' && dataset.dataSource && dataset.visible) {
            if (!viewer.dataSources.contains(dataset.dataSource)) {
                viewer.dataSources.add(dataset.dataSource);
            }
            dataset.dataSource.show = true;
        }
    });
    viewer.scene.requestRender();
}

function getViewportInfo() {
    try {
        if (!viewer) return null;
        const rect = viewer.camera.computeViewRectangle();
        if (!rect) return null;
        const west = Cesium.Math.toDegrees(rect.west);
        const south = Cesium.Math.toDegrees(rect.south);
        const east = Cesium.Math.toDegrees(rect.east);
        const north = Cesium.Math.toDegrees(rect.north);
        const cameraPosition = viewer.camera.positionCartographic;
        const cameraHeight = cameraPosition ? cameraPosition.height : 100000;
        const viewportWidth = Math.abs(east - west);
        const viewportHeight = Math.abs(north - south);
        const zoomLevel = Math.max(1, Math.floor(360 / Math.max(viewportWidth, viewportHeight)));
        let lod = "province";
        if (cameraHeight < 200000) lod = "ward";
        return { bbox: `${west},${south},${east},${north}`, zoom: Math.min(zoomLevel, 100), lod, cameraHeight };
    } catch (e) { return null; }
}

async function loadModelsForViewport() {
    if (currentMode !== 'admin') return;
    const viewportInfo = getViewportInfo();
    if (!viewportInfo) return;
    const { bbox, zoom, lod } = viewportInfo;
    let url = `http://localhost:8000/models?bbox=${bbox}&zoom=${zoom}&lod=${lod}`;
    if (filterCategory) url += `&category=${filterCategory}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        const models = data.models || [];
        
        // Get DVHC dataset and its DataSource
        const dvhcDataset = datasets.find(d => d.id === 'DVHC');
        if (!dvhcDataset || !dvhcDataset.dataSource) {
            console.error('DVHC DataSource not found');
            return;
        }
        
        const oldCount = dvhcDataset.dataSource.entities.values.length;
        dvhcDataset.dataSource.entities.removeAll();
        console.log(`Cleared ${oldCount} old entities, loading ${models.length} new ones`);
        
        models.forEach((model, index) => processModel(model, index, lod, dvhcDataset.dataSource));
        
    // Cache original appearance for DVHC entities to enable proper highlighting
    cacheEntitiesOriginalAppearance(dvhcDataset.dataSource);
    // Ensure newly-created entities respect the dataset's opacity
    applyDatasetOpacityToEntities(dvhcDataset);
        
        // DataSource z-order is managed by updateDataSourceZOrder() - don't touch it here
        // Just make sure it's added if this is the first time
        if (!viewer.dataSources.contains(dvhcDataset.dataSource)) {
            console.log('DVHC DataSource not in viewer, calling updateDataSourceZOrder to add it properly');
            updateDataSourceZOrder();
        }
        
        viewer.scene.requestRender();
        console.log(`Viewport update complete: ${models.length} models displayed`);
    } catch (err) {
        console.error('Load models error:', err);
    }
}

function processModel(model, index, lod, dataSource) {
    const lon = model.longitude || model.position?.longitude;
    const lat = model.latitude || model.position?.latitude;
    if (!lon || !lat) return;
    if (model.simplified_geom && model.simplified_geom.coordinates) {
        drawGeometryDirectly(model.simplified_geom, model.area, index, dataSource);
    }
}

function drawGeometryDirectly(geometry, area, index, dataSource) {
    const colors = [
        Cesium.Color.CRIMSON, Cesium.Color.ORANGE, Cesium.Color.GOLD,
        Cesium.Color.FORESTGREEN, Cesium.Color.DODGERBLUE, Cesium.Color.MEDIUMORCHID,
        Cesium.Color.HOTPINK, Cesium.Color.TEAL, Cesium.Color.BROWN,
        Cesium.Color.DARKSLATEGRAY, Cesium.Color.CORAL, Cesium.Color.LIGHTSEAGREEN,
        Cesium.Color.MEDIUMPURPLE, Cesium.Color.SANDYBROWN, Cesium.Color.STEELBLUE,
        Cesium.Color.INDIANRED, Cesium.Color.DARKKHAKI, Cesium.Color.MEDIUMSLATEBLUE,
        Cesium.Color.DARKGREEN, Cesium.Color.CHOCOLATE, Cesium.Color.CADETBLUE,
        Cesium.Color.DARKORANGE, Cesium.Color.MEDIUMVIOLETRED, Cesium.Color.OLIVEDRAB,
        Cesium.Color.ROYALBLUE, Cesium.Color.SIENNA, Cesium.Color.DARKTURQUOISE,
        Cesium.Color.FIREBRICK, Cesium.Color.MEDIUMSEAGREEN, Cesium.Color.DARKORCHID,
        Cesium.Color.GOLDENROD, Cesium.Color.DARKRED, Cesium.Color.DARKBLUE,
        Cesium.Color.DARKMAGENTA
    ];
    const color = colors[index % colors.length];
    function drawPolygon(coords, name) {
        if (!coords || coords.length < 3) return;
        const positions = [];
        coords.forEach(coord => {
            if (coord.length >= 2) {
                positions.push(coord[0], coord[1]);
            }
        });
        if (positions.length >= 6) {
            // Find dataset that owns this dataSource to use its configured opacity (fallback 0.7)
            let dsOpacity = 0.7;
            try {
                const owner = datasets.find(d => d.dataSource === dataSource);
                if (owner && typeof owner.opacity === 'number') dsOpacity = owner.opacity;
            } catch (e) {}

            dataSource.entities.add({
                name: name || `Polygon ${index}`,
                polygon: {
                    hierarchy: Cesium.Cartesian3.fromDegreesArray(positions),
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    material: color.withAlpha(dsOpacity),
                    outline: true,
                    outlineColor: color,
                    outlineWidth: 1,
                    // Add z-index hint to help with ordering
                    classificationType: Cesium.ClassificationType.TERRAIN
                }
            });
        }
    }
    if (geometry.type === 'Polygon') {
        if (Array.isArray(geometry.coordinates)) {
            drawPolygon(geometry.coordinates[0], `Polygon (area: ${area?.toFixed(4) || 0})`);
        }
    } else if (geometry.type === 'MultiPolygon') {
        geometry.coordinates.forEach((poly, i) => {
            if (Array.isArray(poly)) {
                drawPolygon(poly[0], `MultiPolygon part ${i+1} (area: ${area?.toFixed(4) || 0})`);
            }
        });
    }
}

function toggleLayerList(datasetId) {
    const layerList = document.getElementById(`layer-list-${datasetId}`);
    const toggleIcon = layerList.previousElementSibling.querySelector('.layer-toggle-icon');
    
    if (layerList.classList.contains('collapsed')) {
        layerList.classList.remove('collapsed');
        toggleIcon.textContent = '▼';
    } else {
        layerList.classList.add('collapsed');
        toggleIcon.textContent = '▶';
    }
}

function getLayerColor(dataset, layerIdx) {
    // For DVHC, return the color from dataset.layers if available
    if (dataset.id === 'DVHC' && typeof dataset.layers[layerIdx] === 'object' && dataset.layers[layerIdx].color) {
        return dataset.layers[layerIdx].color;
    }
    
    if (!dataset.dataSource) return '#3498db';
    
    const layerName = typeof dataset.layers[layerIdx] === 'object' ? dataset.layers[layerIdx].name : dataset.layers[layerIdx];
    let foundColor = null;
    
    // Find the first entity in this layer that has a color
    for (const entity of dataset.dataSource.entities.values) {
        if (entity.properties?.Layer?.getValue() === layerName) {
            const now = Cesium.JulianDate.now();
            
            if (entity.polygon?.material instanceof Cesium.ColorMaterialProperty) {
                const color = entity.polygon.material.color.getValue(now);
                if (color) {
                    foundColor = color;
                    break;
                }
            }
            if (entity.polyline?.material instanceof Cesium.ColorMaterialProperty) {
                const color = entity.polyline.material.color.getValue(now);
                if (color) {
                    foundColor = color;
                    break;
                }
            }
            if (entity.point?.color) {
                const color = entity.point.color.getValue(now);
                if (color) {
                    foundColor = color;
                    break;
                }
            }
        }
    }
    
    if (foundColor) {
        return foundColor.toCssHexString();
    }
    
    return '#3498db'; // Default fallback
}

function changeLayerColor(datasetId, source, layerIdx, color) {
    const normalizedId = source === 'backend' ? parseInt(datasetId) : datasetId;
    const dataset = datasets.find(d => d.id === normalizedId && d.source === source);
    if (!dataset || !dataset.layers || !dataset.layers[layerIdx]) return;
    
    // Update local state
    if (typeof dataset.layers[layerIdx] === 'object') {
        dataset.layers[layerIdx].color = color;
    }
    
    // Update DataSource entities for backend datasets
    if (source === 'backend' && dataset.dataSource) {
        const layerName = typeof dataset.layers[layerIdx] === 'object' ? dataset.layers[layerIdx].name : dataset.layers[layerIdx];
        const cesiumColor = Cesium.Color.fromCssColorString(color);
        
        dataset.dataSource.entities.values.forEach(entity => {
            if (entity.properties?.Layer?.getValue() === layerName) {
                if (entity.polygon?.material instanceof Cesium.ColorMaterialProperty) {
                    entity.polygon.material = new Cesium.ColorMaterialProperty(cesiumColor.withAlpha(dataset.opacity));
                }
                if (entity.polyline?.material instanceof Cesium.ColorMaterialProperty) {
                    entity.polyline.material = new Cesium.ColorMaterialProperty(cesiumColor);
                }
                if (entity.point) {
                    entity.point.color = new Cesium.ConstantProperty(cesiumColor);
                }
            }
        });
        viewer.scene.requestRender();
    }
    
    // Handle DVHC special case
    if (datasetId === 'DVHC') {
        // For DVHC, update the layer color and reload viewport
        if (typeof dataset.layers[layerIdx] === 'object') {
            dataset.layers[layerIdx].color = color;
        }
        // Reload DVHC data with new colors
        if (currentMode === 'admin') {
            loadModelsForViewport();
        }
    }
}
        // Camera synchronization (from backend_new.js)
        function syncCamera(source, targets) {
            if (syncingCamera) return;
            syncingCamera = true;

            const pos = source.camera.position.clone();
            const dir = source.camera.direction.clone();
            const up = source.camera.up.clone();

            targets.forEach(target => {
                if (target && target !== source) {
                    target.camera.setView({ destination: pos, orientation: { direction: dir, up: up } });
                }
            });

            setTimeout(() => syncingCamera = false, 50);
        }

        // Copy imagery/base layers from one viewer to another preserving order and basic properties
        function syncImageryLayers(srcViewer, dstViewer) {
            try {
                if (!srcViewer || !dstViewer) return;
                const src = srcViewer.imageryLayers;
                const dst = dstViewer.imageryLayers;
                // Remove default layers from destination
                try { dst.removeAll(); } catch (e) { /* ignore */ }
                for (let i = 0; i < src.length; i++) {
                    try {
                        const srcLayer = src.get(i);
                        // Add imagery provider to destination in the same order
                        const provider = srcLayer && srcLayer.imageryProvider ? srcLayer.imageryProvider : null;
                        if (!provider) continue;
                        const newLayer = dst.addImageryProvider(provider);
                        // Copy basic display properties
                        if (typeof srcLayer.show !== 'undefined') newLayer.show = srcLayer.show;
                        if (typeof srcLayer.alpha !== 'undefined') newLayer.alpha = srcLayer.alpha;
                        if (typeof srcLayer.brightness !== 'undefined') newLayer.brightness = srcLayer.brightness;
                        if (typeof srcLayer.contrast !== 'undefined') newLayer.contrast = srcLayer.contrast;
                    } catch (e) {
                        console.warn('syncImageryLayers: failed to copy a layer', e);
                    }
                }
            } catch (e) {
                console.warn('syncImageryLayers failed:', e);
            }
        }

        // Ensure overlay viewer DataSource stacking follows the `datasets` array order
        function syncOverlayDataSourceOrder(overlayViewer) {
            try {
                if (!overlayViewer) return;
                const dsList = [];
                for (let i = 0; i < datasets.length; i++) {
                    const dataset = datasets[i];
                    // prefer clones for overlays when present
                    let candidate = null;
                    if (overlayViewer === leftViewer) {
                        if (dataset._leftClone && overlayViewer.dataSources.contains(dataset._leftClone)) candidate = dataset._leftClone;
                        else if (dataset.dataSource && overlayViewer.dataSources.contains(dataset.dataSource)) candidate = dataset.dataSource;
                    } else if (overlayViewer === rightViewer) {
                        if (dataset._rightClone && overlayViewer.dataSources.contains(dataset._rightClone)) candidate = dataset._rightClone;
                        else if (dataset.dataSource && overlayViewer.dataSources.contains(dataset.dataSource)) candidate = dataset.dataSource;
                    } else {
                        // generic fallback
                        if (dataset._leftClone && overlayViewer.dataSources.contains(dataset._leftClone)) candidate = dataset._leftClone;
                        else if (dataset._rightClone && overlayViewer.dataSources.contains(dataset._rightClone)) candidate = dataset._rightClone;
                        else if (dataset.dataSource && overlayViewer.dataSources.contains(dataset.dataSource)) candidate = dataset.dataSource;
                    }
                    if (candidate) dsList.push(candidate);
                }

                // Remove then re-add in the correct order to set stacking.
                // Cesium renders dataSources in reverse order, so add from last-to-first
                for (const ds of dsList) {
                    try { if (overlayViewer.dataSources.contains(ds)) overlayViewer.dataSources.remove(ds, false); } catch (e) {}
                }
                for (let i = dsList.length - 1; i >= 0; i--) {
                    const ds = dsList[i];
                    try { overlayViewer.dataSources.add(ds); } catch (e) { console.warn('syncOverlayDataSourceOrder: add failed', e); }
                }
            } catch (e) {
                console.warn('syncOverlayDataSourceOrder failed:', e);
            }
        }

        // Ensure compare DOM containers exist before creating viewers
        function ensureCompareDOM() {
            const mainContainer = document.getElementById('cesiumContainer');
            if (!mainContainer) return null;
            const parent = mainContainer.parentElement || document.body;
            let viewerContainer = document.getElementById('viewerContainer');
            if (!viewerContainer) {
                viewerContainer = document.createElement('div');
                viewerContainer.id = 'viewerContainer';
                // Insert overlay container after mainContainer
                parent.insertBefore(viewerContainer, mainContainer.nextSibling);
                // Default overlay styles so it covers the map area
                viewerContainer.style.position = 'absolute';
                viewerContainer.style.top = '0';
                viewerContainer.style.left = '0';
                viewerContainer.style.width = '100%';
                viewerContainer.style.height = '100vh';
                viewerContainer.style.zIndex = '997';
                // Start hidden and non-interactive to avoid blocking normal map interactions
                viewerContainer.style.display = 'none';
                viewerContainer.style.pointerEvents = 'none';
            }

            let leftContainer = document.getElementById('leftContainer');
            if (!leftContainer) {
                leftContainer = document.createElement('div');
                leftContainer.id = 'leftContainer';
                viewerContainer.appendChild(leftContainer);
                // Make containers overlay and fill
                leftContainer.style.position = 'absolute';
                leftContainer.style.top = '0';
                leftContainer.style.left = '0';
                leftContainer.style.width = '100%';
                leftContainer.style.height = '100%';
                leftContainer.style.zIndex = '999';
                // Keep non-interactive until compare mode is enabled
                leftContainer.style.pointerEvents = 'none';
                leftContainer.style.overflow = 'hidden';
            }

            let rightContainer = document.getElementById('rightContainer');
            if (!rightContainer) {
                rightContainer = document.createElement('div');
                rightContainer.id = 'rightContainer';
                viewerContainer.appendChild(rightContainer);
                rightContainer.style.position = 'absolute';
                rightContainer.style.top = '0';
                rightContainer.style.left = '0';
                rightContainer.style.width = '100%';
                rightContainer.style.height = '100%';
                rightContainer.style.zIndex = '998';
                rightContainer.style.pointerEvents = 'none';
                rightContainer.style.overflow = 'hidden';
            }

            let leftViewerDiv = document.getElementById('leftViewer');
            if (!leftViewerDiv) {
                leftViewerDiv = document.createElement('div');
                leftViewerDiv.id = 'leftViewer';
                leftContainer.appendChild(leftViewerDiv);
                leftViewerDiv.style.width = '100%';
                leftViewerDiv.style.height = '100%';
            }

            let rightViewerDiv = document.getElementById('rightViewer');
            if (!rightViewerDiv) {
                rightViewerDiv = document.createElement('div');
                rightViewerDiv.id = 'rightViewer';
                rightContainer.appendChild(rightViewerDiv);
                rightViewerDiv.style.width = '100%';
                rightViewerDiv.style.height = '100%';
            }

            // Both viewer (full-screen, not clipped by slider) sits below left/right overlays
            let bothContainer = document.getElementById('bothContainer');
            if (!bothContainer) {
                bothContainer = document.createElement('div');
                bothContainer.id = 'bothContainer';
                // Insert between viewerContainer and overlay children so it's above the main viewer but below overlays
                viewerContainer.insertBefore(bothContainer, viewerContainer.firstChild);
                bothContainer.style.position = 'absolute';
                bothContainer.style.top = '0';
                bothContainer.style.left = '0';
                bothContainer.style.width = '100%';
                bothContainer.style.height = '100%';
                bothContainer.style.zIndex = '996';
                bothContainer.style.pointerEvents = 'none';
                bothContainer.style.overflow = 'hidden';
            }

            let bothViewerDiv = document.getElementById('bothViewer');
            if (!bothViewerDiv) {
                bothViewerDiv = document.createElement('div');
                bothViewerDiv.id = 'bothViewer';
                bothContainer.appendChild(bothViewerDiv);
                bothViewerDiv.style.width = '100%';
                bothViewerDiv.style.height = '100%';
            }

            let slider = document.getElementById('compareSlider');
            if (!slider) {
                slider = document.createElement('div');
                slider.id = 'compareSlider';
                const handle = document.createElement('div');
                handle.id = 'compareHandle';
                slider.appendChild(handle);
                viewerContainer.appendChild(slider);
                // ensure slider overlays
                slider.style.position = 'absolute';
                slider.style.top = '0';
                slider.style.left = '50%';
                slider.style.height = '100%';
                slider.style.zIndex = '1000';
                slider.style.display = 'none';
                slider.style.pointerEvents = 'auto';
                handle.style.pointerEvents = 'auto';
            }

            return { viewerContainer, leftContainer, rightContainer, bothViewerDiv, leftViewerDiv, rightViewerDiv, slider };
        }

        function toggleCompareMode() {
            compareMode = !compareMode;
            const btn = document.getElementById('compareModeBtn');
            const mainContainer = document.getElementById('cesiumContainer');

            // Acquire DOM references. When enabling compare we will create DOM if missing;
            // when disabling we prefer to only read existing elements so we don't accidentally create new ones.
            let dom = null;
            if (compareMode) {
                dom = ensureCompareDOM();
                if (!dom) {
                    console.error('Compare mode: cesiumContainer missing, cannot enable compare');
                    compareMode = false;
                    return;
                }
            } else {
                dom = {
                    viewerContainer: document.getElementById('viewerContainer'),
                    leftContainer: document.getElementById('leftContainer'),
                    rightContainer: document.getElementById('rightContainer'),
                    leftViewerDiv: document.getElementById('leftViewer'),
                    rightViewerDiv: document.getElementById('rightViewer'),
                    slider: document.getElementById('compareSlider')
                };
            }

            const { viewerContainer, leftContainer, rightContainer, bothViewerDiv, leftViewerDiv, rightViewerDiv, slider } = dom || {};

            if (compareMode) {
                if (btn) { btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true'); }
                if (slider) { slider.style.display = 'block'; slider.classList.add('active'); }
                // make overlay container visible and accept pointer events
                if (viewerContainer) { viewerContainer.style.display = 'block'; viewerContainer.style.pointerEvents = 'auto'; }

                // Create viewers if needed
                if (!leftViewer) {
                    if (leftViewerDiv) { leftViewerDiv.style.width = '100%'; leftViewerDiv.style.height = '100%'; }
                    leftViewer = new Cesium.Viewer(leftViewerDiv, {
                        terrainProvider: Cesium.CesiumTerrainProvider(),
                        baseLayerPicker: false, geocoder: false, homeButton: false,
                        sceneModePicker: false, navigationHelpButton: false,
                        animation: false, timeline: false, fullscreenButton: false
                    });
                    leftViewer.camera.moveEnd.addEventListener(() => syncCamera(leftViewer, [rightViewer, viewer]));
                    // Copy base imagery layers from main viewer to left overlay in same order
                    try { syncImageryLayers(viewer, leftViewer); } catch (e) { console.warn('Failed to sync imagery to leftViewer', e); }
                }

                if (!rightViewer) {
                    if (rightViewerDiv) { rightViewerDiv.style.width = '100%'; rightViewerDiv.style.height = '100%'; }
                    rightViewer = new Cesium.Viewer(rightViewerDiv, {
                        terrainProvider: Cesium.CesiumTerrainProvider(),
                        baseLayerPicker: false, geocoder: false, homeButton: false,
                        sceneModePicker: false, navigationHelpButton: false,
                        animation: false, timeline: false, fullscreenButton: false
                    });
                    rightViewer.camera.moveEnd.addEventListener(() => syncCamera(rightViewer, [leftViewer, viewer]));
                    // Copy base imagery layers from main viewer to right overlay in same order
                    try { syncImageryLayers(viewer, rightViewer); } catch (e) { console.warn('Failed to sync imagery to rightViewer', e); }
                }

                // Create bothViewer (full-screen, un-clipped) for datasets assigned to 'both'
                if (!bothViewer) {
                    if (bothViewerDiv) { bothViewerDiv.style.width = '100%'; bothViewerDiv.style.height = '100%'; }
                    bothViewer = new Cesium.Viewer(bothViewerDiv, {
                        terrainProvider: Cesium.CesiumTerrainProvider(),
                        baseLayerPicker: false, geocoder: false, homeButton: false,
                        sceneModePicker: false, navigationHelpButton: false,
                        animation: false, timeline: false, fullscreenButton: false
                    });
                    bothViewer.camera.moveEnd.addEventListener(() => syncCamera(bothViewer, [leftViewer, rightViewer, viewer]));
                    // Copy base imagery layers from main viewer to bothViewer as well
                    try { syncImageryLayers(viewer, bothViewer); } catch (e) { console.warn('Failed to sync imagery to bothViewer', e); }
                }

                // Sync initial camera position
                const pos = viewer.camera.position.clone();
                const dir = viewer.camera.direction.clone();
                const up = viewer.camera.up.clone();
                leftViewer.camera.setView({ destination: pos, orientation: { direction: dir, up: up } });
                rightViewer.camera.setView({ destination: pos, orientation: { direction: dir, up: up } });
                if (bothViewer) bothViewer.camera.setView({ destination: pos, orientation: { direction: dir, up: up } });

                // Initialize clip-paths for overlay reveal and pointer behavior
                if (leftContainer) leftContainer.style.clipPath = `inset(0 50% 0 0)`;
                if (rightContainer) rightContainer.style.clipPath = `inset(0 0 0 50%)`;
                // Enable pointer events on the top overlay side; underlying right overlay remains non-interactive
                if (leftContainer) leftContainer.style.pointerEvents = 'auto';
                if (rightContainer) rightContainer.style.pointerEvents = 'none';
                // Keep main container visible behind overlays
                if (mainContainer) mainContainer.style.display = 'block';

                // Auto-assign first two datasets
                // Default behavior: assign all visible datasets to BOTH (left + right)
                const visibleDatasets = datasets.filter(d => d.visible && d.dataSource);
                leftDatasets.clear();
                rightDatasets.clear();
                visibleDatasets.forEach(d => { leftDatasets.add(d.id); rightDatasets.add(d.id); });

                // Ensure slider is centered at 50% and clipPaths match
                const sliderEl = document.getElementById('compareSlider');
                const leftContainerEl = document.getElementById('leftContainer');
                const rightContainerEl = document.getElementById('rightContainer');
                if (sliderEl) sliderEl.style.left = '50%';
                if (leftContainerEl) leftContainerEl.style.clipPath = `inset(0 50% 0 0)`;
                if (rightContainerEl) rightContainerEl.style.clipPath = `inset(0 0 0 50%)`;

                updateCompareModeDataSources();

                // Initialize slider handlers now that DOM exists
                if (!compareSliderInitialized) {
                    initCompareSlider();
                    compareSliderInitialized = true;
                }
            } else {
                if (btn) { btn.classList.remove('active'); btn.setAttribute('aria-pressed', 'false'); }
                if (slider) { slider.style.display = 'none'; slider.classList.remove('active'); }
                // hide overlay container and make non-interactive so main viewer receives input
                if (viewerContainer) { viewerContainer.style.display = 'none'; viewerContainer.style.pointerEvents = 'none'; }
                if (leftContainer) leftContainer.style.pointerEvents = 'none';
                if (rightContainer) rightContainer.style.pointerEvents = 'none';

                // Move datasources back to main viewer
                datasets.forEach(dataset => {
                    if (dataset.dataSource && dataset.visible) {
                        // remove from overlay viewers if present
                        try { if (leftViewer && leftViewer.dataSources.contains(dataset.dataSource)) leftViewer.dataSources.remove(dataset.dataSource, false); } catch (e) {}
                        try { if (rightViewer && rightViewer.dataSources.contains(dataset.dataSource)) rightViewer.dataSources.remove(dataset.dataSource, false); } catch (e) {}
                        try { if (bothViewer && bothViewer.dataSources.contains(dataset.dataSource)) bothViewer.dataSources.remove(dataset.dataSource, false); } catch (e) {}
                        if (!viewer.dataSources.contains(dataset.dataSource)) viewer.dataSources.add(dataset.dataSource);
                        dataset.dataSource.show = true;
                    }
                    // Also remove any clones
                    if (dataset._leftClone) { try { leftViewer?.dataSources.remove(dataset._leftClone, false); } catch (e) {} dataset._leftClone = null; }
                    if (dataset._rightClone) { try { rightViewer?.dataSources.remove(dataset._rightClone, false); } catch (e) {} dataset._rightClone = null; }
                });
                // Destroy bothViewer if present
                try { if (bothViewer) { bothViewer.destroy(); bothViewer = null; } } catch (e) { console.warn('Error destroying bothViewer:', e); }

                leftDatasets.clear();
                rightDatasets.clear();
            }
    
            renderDatasetList();
        }

        function setDatasetSide(datasetId, side) {
                    // Normalize to the canonical id used in `datasets` (handles string vs number)
                    const ds = datasets.find(d => String(d.id) === String(datasetId));
                    const id = ds ? ds.id : datasetId;
                    if (side === 'left') {
                        leftDatasets.add(id);
                        rightDatasets.delete(id);
                    } else if (side === 'right') {
                        rightDatasets.add(id);
                        leftDatasets.delete(id);
                    } else if (side === 'both') {
                        leftDatasets.add(id);
                        rightDatasets.add(id);
                    }

            // Reconcile datasources between main viewer and overlay viewers
            updateCompareModeDataSources();
            renderDatasetList();
        }

        // Create a shallow clone of a DataSource suitable for display in a second viewer.
        // This supports points, polylines and polygons with basic color/size properties.
        function cloneDataSource(original, cloneSuffix) {
            if (!original) return null;
            try {
                const now = Cesium.JulianDate.now();
                const clone = new Cesium.CustomDataSource((original.name || 'DataSource') + (cloneSuffix ? ' ' + cloneSuffix : ' (clone)'));

                original.entities.values.forEach(e => {
                    const ent = { name: e.name };
                    // Position
                    if (e.position) {
                        try {
                            const pos = e.position.getValue(now);
                            if (pos) ent.position = pos;
                        } catch (err) { /* skip position */ }
                    }
                    // Point
                    if (e.point) {
                        ent.point = {};
                        try {
                            const color = e.point.color?.getValue(now);
                            if (color) ent.point.color = new Cesium.ConstantProperty(color.clone());
                        } catch (err) { }
                        try {
                            const px = e.point.pixelSize?.getValue(now);
                            if (px !== undefined) ent.point.pixelSize = new Cesium.ConstantProperty(px);
                        } catch (err) { }
                    }
                    // Polyline
                    if (e.polyline) {
                        ent.polyline = {};
                        try {
                            const positions = e.polyline.positions?.getValue(now);
                            if (positions) ent.polyline.positions = new Cesium.ConstantProperty(positions.slice());
                        } catch (err) { }
                        try {
                            const width = e.polyline.width?.getValue(now);
                            if (width !== undefined) ent.polyline.width = new Cesium.ConstantProperty(width);
                        } catch (err) { }
                        try {
                            const matColor = e.polyline.material?.color?.getValue(now);
                            if (matColor) ent.polyline.material = new Cesium.ColorMaterialProperty(matColor.clone());
                        } catch (err) { }
                    }
                    // Polygon
                    if (e.polygon) {
                        ent.polygon = {};
                        try {
                            const hierarchy = e.polygon.hierarchy?.getValue(now);
                            const positions = hierarchy?.positions || hierarchy;
                            if (positions) ent.polygon.hierarchy = new Cesium.ConstantProperty(new Cesium.PolygonHierarchy(positions.slice()));
                        } catch (err) { }
                        try {
                            const matColor = e.polygon.material?.color?.getValue(now);
                            if (matColor) ent.polygon.material = new Cesium.ColorMaterialProperty(matColor.clone());
                        } catch (err) { }
                        try {
                            const outline = e.polygon.outline?.getValue ? e.polygon.outline.getValue(now) : e.polygon.outline;
                            if (outline !== undefined) ent.polygon.outline = outline;
                        } catch (err) { }
                    }

                    // Add entity to clone (ignore entities that failed)
                    try { clone.entities.add(ent); } catch (err) { /* skip */ }
                });

                return clone;
            } catch (e) {
                console.warn('Failed to clone DataSource:', e);
                return null;
            }
        }

        function updateCompareModeDataSources() {
            // If compare is not active, keep clones hidden and ensure originals are visible in main viewer
            if (!compareMode) {
                datasets.forEach(dataset => {
                    if (dataset._leftClone) {
                        try { dataset._leftClone.show = false; } catch (e) {}
                    }
                    if (dataset._rightClone) {
                        try { dataset._rightClone.show = false; } catch (e) {}
                    }
                    if (dataset.dataSource) {
                        try { if (!viewer.dataSources.contains(dataset.dataSource)) viewer.dataSources.add(dataset.dataSource); } catch (e) {}
                        dataset.dataSource.show = !!dataset.visible;
                    }
                });
                viewer.scene.requestRender();
                return;
            }

            if (!leftViewer || !rightViewer) return;

            // Reconcile visibility without removing/adding repeatedly — create clones once and toggle .show
            datasets.forEach(dataset => {
                const id = dataset.id;
                const wantLeft = leftDatasets.has(id);
                const wantRight = rightDatasets.has(id);

                // If dataset has no datasource, nothing to do
                if (!dataset.dataSource) return;

                // Hide original in main viewer if overlays will show it
                if ((wantLeft || wantRight) && dataset.dataSource) {
                    try { dataset.dataSource.show = false; } catch (e) {}
                }

                // Handle BOTH: ensure clones exist and are shown/hidden appropriately
                const wantBoth = wantLeft && wantRight;
                if (wantBoth) {
                    // create clones if missing and add to overlay viewers
                    if (!dataset._leftClone) {
                        dataset._leftClone = cloneDataSource(dataset.dataSource, '(L)');
                        try { if (dataset._leftClone && leftViewer && !leftViewer.dataSources.contains(dataset._leftClone)) leftViewer.dataSources.add(dataset._leftClone); } catch (e) { console.warn('Failed to add left clone', e); }
                    } else {
                        try { if (leftViewer && !leftViewer.dataSources.contains(dataset._leftClone)) leftViewer.dataSources.add(dataset._leftClone); } catch (e) {}
                    }
                    if (!dataset._rightClone) {
                        dataset._rightClone = cloneDataSource(dataset.dataSource, '(R)');
                        try { if (dataset._rightClone && rightViewer && !rightViewer.dataSources.contains(dataset._rightClone)) rightViewer.dataSources.add(dataset._rightClone); } catch (e) { console.warn('Failed to add right clone', e); }
                    } else {
                        try { if (rightViewer && !rightViewer.dataSources.contains(dataset._rightClone)) rightViewer.dataSources.add(dataset._rightClone); } catch (e) {}
                    }

                    if (dataset._leftClone) dataset._leftClone.show = !!dataset.visible;
                    if (dataset._rightClone) dataset._rightClone.show = !!dataset.visible;
                } else {
                    // Left-only
                    if (wantLeft) {
                        if (!dataset._leftClone) {
                            dataset._leftClone = cloneDataSource(dataset.dataSource, '(L)');
                            try { if (dataset._leftClone && leftViewer && !leftViewer.dataSources.contains(dataset._leftClone)) leftViewer.dataSources.add(dataset._leftClone); } catch (e) { console.warn('Failed to add left clone', e); }
                        } else {
                            try { if (leftViewer && !leftViewer.dataSources.contains(dataset._leftClone)) leftViewer.dataSources.add(dataset._leftClone); } catch (e) {}
                        }
                        if (dataset._leftClone) dataset._leftClone.show = !!dataset.visible;
                    } else {
                        if (dataset._leftClone) dataset._leftClone.show = false;
                    }

                    // Right-only
                    if (wantRight) {
                        if (!dataset._rightClone) {
                            dataset._rightClone = cloneDataSource(dataset.dataSource, '(R)');
                            try { if (dataset._rightClone && rightViewer && !rightViewer.dataSources.contains(dataset._rightClone)) rightViewer.dataSources.add(dataset._rightClone); } catch (e) { console.warn('Failed to add right clone', e); }
                        } else {
                            try { if (rightViewer && !rightViewer.dataSources.contains(dataset._rightClone)) rightViewer.dataSources.add(dataset._rightClone); } catch (e) {}
                        }
                        if (dataset._rightClone) dataset._rightClone.show = !!dataset.visible;
                    } else {
                        if (dataset._rightClone) dataset._rightClone.show = false;
                    }
                }

                // If not wanted in overlays, show original in main viewer
                if (!wantLeft && !wantRight) {
                    try { if (dataset.dataSource && !viewer.dataSources.contains(dataset.dataSource)) viewer.dataSources.add(dataset.dataSource); } catch (e) {}
                    if (dataset.dataSource) dataset.dataSource.show = !!dataset.visible;
                }
            });

            viewer.scene.requestRender();
            // Ensure overlay viewer stacking order matches datasets array
            try { syncOverlayDataSourceOrder(leftViewer); } catch (e) {}
            try { syncOverlayDataSourceOrder(rightViewer); } catch (e) {}
        }

        // Slider functionality
        function initCompareSlider() {
                    // Ensure DOM exists
                    ensureCompareDOM();
                    const slider = document.getElementById('compareSlider');
                    const handle = document.getElementById('compareHandle');
                    const leftContainer = document.getElementById('leftContainer');
                    const rightContainer = document.getElementById('rightContainer');
                    if (!slider || !handle || !leftContainer || !rightContainer) return;
    
            let isDragging = false;
    
            handle.addEventListener('mousedown', (e) => {
                isDragging = true;
                e.preventDefault();
            });
            // Touch support
            handle.addEventListener('touchstart', (e) => { isDragging = true; e.preventDefault(); });
    
            function moveHandler(clientX) {
                if (!compareMode) return;
                const container = document.getElementById('viewerContainer');
                if (!container) return;
                const rect = container.getBoundingClientRect();
                const x = clientX - rect.left;
                const position = Math.max(0, Math.min(1, x / rect.width));
                slider.style.left = `${position * 100}%`;
                leftContainer.style.clipPath = `inset(0 ${(1 - position) * 100}% 0 0)`;
                rightContainer.style.clipPath = `inset(0 0 0 ${position * 100}%)`;
                // Toggle pointerEvents so underlying viewers receive input appropriately
                leftContainer.style.pointerEvents = 'auto';
                rightContainer.style.pointerEvents = 'none';
            }

            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                moveHandler(e.clientX);
            });
            document.addEventListener('touchmove', (e) => {
                if (!isDragging || !e.touches || e.touches.length === 0) return;
                moveHandler(e.touches[0].clientX);
            }, { passive: false });
    
            document.addEventListener('mouseup', () => { isDragging = false; });
            document.addEventListener('touchend', () => { isDragging = false; });
        }

        // Slider initialization is performed lazily when compare mode is enabled
        // to avoid creating overlay DOM that may interfere with the main viewer.

        window.toggleCompareMode = toggleCompareMode;
        window.setDatasetSide = setDatasetSide;
        

window.addEventListener('error', function(evt) {
    try {
        const err = evt.error;
        console.error('Global error captured:', {
            message: err ? err.message : evt.message,
            fileName: evt.filename || (err && err.fileName) || null,
            line: evt.lineno || (err && err.lineNumber) || null,
            column: evt.colno || (err && err.columnNumber) || null,
            stack: err && err.stack ? err.stack : null,
            event: evt
        });
    } catch (e) {
        console.error('Global error (fallback):', evt);
    }
});

window.addEventListener('unhandledrejection', function(evt) {
    try {
        console.error('Unhandled promise rejection captured:', {
            reason: evt.reason,
            promise: evt.promise
        });
    } catch (e) {
        console.error('Unhandled rejection (fallback):', evt);
    }
});