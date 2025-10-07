const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const app = express();
// Serve generated 3D Tiles folders
app.use('/3dtiles_data', express.static(path.join(__dirname, '3dtiles_data')));
const PORT = 5000;

// Cache configuration
const CACHE_MODELS = new Map();
const CACHE_TTL = 60 * 1000; // 60 seconds in milliseconds

// Middleware
app.use(cors()); // Allow all domains to call API
// Log all incoming requests
app.use((req, res, next) => {
    console.log(`[REQ] ${req.method} ${req.path}`);
    next();
});
// Enable CORS preflight for GeoJSON save endpoint
app.options('/geojsons', cors());
app.use(express.json({ limit: '50mb' }));

// PostgreSQL connection pool
const pool = new Pool({
    host: 'localhost',
    database: 'dthubdb',
    user: 'dthubuser',
    password: '123',
    port: 5432,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});


// GeoJSON to 3D Tiles conversion logic (from convert_to_3dtiles.html)
function convertGeoJSONTo3DTiles(geoJsonData, fileName) {
    try {
        // Validate GeoJSON
        if (!validateGeoJSON(geoJsonData)) {
            return { success: false, error: 'File không phải GeoJSON hợp lệ' };
        }

        // Process features
        let features = geoJsonData.features || [];
        if (geoJsonData.type === 'Feature') {
            features = [geoJsonData];
        }

        if (features.length === 0) {
            return { success: false, error: 'Không tìm thấy features trong file' };
        }

        console.log(`[CONVERT] Found ${features.length} features`);

        // Calculate bounds
        const bounds = calculateBounds(geoJsonData);
        if (!bounds) {
            return { success: false, error: 'Không thể tính toán bounds' };
        }

        console.log(`[CONVERT] Bounds: [${bounds.join(', ')}]`);

        // Create tileset.json
        const tileset = createTilesetJSON(bounds, fileName);

        // Create B3DM tile
        const b3dmData = createB3DMWithGeometry(geoJsonData, bounds);

        // Create debug info
        const debugInfo = createDebugInfo(geoJsonData, fileName);

        console.log(`[CONVERT] Successfully converted: ${fileName}`);

        return {
            success: true,
            tileset: tileset,
            b3dm: b3dmData,
            debugInfo: debugInfo,
            featuresCount: features.length,
            bounds: bounds
        };

    } catch (error) {
        console.error('[CONVERT] Error:', error);
        return { success: false, error: error.message };
    }
}

function validateGeoJSON(data) {
    if (!data || typeof data !== 'object') return false;
    
    const type = data.type?.toLowerCase();
    return type === 'featurecollection' || 
           type === 'feature' || 
           type === 'geometrycollection' ||
           Array.isArray(data.features) ||
           data.geometry;
}

function calculateBounds(geoJsonData) {
    let minLon = Infinity, minLat = Infinity;
    let maxLon = -Infinity, maxLat = -Infinity;
    let validCoordsFound = false;

    const features = geoJsonData.features || [geoJsonData];

    for (const feature of features) {
        const geometry = feature.geometry;
        if (!geometry || !geometry.coordinates) continue;

        const processCoordinates = (coords, depth = 0) => {
            if (depth === 0 && typeof coords[0] === 'number' && coords.length >= 2) {
                // Point coordinate
                const [lon, lat] = coords;
                if (lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90) {
                    minLon = Math.min(minLon, lon);
                    maxLon = Math.max(maxLon, lon);
                    minLat = Math.min(minLat, lat);
                    maxLat = Math.max(maxLat, lat);
                    validCoordsFound = true;
                }
            } else if (Array.isArray(coords)) {
                for (const subCoords of coords) {
                    processCoordinates(subCoords, depth - 1);
                }
            }
        };

        // Determine depth based on geometry type
        let depth = 0;
        switch (geometry.type) {
            case 'Point': depth = 0; break;
            case 'MultiPoint':
            case 'LineString': depth = 1; break;
            case 'MultiLineString':
            case 'Polygon': depth = 2; break;
            case 'MultiPolygon': depth = 3; break;
        }

        processCoordinates(geometry.coordinates, depth);
    }

    if (!validCoordsFound) return null;
    return [minLon, minLat, maxLon, maxLat];
}

function createTilesetJSON(bounds, fileName) {
    const [minLon, minLat, maxLon, maxLat] = bounds;
    const geometricError = 1000;
    const maxHeight = 1000;

    const width = maxLon - minLon;
    const height = maxLat - minLat;
    const calculatedError = Math.max(width, height) * 111000; // Convert degrees to meters
    const finalGeometricError = Math.max(calculatedError, geometricError);

    return {
        asset: {
            version: "1.0",
            generator: "GeoJSON to 3D Tiles Converter (JavaScript)",
            tilesetVersion: "1.0.0"
        },
        properties: {},
        geometricError: finalGeometricError,
        root: {
            boundingVolume: {
                region: [
                    minLon * Math.PI / 180,  // west
                    minLat * Math.PI / 180,  // south
                    maxLon * Math.PI / 180,  // east
                    maxLat * Math.PI / 180,  // north
                    0.0,                     // minimum height
                    maxHeight                // maximum height
                ]
            },
            geometricError: finalGeometricError / 2,
            refine: "REPLACE",
            content: {
                uri: "tile.b3dm"
            }
        }
    };
}

