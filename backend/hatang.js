/**
 * hatang.js - Infrastructure (Hạ tầng) viewer backend module
 * Handles loading and managing 3D Tiles infrastructure data
 */

(function () {
    'use strict';

    // Store loaded infrastructure tilesets
    let hatangTileset = null;
    let hatangTilesetUrl = null; // Store URL for compare mode
    let hatangMode = false;

    /**
     * Show/hide loading indicator
     */
    function showHatangLoading(show) {
        let loader = document.getElementById('hatangLoadingIndicator');
        if (!loader && show) {
            loader = document.createElement('div');
            loader.id = 'hatangLoadingIndicator';
            loader.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 20px;
                border-radius: 5px;
                font-family: Arial, sans-serif;
                z-index: 2000;
            `;
            loader.textContent = 'Đang tải dữ liệu hạ tầng...';
            document.body.appendChild(loader);
        }
        if (loader) {
            loader.style.display = show ? 'block' : 'none';
        }
    }

    /**
     * Load Đà Nẵng infrastructure
     */
    async function loadDaNangHatang() {
        const viewer = window.viewer;
        if (!viewer) {
            alert('Viewer chưa sẵn sàng. Vui lòng đợi...');
            return null;
        }

        if (hatangMode) {
            console.log('Infrastructure data already loaded');
            return hatangTileset;
        }

        try {
            showHatangLoading(true);
            hatangMode = true;

            console.log('Loading Đà Nẵng infrastructure...');

            // Build absolute URL for tileset (like tree.js)
            const origin = window.location.origin; // e.g., http://localhost:8001
            const tilesetUrl = `${origin}/3dtiles_data/Tileset_Ha_tang/Tinh/danang.json`;

            // Store URL for later use (e.g., compare mode)
            hatangTilesetUrl = tilesetUrl;

            console.log(`Attempting tileset URL: ${tilesetUrl}`);

            const tileset = await Cesium.Cesium3DTileset.fromUrl(tilesetUrl, {
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

            // Configure tileset style
            tileset.style = new Cesium.Cesium3DTileStyle({
                show: true
            });

            // Add event listeners
            tileset.allTilesLoaded.addEventListener(() => {
                console.log(`✓ Tất cả tiles hạ tầng đã được tải`);
            });

            tileset.tileLoad.addEventListener((tile) => {
                console.log(`  - Đã tải tile:`, tile.content?.url || 'unknown');
            });

            tileset.tileFailed.addEventListener((error) => {
                console.error(`✗ Lỗi tải tile:`, error);
            });

            // Add to scene
            viewer.scene.primitives.add(tileset);
            hatangTileset = tileset;

            // Zoom to tileset
            await viewer.zoomTo(tileset, new Cesium.HeadingPitchRange(
                0,
                Cesium.Math.toRadians(-45),
                tileset.boundingSphere.radius * 2.0
            ));

            console.log(`✓ Đã tải thành công hạ tầng Đà Nẵng`);
            showHatangLoading(false);

            // Create dataset entry
            createHatangDataset();

            // Re-render dataset list
            if (window.renderDatasetList) {
                window.renderDatasetList();
            }

            return tileset;

        } catch (error) {
            console.error(`Lỗi khi tải hạ tầng:`, error);
            showHatangLoading(false);
            hatangMode = false;
            alert(`Không thể tải dữ liệu hạ tầng. Vui lòng kiểm tra console để biết chi tiết.\nError: ${error.message}`);
            return null;
        }
    }

    /**
     * Create a dataset entry for infrastructure data
     */
    function createHatangDataset() {
        if (!window.datasets) window.datasets = [];

        // Check if infrastructure dataset already exists
        const existing = window.datasets.find(d => d.id === 'HATANG');
        if (existing) {
            console.log('Infrastructure dataset already exists');
            return;
        }

        // Create fake district structure for compare mode compatibility
        const hatangDistrict = {
            id: 'hatang_danang',
            name: 'Hạ tầng Đà Nẵng',
            tilesetUrl: hatangTilesetUrl,
            tileset: hatangTileset,
            visible: true,
            color: '#3498db'
        };

        const hatangDataset = {
            id: 'HATANG',
            source: 'ui',
            name: '🏗️ Hạ tầng Đà Nẵng',
            type: 'HATANG',
            dataSource: null,
            model: null,
            position: null,
            visible: true,
            opacity: 1.0,
            tileset: hatangTileset,
            tilesets: [hatangTileset], // Array for compare mode compatibility
            tilesetUrl: hatangTilesetUrl, // Store URL for compare mode
            districts: [hatangDistrict], // Fake districts for compare mode compatibility
            layers: []
        };

        window.datasets.push(hatangDataset);
        window.datasets = window.datasets; // Trigger reactivity

        console.log('Created infrastructure dataset:', hatangDataset);
    }

    /**
     * Toggle infrastructure visibility
     */
    function toggleHatangVisibility(visible) {
        if (!hatangTileset) {
            console.warn('No hatang tileset loaded');
            return;
        }

        hatangTileset.show = visible;

        // Update dataset entry
        if (window.datasets) {
            const dataset = window.datasets.find(d => d.id === 'HATANG');
            if (dataset) {
                dataset.visible = visible;
            }
        }

        if (window.viewer) {
            window.viewer.scene.requestRender();
        }

        console.log(`Infrastructure: ${visible ? 'shown' : 'hidden'}`);
    }

    /**
     * Clear infrastructure data
     */
    function clearHatangData() {
        const viewer = window.viewer;
        if (!viewer) return;

        if (hatangTileset) {
            try {
                viewer.scene.primitives.remove(hatangTileset);
                hatangTileset = null;
                console.log('Infrastructure tileset removed');
            } catch (e) {
                console.error('Error removing infrastructure tileset:', e);
            }
        }

        // Remove infrastructure dataset from datasets array
        if (window.datasets) {
            const idx = window.datasets.findIndex(d => d.id === 'HATANG');
            if (idx >= 0) {
                window.datasets.splice(idx, 1);
            }
        }

        hatangMode = false;

        console.log('Infrastructure data cleared');

        // Re-render dataset list
        if (window.renderDatasetList) {
            window.renderDatasetList();
        }
    }

    /**
     * Main function to activate infrastructure viewer
     */
    window.loadHatangData = async function () {
        console.log('🏗️ Activating infrastructure viewer...');

        // Ensure Cesium viewer is initialized
        if (!window.viewer) {
            console.error('Cesium viewer not initialized');
            alert('Cesium viewer chưa được khởi tạo. Vui lòng đợi trang tải xong.');
            return;
        }

        // Enable depth testing for better 3D model display
        if (window.viewer.scene.globe) {
            window.viewer.scene.globe.depthTestAgainstTerrain = true;
        }

        // Configure scene lighting
        if (!window.viewer.scene.light) {
            window.viewer.scene.light = new Cesium.DirectionalLight({
                direction: new Cesium.Cartesian3(0.2, 0.5, -0.8)
            });
        }

        // Enable shadows for better visualization
        window.viewer.shadows = true;

        // Load Đà Nẵng infrastructure
        await loadDaNangHatang();

        console.log('✓ Infrastructure viewer activated');
    };

    // Export functions to window
    window.loadDaNangHatang = loadDaNangHatang;
    window.toggleHatangVisibility = toggleHatangVisibility;
    window.clearHatangData = clearHatangData;
    
    window.backendHatang = window.backendHatang || {};
    window.backendHatang.loadHatangData = window.loadHatangData;
    window.backendHatang.loadDaNangHatang = loadDaNangHatang;
    window.backendHatang.toggleHatangVisibility = toggleHatangVisibility;
    window.backendHatang.clearHatangData = clearHatangData;

    // console.log('✓ Hatang module loaded');
})();
