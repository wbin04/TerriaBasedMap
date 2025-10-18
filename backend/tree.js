// Tree viewer module: Load and manage 3D Tiles for tree data
(function(){
    'use strict';
    
    // Tree districts configuration
    const districts = [
        {
            id: 'district_1_hai_chau',
            name: 'Quận Hải Châu',
            path: 'tree/district_1_hai_chau/tileset.json',
            color: '#e74c3c',
            treeCount: 1500,
            tileset: null,
            visible: false
        },
        {
            id: 'district_2_an_hai',
            name: 'Quận An Hải',
            path: 'tree/district_2_an_hai/tileset.json',
            color: '#3498db',
            treeCount: 1200,
            tileset: null,
            visible: false
        },
        {
            id: 'district_3_son_tra',
            name: 'Quận Sơn Trà',
            path: 'tree/district_3_son_tra/tileset.json',
            color: '#2ecc71',
            treeCount: 1000,
            tileset: null,
            visible: false
        },
        {
            id: 'district_4_huong_tra',
            name: 'Huyện Hương Trà',
            path: 'tree/district_4_huong_tra/tileset.json',
            color: '#f39c12',
            treeCount: 1293,
            tileset: null,
            visible: false
        }
    ];

    let treeMode = false;
    let loadedTilesets = 0;

    // Load tree data for a specific district
    async function loadDistrictTileset(district) {
        const viewer = window.viewer;
        if (!viewer) {
            console.error('Viewer not initialized');
            return null;
        }

        try {
            console.log(`Loading ${district.name}...`);

            // Build absolute URL for tileset
            // The frontend server (port 8001) serves /wwwroot/tree explicitly
            const origin = window.location.origin; // e.g., http://localhost:8001
            const tilesetUrl = `${origin}/3dtiles_data/${district.path}`;
            
            // Store URL for later use (e.g., compare mode)
            district.tilesetUrl = tilesetUrl;
            
            console.log(`Attempting tileset URL: ${tilesetUrl}`);

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

            viewer.scene.primitives.add(tileset);
            district.tileset = tileset;
            district.visible = true;
            
            // Apply district color
            tileset.style = new Cesium.Cesium3DTileStyle({
                color: `color("${district.color}", 0.8)`,
                pointSize: 8
            });

            loadedTilesets++;
            
            console.log(`✓ Loaded: ${district.name}`);
            
            // Fly to first tileset
            if (loadedTilesets === 1) {
                await viewer.zoomTo(tileset, new Cesium.HeadingPitchRange(0, -0.5, tileset.boundingSphere.radius * 2.0));
            }
            
            return tileset;
            
        } catch (error) {
            console.error(`Error loading ${district.name}:`, error);
            alert(`Không thể tải dữ liệu cây xanh cho ${district.name}. Vui lòng kiểm tra đường dẫn file.`);
            return null;
        }
    }

    // Load all tree districts
    async function loadTreeData() {
        const viewer = window.viewer;
        if (!viewer) {
            alert('Viewer chưa sẵn sàng. Vui lòng đợi...');
            return;
        }

        if (treeMode) {
            console.log('Tree data already loaded');
            return;
        }

        try {
            treeMode = true;
            console.log('Loading tree data for all districts...');
            
            // Set camera to Da Nang
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(108.2022, 16.0544, 15000),
                orientation: {
                    heading: Cesium.Math.toRadians(0),
                    pitch: Cesium.Math.toRadians(-45),
                    roll: 0.0
                },
                duration: 2
            });

            // Load all district tilesets
            for (const district of districts) {
                await loadDistrictTileset(district);
            }
            
            console.log(`✓ Successfully loaded ${loadedTilesets} tree tilesets`);
            
            // Create tree dataset entry
            createTreeDataset();
            
            // Render dataset list to show tree entry
            if (window.renderDatasetList) {
                window.renderDatasetList();
            }
            
        } catch (error) {
            console.error('Error loading tree data:', error);
            alert('Lỗi khi tải dữ liệu cây xanh: ' + error.message);
            treeMode = false;
        }
    }

    // Create a dataset entry for tree data
    function createTreeDataset() {
        if (!window.datasets) window.datasets = [];
        
        // Check if tree dataset already exists
        const existing = window.datasets.find(d => d.id === 'TREES');
        if (existing) {
            console.log('Tree dataset already exists');
            return;
        }

        const totalTrees = districts.reduce((sum, d) => sum + d.treeCount, 0);
        
        const treeDataset = {
            id: 'TREES',
            source: 'ui',
            name: `🌳 Cây xanh Đà Nẵng (${totalTrees.toLocaleString()} cây)`,
            type: 'TREE',
            dataSource: null,
            model: null,
            position: null,
            visible: true,
            opacity: 0.8,
            // Store tilesets for compare mode
            tilesets: districts.map(d => d.tileset).filter(t => t),
            districts: districts, // Keep reference to districts for layer control
            layers: districts.map(d => ({
                name: d.name,
                visible: d.visible,
                color: d.color,
                count: d.treeCount,
                districtId: d.id
            }))
        };

        window.datasets.push(treeDataset);
        window.datasets = window.datasets; // Trigger reactivity
        
        console.log('Created tree dataset:', treeDataset);
    }

    // Toggle district visibility
    function toggleTreeDistrict(districtId, visible) {
        const district = districts.find(d => d.id === districtId);
        if (!district || !district.tileset) return;
        
        district.visible = visible;
        district.tileset.show = visible;
        
        if (window.viewer) {
            window.viewer.scene.requestRender();
        }
        
        console.log(`${district.name}: ${visible ? 'shown' : 'hidden'}`);
    }

    // Clear all tree data
    function clearTreeData() {
        const viewer = window.viewer;
        if (!viewer) return;

        districts.forEach(district => {
            if (district.tileset) {
                try {
                    viewer.scene.primitives.remove(district.tileset);
                    district.tileset = null;
                    district.visible = false;
                } catch (e) {
                    console.error(`Error removing tileset for ${district.name}:`, e);
                }
            }
        });

        // Remove tree dataset from datasets array
        if (window.datasets) {
            const idx = window.datasets.findIndex(d => d.id === 'TREES');
            if (idx >= 0) {
                window.datasets.splice(idx, 1);
            }
        }

        loadedTilesets = 0;
        treeMode = false;
        
        console.log('Tree data cleared');
        
        // Re-render dataset list
        if (window.renderDatasetList) {
            window.renderDatasetList();
        }
    }

    // Get tree statistics
    function getTreeStats() {
        const totalTrees = districts.reduce((sum, d) => sum + d.treeCount, 0);
        const visibleDistricts = districts.filter(d => d.visible).length;
        const loadedCount = districts.filter(d => d.tileset !== null).length;
        
        return {
            totalTrees,
            visibleDistricts,
            totalDistricts: districts.length,
            loadedTilesets: loadedCount,
            districts: districts.map(d => ({
                id: d.id,
                name: d.name,
                treeCount: d.treeCount,
                visible: d.visible,
                loaded: d.tileset !== null
            }))
        };
    }

    // Expose API
    window.loadTreeData = loadTreeData;
    window.clearTreeData = clearTreeData;
    window.toggleTreeDistrict = toggleTreeDistrict;
    window.getTreeStats = getTreeStats;
    
    window.backendTree = window.backendTree || {};
    window.backendTree.loadTreeData = loadTreeData;
    window.backendTree.clearTreeData = clearTreeData;
    window.backendTree.toggleTreeDistrict = toggleTreeDistrict;
    window.backendTree.getTreeStats = getTreeStats;
    window.backendTree.districts = districts;
    
    // console.log('Tree module loaded');
})();