function createB3DMWithGeometry(geoJsonData, bounds) {
    const features = geoJsonData.features || [geoJsonData];
    
    // Create feature table
    const featureTable = {
        BATCH_LENGTH: features.length,
        RTC_CENTER: [0.0, 0.0, 0.0]
    };

    // Create batch table with geometry data
    const batchTable = createBatchTable(features);

    // Create simple glTF geometry
    const gltfData = createSimpleGLTFGeometry(bounds);

    // Serialize tables
    const featureTableJSON = Buffer.from(JSON.stringify(featureTable), 'utf8');
    const batchTableJSON = Buffer.from(JSON.stringify(batchTable), 'utf8');

    // Padding to 4-byte alignment
    const featureTableJSONPadded = padTo4Bytes(featureTableJSON);
    const batchTableJSONPadded = padTo4Bytes(batchTableJSON);
    const gltfDataPadded = padTo4Bytes(gltfData);

    // B3DM header
    const featureTableJSONLength = featureTableJSONPadded.length;
    const featureTableBinaryLength = 0;
    const batchTableJSONLength = batchTableJSONPadded.length;
    const batchTableBinaryLength = 0;
    const gltfLength = gltfDataPadded.length;

    const headerLength = 28;
    const totalLength = headerLength + featureTableJSONLength + featureTableBinaryLength +
                       batchTableJSONLength + batchTableBinaryLength + gltfLength;

    // Create B3DM data
    const b3dmData = Buffer.alloc(totalLength);
    let offset = 0;

    // Header
    b3dmData.write('b3dm', offset, 4, 'ascii'); offset += 4;
    b3dmData.writeUInt32LE(1, offset); offset += 4; // version
    b3dmData.writeUInt32LE(totalLength, offset); offset += 4;
    b3dmData.writeUInt32LE(featureTableJSONLength, offset); offset += 4;
    b3dmData.writeUInt32LE(featureTableBinaryLength, offset); offset += 4;
    b3dmData.writeUInt32LE(batchTableJSONLength, offset); offset += 4;
    b3dmData.writeUInt32LE(batchTableBinaryLength, offset); offset += 4;

    // Data
    featureTableJSONPadded.copy(b3dmData, offset); offset += featureTableJSONLength;
    batchTableJSONPadded.copy(b3dmData, offset); offset += batchTableJSONLength;
    gltfDataPadded.copy(b3dmData, offset);

    console.log(`[CONVERT] B3DM size: ${totalLength.toLocaleString()} bytes`);
    return b3dmData;
}

function createBatchTable(features) {
    const batchTable = {};

    // Store geometry data
    const geometryData = features.map(feature => 
        feature.geometry ? JSON.stringify(feature.geometry) : null
    );
    batchTable.geometry = geometryData;

    // Analyze properties to find important keys
    const propertyStats = {};
    
    features.forEach(feature => {
        const properties = feature.properties || {};
        Object.keys(properties).forEach(key => {
            if (!propertyStats[key]) {
                propertyStats[key] = { count: 0, samples: [] };
            }
            propertyStats[key].count++;
            if (propertyStats[key].samples.length < 3) {
                propertyStats[key].samples.push(properties[key]);
            }
        });
    });

    // Select important properties
    const importantKeys = Object.keys(propertyStats).filter(key => {
        const stat = propertyStats[key];
        const frequency = stat.count / features.length;
        
        // Include if appears in more than 50% of features
        if (frequency >= 0.5) {
            // Include if has important keywords
            const hasImportantKeyword = ['name', 'id', 'code', 'tinh', 'xa', 'huyen', 'admin', 'level']
                .some(keyword => key.toLowerCase().includes(keyword));
            
            if (hasImportantKeyword) return true;
            
            // Include if values are short
            const hasShortValues = stat.samples.every(val => 
                val === null || val === undefined || String(val).length < 100
            );
            
            if (hasShortValues) return true;
        }
        
        return false;
    });

    // Add properties to batch table
    importantKeys.forEach(key => {
        batchTable[key] = features.map(feature => {
            const value = feature.properties?.[key];
            if (value !== null && value !== undefined && typeof value === 'object') {
                return JSON.stringify(value);
            }
            return value;
        });
    });

    console.log(`[CONVERT] Batch table keys: ${Object.keys(batchTable).join(', ')}`);
    return batchTable;
}

function createSimpleGLTFGeometry(bounds) {
    const [minLon, minLat, maxLon, maxLat] = bounds;
    
    const gltf = {
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{
            primitives: [{
                attributes: { POSITION: 0 },
                indices: 1,
                material: 0
            }]
        }],
        materials: [{
            pbrMetallicRoughness: {
                baseColorFactor: [0.8, 0.8, 0.8, 1.0],
                metallicFactor: 0.0,
                roughnessFactor: 1.0
            }
        }],
        accessors: [
            {
                bufferView: 0,
                byteOffset: 0,
                componentType: 5126,  // FLOAT
                count: 4,
                type: "VEC3",
                min: [minLon, minLat, 0],
                max: [maxLon, maxLat, 100]
            },
            {
                bufferView: 1,
                byteOffset: 0,
                componentType: 5123,  // UNSIGNED_SHORT
                count: 6,
                type: "SCALAR"
            }
        ],
        bufferViews: [
            {
                buffer: 0,
                byteOffset: 0,
                byteLength: 48,  // 4 vertices * 3 floats * 4 bytes
                target: 34962   // ARRAY_BUFFER
            },
            {
                buffer: 0,
                byteOffset: 48,
                byteLength: 12,  // 6 indices * 2 bytes
                target: 34963   // ELEMENT_ARRAY_BUFFER
            }
        ],
        buffers: [{
            byteLength: 60  // 48 + 12
        }]
    };

    // Create vertices (4 corners of bounds)
    const vertices = Buffer.alloc(48);
    let offset = 0;
    // bottom-left
    vertices.writeFloatLE(minLon, offset); offset += 4;
    vertices.writeFloatLE(minLat, offset); offset += 4;
    vertices.writeFloatLE(0.0, offset); offset += 4;
    // bottom-right
    vertices.writeFloatLE(maxLon, offset); offset += 4;
    vertices.writeFloatLE(minLat, offset); offset += 4;
    vertices.writeFloatLE(0.0, offset); offset += 4;
    // top-right
    vertices.writeFloatLE(maxLon, offset); offset += 4;
    vertices.writeFloatLE(maxLat, offset); offset += 4;
    vertices.writeFloatLE(100.0, offset); offset += 4;
    // top-left
    vertices.writeFloatLE(minLon, offset); offset += 4;
    vertices.writeFloatLE(maxLat, offset); offset += 4;
    vertices.writeFloatLE(100.0, offset);

    // Create indices (2 triangles)
    const indices = Buffer.alloc(12);
    offset = 0;
    indices.writeUInt16LE(0, offset); offset += 2;
    indices.writeUInt16LE(1, offset); offset += 2;
    indices.writeUInt16LE(2, offset); offset += 2;
    indices.writeUInt16LE(0, offset); offset += 2;
    indices.writeUInt16LE(2, offset); offset += 2;
    indices.writeUInt16LE(3, offset);

    // Create GLB (Binary glTF)
    const jsonData = Buffer.from(JSON.stringify(gltf), 'utf8');
    let jsonLength = jsonData.length;

    // Pad JSON to 4-byte boundary
    const jsonPadding = (4 - (jsonLength % 4)) % 4;
    const paddedJsonData = Buffer.alloc(jsonLength + jsonPadding);
    jsonData.copy(paddedJsonData);
    paddedJsonData.fill(0x20, jsonLength); // fill padding with spaces
    jsonLength = paddedJsonData.length;

    // Create binary data
    const binaryData = Buffer.concat([vertices, indices]);
    let binaryLength = binaryData.length;
    const binaryPadding = (4 - (binaryLength % 4)) % 4;
    const paddedBinaryData = Buffer.alloc(binaryLength + binaryPadding);
    binaryData.copy(paddedBinaryData);
    binaryLength = paddedBinaryData.length;

    // GLB header (12 bytes)
    const glbHeader = Buffer.alloc(12);
    glbHeader.writeUInt32LE(0x46546C67, 0); // magic 'glTF'
    glbHeader.writeUInt32LE(2, 4);          // version
    glbHeader.writeUInt32LE(12 + 8 + jsonLength + 8 + binaryLength, 8); // total length

    // JSON chunk header (8 bytes)
    const jsonChunkHeader = Buffer.alloc(8);
    jsonChunkHeader.writeUInt32LE(jsonLength, 0);
    jsonChunkHeader.writeUInt32LE(0x4E4F534A, 4); // 'JSON'

    // Binary chunk header (8 bytes)
    const binaryChunkHeader = Buffer.alloc(8);
    binaryChunkHeader.writeUInt32LE(binaryLength, 0);
    binaryChunkHeader.writeUInt32LE(0x004E4942, 4); // 'BIN\0'

    // Combine all parts
    return Buffer.concat([
        glbHeader,
        jsonChunkHeader,
        paddedJsonData,
        binaryChunkHeader,
        paddedBinaryData
    ]);
}

function createDebugInfo(geoJsonData, fileName) {
    const features = geoJsonData.features || [geoJsonData];
    const geometryTypes = {};
    const propertyKeys = {};
    const sampleFeatures = [];

    features.forEach((feature, index) => {
        const geometry = feature.geometry || {};
        const properties = feature.properties || {};

        // Count geometry types
        const geomType = geometry.type || 'Unknown';
        geometryTypes[geomType] = (geometryTypes[geomType] || 0) + 1;

        // Analyze properties
        Object.keys(properties).forEach(key => {
            if (!propertyKeys[key]) {
                propertyKeys[key] = { count: 0, types: new Set(), samples: [] };
            }
            propertyKeys[key].count++;
            propertyKeys[key].types.add(typeof properties[key]);
            if (propertyKeys[key].samples.length < 3) {
                propertyKeys[key].samples.push(properties[key]);
            }
        });

        // Sample features
        if (index < 3) {
            sampleFeatures.push({
                index,
                geometryType: geomType,
                properties: Object.keys(properties).reduce((acc, key) => {
                    const value = properties[key];
                    if (typeof value === 'string' && value.length < 200) {
                        acc[key] = value;
                    } else if (typeof value !== 'object') {
                        acc[key] = value;
                    }
                    return acc;
                }, {})
            });
        }
    });

    // Convert property analysis
    const propertyAnalysis = {};
    Object.keys(propertyKeys).forEach(key => {
        const info = propertyKeys[key];
        propertyAnalysis[key] = {
            count: info.count,
            frequency: info.count / features.length,
            types: Array.from(info.types),
            samples: info.samples
        };
    });

    return {
        fileName,
        totalFeatures: features.length,
        geometryTypes,
        propertyKeys: propertyAnalysis,
        bounds: calculateBounds(geoJsonData),
        sampleFeatures
    };
}

function padTo4Bytes(data) {
    const remainder = data.length % 4;
    if (remainder === 0) return data;
    
    const padding = 4 - remainder;
    const result = Buffer.alloc(data.length + padding);
    data.copy(result);
    // Fill padding with spaces
    result.fill(0x20, data.length);
    return result;
}

// Test database connection
pool.on('connect', () => {
    console.log('[DB] Connected to PostgreSQL');
});

pool.on('error', (err) => {
    console.error('[DB] Unexpected error on idle client', err);
    process.exit(-1);
});

// Main API endpoint
app.get('/models', async (req, res) => {
    const bbox = req.query.bbox; // format: "minLon,minLat,maxLon,maxLat"
    const zoomLevel = parseInt(req.query.zoom) || 1;
    const lod = req.query.lod || null;
    const categoryParam = req.query.category || null;
    
    const cacheKey = `bbox=${bbox}|zoom=${zoomLevel}|lod=${lod}`;
    const now = Date.now();
    
    // Check cache
    const cacheEntry = CACHE_MODELS.get(cacheKey);
    if (cacheEntry && now - cacheEntry.ts < CACHE_TTL) {
        console.log(`[API] Cache hit for ${cacheKey}`);
        return res.json(cacheEntry.data);
    }

    console.log(`[API] bbox=${bbox}, zoom_level=${zoomLevel}`);

    try {
        const client = await pool.connect();
        
        // Auto adjust tolerance based on zoom; override for viewPark => categoryParam
        let simplificationTolerance, minArea, maxResults;
        if (categoryParam) {
            // viewPark: include all features within viewport, no simplification
            simplificationTolerance = 0;
            minArea = 0;
            maxResults = 10000;
        } else if (zoomLevel >= 15) {
            simplificationTolerance = 0.00001;
            minArea = 0.0001;
            maxResults = 1000;
        } else if (zoomLevel >= 12) {
            simplificationTolerance = 0.0001;
            minArea = 0.001;
            maxResults = 500;
        } else if (zoomLevel >= 8) {
            simplificationTolerance = 0.001;
            minArea = 0.01;
            maxResults = 200;
        } else if (zoomLevel >= 5) {
            simplificationTolerance = 0.02;
            minArea = 0.05;
            maxResults = 100;
        } else {
            simplificationTolerance = 0.05;
            minArea = 0.1;
            maxResults = 50;
        }

        // Filter by category if provided (via category query) or fallback to lod
        let categoryFilter = '';
        if (categoryParam) {
            categoryFilter = ` AND category = '${categoryParam}'`;
        } else if (lod) {
            categoryFilter = ` AND category = '${lod}'`;
        }

        let baseQuery = `
         SELECT id, url, longitude, latitude, height, heading, pitch, roll, scale,
             ST_AsGeoJSON(ST_Simplify(geom, $1)) as simplified_geom,
                   ST_Area(geom) as area
            FROM models_test
            WHERE active = true AND "isPublic" = true AND ST_Area(geom) > $2${categoryFilter}
        `;
        
        const params = [simplificationTolerance, minArea];
        let paramCount = 2;

    // Apply bbox filtering for all viewport-based requests (viewAdmin and viewPark)
    if (bbox) {
            try {
                const [minLon, minLat, maxLon, maxLat] = bbox.split(',').map(parseFloat);
                baseQuery += `
                    AND ST_Intersects(geom, ST_MakeEnvelope($${paramCount + 1}, $${paramCount + 2}, $${paramCount + 3}, $${paramCount + 4}, 4326))
                `;
                params.push(minLon, minLat, maxLon, maxLat);
                paramCount += 4;
            } catch (error) {
                console.error(`[API] Invalid bbox: ${bbox}`, error);
            }
        }

        baseQuery += ` ORDER BY ST_Area(geom) DESC LIMIT $${paramCount + 1}`;
        params.push(maxResults);

        console.log(`[API] SQL: ${baseQuery}`);
        console.log(`[API] Params: ${params}`);

        const result = await client.query(baseQuery, params);
        const rows = result.rows;

        const models = rows.map(row => {
            const modelData = {
                id: row.id,
                url: row.url,
                longitude: row.longitude,
                latitude: row.latitude,
                position: {
                    longitude: row.longitude,
                    latitude: row.latitude,
                    height: row.height
                },
                rotation: {
                    heading: row.heading,
                    pitch: row.pitch,
                    roll: row.roll
                },
                scale: row.scale,
                area: row.area ? parseFloat(row.area) : 0
            };

            if (row.simplified_geom) {
                try {
                    modelData.simplified_geom = JSON.parse(row.simplified_geom);
                } catch (error) {
                    console.warn(`[API] Failed to parse simplified_geom for model ${row.id}:`, error);
                }
            }

            return modelData;
        });

        console.log(`[API] Returned ${models.length} models`);
        
        client.release();

        const responseData = {
            models: models,
            total_count: models.length,
            zoom_level: zoomLevel,
            simplification_tolerance: simplificationTolerance,
            bbox: bbox
        };

        // Save to cache
        CACHE_MODELS.set(cacheKey, {
            ts: now,
            data: responseData
        });

        res.json(responseData);

    } catch (error) {
        console.error('[API] Database error:', error);
        res.status(500).json({
            error: 'Database error',
            message: error.message
        });
    }
});

// Sửa endpoint models-by-polygon với consistent LOD và loại bỏ cache issue
app.post('/models-by-polygon', cors(), async (req, res) => {
    const { polygon, category, cameraHeight } = req.body;
    
    if (!polygon || !polygon.coordinates) {
        return res.status(400).json({ error: 'Missing polygon data' });
    }
    
    console.log(`[API] Loading models by polygon, category: ${category || 'all'}, cameraHeight: ${cameraHeight || 'unknown'}`);
    
    try {
        const client = await pool.connect();
        
        // Convert GeoJSON polygon to PostGIS format
        const polygonWKT = `POLYGON((${polygon.coordinates[0].map(coord => `${coord[0]} ${coord[1]}`).join(', ')}))`;
        
        console.log(`[API] Polygon WKT: ${polygonWKT}`);
        
        // Test if polygon is valid
        const validationQuery = `SELECT ST_IsValid(ST_GeomFromText($1, 4326)) as is_valid`;
        const validationResult = await client.query(validationQuery, [polygonWKT]);
        console.log(`[API] Polygon validation:`, validationResult.rows[0]);
        
        if (!validationResult.rows[0].is_valid) {
            client.release();
            return res.status(400).json({ error: 'Invalid polygon geometry' });
        }
        
        // FIXED: More conservative LOD parameters to avoid missing data
        let simplificationTolerance, minArea, maxResults;
        const height = cameraHeight || 100000;
        
        // Make LOD thresholds more conservative
        if (height > 1000000) {
            // Very high - only largest features
            simplificationTolerance = 0.01;
            minArea = 10;
            maxResults = 50;
        } else if (height > 500000) {
            // High - large features
            simplificationTolerance = 0.005;
            minArea = 1;
            maxResults = 100;
        } else if (height > 200000) {
            // Medium-high - medium to large features
            simplificationTolerance = 0.002;
            minArea = 0.1;
            maxResults = 200;
        } else if (height > 100000) {
            // Medium - most features
            simplificationTolerance = 0.001;
            minArea = 0.01;
            maxResults = 300;
        } else if (height > 50000) {
            // Low - small features included
            simplificationTolerance = 0.0005;
            minArea = 0.001;
            maxResults = 400;
        } else {
            // Very low - all features
            simplificationTolerance = 0.0001;
            minArea = 0;
            maxResults = 500;
        }
        
        console.log(`[API] LOD params - Height: ${height}, tolerance: ${simplificationTolerance}, minArea: ${minArea}, maxResults: ${maxResults}`);
        
        // Build base query - FIXED: Add explicit ordering and consistent parameters
        let baseQuery = `
            SELECT id, name, url, longitude, latitude, height, heading, pitch, roll, scale,
                   ST_AsGeoJSON(ST_Simplify(geom, $2)) as simplified_geom,
                   ST_Area(geom) as area,
                   category,
                   ST_Area(geom) as sort_area
            FROM models_test
            WHERE active = true 
            AND "isPublic" = true
            AND ST_Intersects(geom, ST_GeomFromText($1, 4326))
            AND ST_Area(geom) > $3
        `;
        
        let params = [polygonWKT, simplificationTolerance, minArea];
        let paramCount = 3;
        
        // Add category filter if provided
        if (category) {
            paramCount++;
            baseQuery += ` AND category = $${paramCount}`;
            params.push(category);
        }
        
        // FIXED: Consistent ordering - always by area DESC, then by id for deterministic results
        baseQuery += ` ORDER BY sort_area DESC, id ASC LIMIT $${paramCount + 1}`;
        params.push(maxResults);
        
        console.log(`[API] Final SQL: ${baseQuery}`);
        console.log(`[API] Final Params:`, params);
        
        // Execute query
        const result = await client.query(baseQuery, params);
        const rows = result.rows;
        
        console.log(`[API] Query returned ${rows.length} rows`);
        
        // Debug query to show what's available without LOD filters
        if (rows.length < 5) {
            console.log(`[API] Low result count, running debug query...`);
            
            const debugQuery = `
                SELECT id, name, category, ST_Area(geom) as area,
                       ST_X(ST_Centroid(geom)) as center_lon,
                       ST_Y(ST_Centroid(geom)) as center_lat
                FROM models_test
                WHERE active = true AND "isPublic" = true
                AND ST_Intersects(geom, ST_GeomFromText($1, 4326))
                ${category ? 'AND category = $2' : ''}
                ORDER BY ST_Area(geom) DESC
                LIMIT 20
            `;
            
            const debugParams = category ? [polygonWKT, category] : [polygonWKT];
            const debugResult = await client.query(debugQuery, debugParams);
            console.log(`[API] All matching records (without LOD filter):`, debugResult.rows);
        }
        
        // Process results
        const models = rows.map(row => {
            let simplifiedGeom = null;
            try {
                if (row.simplified_geom) {
                    simplifiedGeom = JSON.parse(row.simplified_geom);
                }
            } catch (e) {
                console.warn('Error parsing simplified_geom:', e);
            }
            
            return {
                id: row.id,
                name: row.name,
                url: row.url,
                longitude: row.longitude,
                latitude: row.latitude,
                height: row.height || 0,
                heading: row.heading || 0,
                pitch: row.pitch || 0,
                roll: row.roll || 0,
                scale: row.scale || 1.0,
                simplified_geom: simplifiedGeom,
                area: parseFloat(row.area || 0),
                category: row.category
            };
        });
        
        console.log(`[API] Processed ${models.length} models in polygon`);
        
        client.release();
        
        res.json({
            models: models,
            total_count: models.length,
            polygon: polygon,
            camera_height: height,
            simplification_tolerance: simplificationTolerance,
            min_area: minArea,
            max_results: maxResults,
            category_filter: category,
            query_timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[API] Database error in models-by-polygon:', error);
        res.status(500).json({
            error: 'Database error',
            message: error.message
        });
    }
});

// FIXED: Thêm hàm để clear cache khi cần
function clearPolygonCache() {
    // Nếu có cache cho polygon queries, clear nó ở đây
    console.log('[API] Polygon cache cleared');
}

// Enhanced debug endpoint với detailed polygon testing  
app.get('/debug-polygon-data', cors(), async (req, res) => {
    try {
        const client = await pool.connect();
        
        // Check total count and categories
        const countQuery = `
            SELECT 
                COUNT(*) as total_count,
                COUNT(DISTINCT category) as category_count
            FROM models_test 
            WHERE active = true AND "isPublic" = true;
        `;
        
        const categoryQuery = `
            SELECT category, COUNT(*) as count,
                   AVG(ST_Area(geom)) as avg_area,
                   MIN(ST_Area(geom)) as min_area,
                   MAX(ST_Area(geom)) as max_area
            FROM models_test 
            WHERE active = true AND "isPublic" = true
            GROUP BY category
            ORDER BY count DESC;
        `;
        
        const sampleQuery = `
            SELECT id, name, category, longitude, latitude, 
                   ST_Area(geom) as area,
                   ST_X(ST_Centroid(geom)) as center_lon,
                   ST_Y(ST_Centroid(geom)) as center_lat
            FROM models_test 
            WHERE active = true AND "isPublic" = true
            ORDER BY ST_Area(geom) DESC
            LIMIT 15;
        `;
        
        const countResult = await client.query(countQuery);
        const categoryResult = await client.query(categoryQuery);
        const sampleResult = await client.query(sampleQuery);
        
        client.release();
        
        res.json({
            total: countResult.rows[0],
            categories: categoryResult.rows,
            samples: sampleResult.rows,
            debug_timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[API] Debug error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Debug endpoint to check available data
app.get('/debug-polygon-data', cors(), async (req, res) => {
    try {
        const client = await pool.connect();
        
        // Check total count and categories
        const countQuery = `
            SELECT 
                COUNT(*) as total_count,
                COUNT(DISTINCT category) as category_count
            FROM models_test 
            WHERE active = true AND "isPublic" = true;
        `;
        
        const categoryQuery = `
            SELECT category, COUNT(*) as count
            FROM models_test 
            WHERE active = true AND "isPublic" = true
            GROUP BY category
            ORDER BY count DESC;
        `;
        
        const sampleQuery = `
            SELECT id, name, category, longitude, latitude, ST_Area(geom) as area
            FROM models_test 
            WHERE active = true AND "isPublic" = true
            ORDER BY ST_Area(geom) DESC
            LIMIT 10;
        `;
        
        const countResult = await client.query(countQuery);
        const categoryResult = await client.query(categoryQuery);
        const sampleResult = await client.query(sampleQuery);
        
        client.release();
        
        res.json({
            total: countResult.rows[0],
            categories: categoryResult.rows,
            samples: sampleResult.rows
        });
        
    } catch (error) {
        console.error('[API] Debug error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to save GeoJSON data
app.post('/geojsons', cors(), async (req, res) => {
    const { name, description = '', data, category = '', tags = [], isPublic = true, userId } = req.body;
    if (!name || !data || !userId) {
        return res.status(400).json({ error: 'Missing required fields: name, data, userId' });
    }
    try {
        const client = await pool.connect();
        // Try updating existing record by name
        const updateQuery = `
            UPDATE geojsons
            SET data = $1,
                description = $2,
                category = $3,
                tags = $4,
                "isPublic" = $5,
                "updatedAt" = NOW()
            WHERE name = $6
            RETURNING id, "createdAt", "updatedAt", "userId";
        `;
        const updateParams = [data, description, category, tags, isPublic, name];
        const updateResult = await client.query(updateQuery, updateParams);
        if (updateResult.rowCount > 0) {
            client.release();
            return res.json({ geojson: updateResult.rows[0], action: 'updated' });
        }
        // Insert new record
        const insertQuery = `
            INSERT INTO geojsons(
              name, description, data, category, tags, "isPublic", "userId", "createdAt", "updatedAt"
            ) VALUES(
              $1, $2, $3, $4, $5, $6, $7, NOW(), NOW()
            ) RETURNING id, "createdAt", "updatedAt";
        `;
        const insertParams = [name, description, data, category, tags, isPublic, userId];
        const insertResult = await client.query(insertQuery, insertParams);
        client.release();
        return res.status(201).json({ geojson: insertResult.rows[0], action: 'created' });
    } catch (error) {
        console.error('[API] Error saving geojson:', error);
        return res.status(500).json({ error: 'Database error', message: error.message });
    }
});

// Endpoint to save GeoJSON data only to database
app.post('/save-geojson-data', cors(), async (req, res) => {
    const { name, data, category = 'geojson', userId = 1 } = req.body;
    if (!name || !data) {
        return res.status(400).json({ error: 'Missing required fields: name, data' });
    }
    try {
        const client = await pool.connect();
        
        console.log(`[API] Saving GeoJSON data: ${name}, category: ${category}`);
        
        // Try updating existing record by name
        const updateQuery = `
            UPDATE geojsons
            SET data = $1,
                category = $2,
                "updatedAt" = NOW()
            WHERE name = $3
            RETURNING id, "createdAt", "updatedAt";
        `;
        const updateParams = [data, category, name];
        const updateResult = await client.query(updateQuery, updateParams);
        
        if (updateResult.rowCount > 0) {
            client.release();
            console.log(`[API] Updated existing GeoJSON: ${name}`);
            return res.json({ 
                geojson: updateResult.rows[0], 
                action: 'updated',
                message: `Updated existing GeoJSON: ${name}`
            });
        }
        
        // Insert new record
        const insertQuery = `
            INSERT INTO geojsons(
              name, description, data, category, tags, "isPublic", "userId", "createdAt", "updatedAt"
            ) VALUES(
              $1, $2, $3, $4, $5, $6, $7, NOW(), NOW()
            ) RETURNING id, "createdAt", "updatedAt";
        `;
        const insertParams = [
            name, 
            `GeoJSON data for ${name}`, 
            data, 
            category, 
            [], 
            true, 
            userId
        ];
        const insertResult = await client.query(insertQuery, insertParams);
        
        client.release();
        console.log(`[API] Created new GeoJSON: ${name}`);
        return res.status(201).json({ 
            geojson: insertResult.rows[0], 
            action: 'created',
            message: `Created new GeoJSON: ${name}`
        });
        
    } catch (error) {
        console.error('[API] Error saving geojson data:', error);
        return res.status(500).json({ error: 'Database error', message: error.message });
    }
});

// Endpoint to save models from geojsons into models_test
app.post('/save-model', cors(), express.json({ limit: '50mb' }), async (req, res) => {
    const { name } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Missing required field: name' });
    }
    try {
        const client = await pool.connect();
        console.log(`[API] Saving models for geojson: ${name}`);
        // Remove any existing models with this name to prevent duplicates
        const deleteResult = await client.query(
            'DELETE FROM models_test WHERE name = $1',
            [name]
        );
        console.log(`[API] Deleted ${deleteResult.rowCount} existing model(s) for ${name}`);
        // Insert new models
        const insertQuery = `
            INSERT INTO models_test (
                name, description, url,
                longitude, latitude, height,
                scale, heading, pitch, roll,
                category, tags,
                "isPublic", active,
                "createdAt", "updatedAt",
                "userId", "categoryId",
                geom
            )
            SELECT
                g.name,
                g.description,
                '/3dtiles_data/' || initcap(g.category) || '/' || g.name || '/tileset.json',
                ST_X(ST_Centroid(ST_GeomFromGeoJSON((f->'geometry')::text))),
                ST_Y(ST_Centroid(ST_GeomFromGeoJSON((f->'geometry')::text))),
                0,
                1.0,
                0, 0, 0,
                g.category,
                g.tags,
                true,
                true,
                g."createdAt",
                g."updatedAt",
                g."userId",
                g."categoryId",
                ST_GeomFromGeoJSON((f->'geometry')::text)
            FROM geojsons g,
            LATERAL jsonb_array_elements(g.data->'features') AS f
            WHERE f->'geometry' IS NOT NULL
              AND g.name = $1;
        `;
        const result = await client.query(insertQuery, [name]);
        client.release();
        console.log(`[API] Inserted ${result.rowCount} model(s) from ${name}`);
        return res.json({ inserted: result.rowCount });
    } catch (error) {
        console.error('[API] Error saving model:', error);
        return res.status(500).json({ error: 'Model save failed', message: error.message });
    }
});

// Endpoint to convert GeoJSON to 3D Tiles zip using JavaScript logic
app.post('/convert-geojson', cors(), express.json({ limit: '50mb' }), async (req, res) => {
    const { data, name, outputFolder } = req.body;
    if (!data || !name) return res.status(400).json({ error: 'Missing geojson data or name' });
    
    try {
        console.log(`[API] Converting GeoJSON to 3D Tiles: ${name}`);
        
        // Use JavaScript logic from convert_to_3dtiles.html
        const result = convertGeoJSONTo3DTiles(data, name);
        
        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }
        
    // Create server output directory under 3dtiles_data
    const outputFolderRel = outputFolder || name;
    const outputDir = path.join(__dirname, '3dtiles_data', outputFolderRel);
    fs.mkdirSync(outputDir, { recursive: true });
    // Write tileset.json and tile.b3dm to server folder
    const tilesetPath = path.join(outputDir, 'tileset.json');
    fs.writeFileSync(tilesetPath, JSON.stringify(result.tileset, null, 2));
    const b3dmPath = path.join(outputDir, 'tile.b3dm');
    fs.writeFileSync(b3dmPath, Buffer.from(result.b3dm));
    if (result.debugInfo) {
        const debugPath = path.join(outputDir, 'debug.json');
        fs.writeFileSync(debugPath, JSON.stringify(result.debugInfo, null, 2));
    }
    // Write README.md
    const readmeContent = `# 3D Tiles Conversion Result

Converted from ${name}.geojson to 3D Tiles format.

## Files:
${result.debugInfo ? '- debug.json: Debug information\n' : ''}

## Usage:
1. Upload this folder to a web server
2. Load tileset.json in Cesium viewer
3. Geometry data is stored in the batch table of tile.b3dm

Generated by GeoJSON to 3D Tiles Converter (JavaScript)
`;
    fs.writeFileSync(path.join(outputDir, 'README.md'), readmeContent);
    
    const zipName = name + '.zip';
    // Stream ZIP back to client
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="' + zipName + '"');
    
    console.log(`[API] Creating ZIP archive for ${name}`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    // Log archiver events
    archive.on('warning', err => {
        if (err.code === 'ENOENT') {
            console.warn('[API] Archive warning:', err);
        } else {
            console.error('[API] Archive warning (serious):', err);
        }
    });
    archive.on('error', err => {
        console.error('[API] Archive error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'ZIP creation failed', message: err.message });
        }
    });
    // NEW: log when archive streams end
    archive.on('end', () => {
        console.log(`[API] Archive stream 'end' event for ${name}`);
    });
    archive.on('close', () => {
        console.log(`[API] Archive stream 'close' event for ${name}, total bytes: ${archive.pointer()}`);
    });

    // Pipe archive to response and log response events
    archive.pipe(res);
    res.on('finish', () => {
        console.log(`[API] Response 'finish' event for ${name}`);
    });
    res.on('close', () => {
        console.log(`[API] Response 'close' event for ${name}`);
    });
    
    console.log(`[API] Adding files to ZIP for ${name}`);
    
    // Check if files exist before adding
    if (fs.existsSync(tilesetPath)) {
        archive.file(tilesetPath, { name: name + '/tileset.json' });
        console.log(`[API] Added tileset.json to ZIP`);
    } else {
        console.error(`[API] tileset.json not found at ${tilesetPath}`);
    }
    
    if (fs.existsSync(b3dmPath)) {
        archive.file(b3dmPath, { name: name + '/tile.b3dm' });
        console.log(`[API] Added tile.b3dm to ZIP`);
    } else {
        console.error(`[API] tile.b3dm not found at ${b3dmPath}`);
    }
    
    if (result.debugInfo) {
        const debugPath = path.join(outputDir, 'debug.json');
        if (fs.existsSync(debugPath)) {
            archive.file(debugPath, { name: name + '/debug.json' });
            console.log(`[API] Added debug.json to ZIP`);
        }
    }
    
    const readmePath = path.join(outputDir, 'README.md');
    if (fs.existsSync(readmePath)) {
        archive.file(readmePath, { name: name + '/README.md' });
        console.log(`[API] Added README.md to ZIP`);
    }
    
    // Finalize and send
    console.log(`[API] Finalizing ZIP for ${name}`);
    archive.finalize();
    console.log(`[API] ZIP finalize called for ${name}`);
        
    } catch (error) {
        console.error('[API] Conversion error:', error);
        console.error('[API] Error stack:', error.stack);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Conversion failed', message: error.message, stack: error.stack });
        }
    }
});

// Endpoint to list saved GeoJSON data
app.get('/geojsons', cors(), async (req, res) => {
    try {
        const client = await pool.connect();
        const selectQuery = `
            SELECT id, name, description, data, category, tags, "isPublic", "createdAt", "updatedAt", "userId"
            FROM geojsons
            ORDER BY "createdAt" DESC;
        `;
        const result = await client.query(selectQuery);
        client.release();
        return res.json({ geojsons: result.rows });
    } catch (error) {
        console.error('[API] Error fetching geojsons:', error);
        return res.status(500).json({ error: 'Database error', message: error.message });
    }
});

// API info endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'Models API Server',
        version: '1.0.0',
        endpoints: [
            'GET /models - Get models data with bbox, zoom, lod filters',
            'POST /geojsons - Save GeoJSON data',
            'GET /health - Health check'
        ],
        cache_ttl: CACHE_TTL / 1000 + ' seconds'
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('[SERVER] Unhandled error:', error);
    res.status(500).json({
        error: 'Internal server error',
        message: error.message
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Not found',
        path: req.path,
        message: 'API endpoint not found'
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n[SERVER] Shutting down gracefully...');
    await pool.end();
    console.log('[SERVER] Database connections closed.');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n[SERVER] Shutting down gracefully...');
    await pool.end();
    console.log('[SERVER] Database connections closed.');
    process.exit(0);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] API Server running on http://0.0.0.0:${PORT}`);
    console.log(`[SERVER] Available endpoints:`);
    console.log(`[SERVER] - GET http://localhost:${PORT}/models`);
    console.log(`[SERVER] Cache TTL: ${CACHE_TTL / 1000} seconds`);
});

module.exports = app;