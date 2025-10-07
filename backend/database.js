const express = require('express');
const router = express.Router();
const cors = require('cors');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

// Serve generated 3D Tiles folders under /3dtiles_data
router.use('/3dtiles_data', express.static(path.join(__dirname, '..', 'backup', '3dtiles_data')));

// Cache configuration
const CACHE_MODELS = new Map();
const CACHE_TTL = 60 * 1000; // 60 seconds - MATCHING app.js EXACTLY
const MAX_CACHE_SIZE = 100; // Maximum number of cache entries

// Periodic cache cleanup to prevent memory leak
setInterval(() => {
    const now = Date.now();
    let deletedCount = 0;
    for (const [key, entry] of CACHE_MODELS.entries()) {
        if (now - entry.ts > CACHE_TTL) {
            CACHE_MODELS.delete(key);
            deletedCount++;
        }
    }
    if (deletedCount > 0) {
        console.log(`[CACHE] Cleaned up ${deletedCount} expired entries. Current size: ${CACHE_MODELS.size}`);
    }
    
    // If cache is still too large, remove oldest entries
    if (CACHE_MODELS.size > MAX_CACHE_SIZE) {
        const sortedEntries = Array.from(CACHE_MODELS.entries())
            .sort((a, b) => a[1].ts - b[1].ts);
        const toDelete = sortedEntries.slice(0, CACHE_MODELS.size - MAX_CACHE_SIZE);
        toDelete.forEach(([key]) => CACHE_MODELS.delete(key));
        console.log(`[CACHE] Removed ${toDelete.length} oldest entries to maintain max size`);
    }
}, 30 * 1000); // Cleanup every 30 seconds

// Middleware for this router
router.use(cors());
router.use(express.json({ limit: '50mb' }));
// Note: multer is handled in server.js

// PostgreSQL pool (adjust credentials as needed)
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

// Conversion helpers (trimmed/kept as-is from backup)
function validateGeoJSON(data) {
    if (!data || typeof data !== 'object') return false;
    const type = data.type?.toLowerCase();
    return type === 'featurecollection' || type === 'feature' || type === 'geometrycollection' || Array.isArray(data.features) || data.geometry;
}

function calculateBounds(geoJsonData) {
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    let validCoordsFound = false;
    const features = geoJsonData.features || [geoJsonData];
    for (const feature of features) {
        const geometry = feature.geometry;
        if (!geometry || !geometry.coordinates) continue;
        const processCoordinates = (coords, depth = 0) => {
            if (depth === 0 && typeof coords[0] === 'number' && coords.length >= 2) {
                const [lon, lat] = coords;
                if (lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90) {
                    minLon = Math.min(minLon, lon);
                    maxLon = Math.max(maxLon, lon);
                    minLat = Math.min(minLat, lat);
                    maxLat = Math.max(maxLat, lat);
                    validCoordsFound = true;
                }
            } else if (Array.isArray(coords)) {
                for (const subCoords of coords) processCoordinates(subCoords, depth - 1);
            }
        };
        let depth = 0;
        switch (geometry.type) {
            case 'Point': depth = 0; break;
            case 'MultiPoint': case 'LineString': depth = 1; break;
            case 'MultiLineString': case 'Polygon': depth = 2; break;
            case 'MultiPolygon': depth = 3; break;
        }
        processCoordinates(geometry.coordinates, depth);
    }
    if (!validCoordsFound) return null;
    return [minLon, minLat, maxLon, maxLat];
}

function padTo4Bytes(data) {
    const remainder = data.length % 4;
    if (remainder === 0) return data;
    const padding = 4 - remainder;
    const result = Buffer.alloc(data.length + padding);
    data.copy(result);
    result.fill(0x20, data.length);
    return result;
}

// A subset of conversion functions kept for completeness
function createTilesetJSON(bounds, fileName) {
    const [minLon, minLat, maxLon, maxLat] = bounds;
    const geometricError = 1000;
    const maxHeight = 1000;
    const width = maxLon - minLon;
    const height = maxLat - minLat;
    const calculatedError = Math.max(width, height) * 111000;
    const finalGeometricError = Math.max(calculatedError, geometricError);
    return {
        asset: { version: '1.0', generator: 'GeoJSON to 3D Tiles Converter (JS)' },
        geometricError: finalGeometricError,
        root: { boundingVolume: { region: [minLon * Math.PI / 180, minLat * Math.PI / 180, maxLon * Math.PI / 180, maxLat * Math.PI / 180, 0.0, maxHeight] }, geometricError: finalGeometricError / 2, refine: 'REPLACE', content: { uri: 'tile.b3dm' } }
    };
}

// Models endpoint (bbox-based) - simplified version kept
router.get('/models', async (req, res) => {
    const bbox = req.query.bbox;
    const zoomLevel = parseInt(req.query.zoom) || 1;
    const lod = req.query.lod || null;
    const categoryParam = req.query.category || null;
    
    // MATCHING app.js cache key EXACTLY - NO rounding, NO categoryParam in key
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
        // Use zoom level for tolerance (like app.js), LOD for category filter
        let simplificationTolerance, minArea, maxResults;
        
        // MATCHING app.js EXACTLY - DO NOT CHANGE
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
        
        // Build category filter based on LOD (matching app.js)
        let categoryFilter = '';
        if (categoryParam) {
            categoryFilter = ` AND category = '${categoryParam}'`;
        } else if (lod) {
            categoryFilter = ` AND category = '${lod}'`;
        }
        
        const params = [simplificationTolerance, minArea];
        let baseQuery = `SELECT id, url, longitude, latitude, category, ST_AsGeoJSON(ST_Simplify(geom, $1)) as simplified_geom, ST_Area(geom) as area FROM models_test WHERE active = true AND "isPublic" = true AND ST_Area(geom) > $2${categoryFilter}`;
        
        // Add bbox filter if provided
        if (bbox) {
            try {
                const [minLon, minLat, maxLon, maxLat] = bbox.split(',').map(parseFloat);
                console.log(`[DB ROUTER] BBOX: minLon=${minLon}, minLat=${minLat}, maxLon=${maxLon}, maxLat=${maxLat}`);
                baseQuery += ` AND ST_Intersects(geom, ST_MakeEnvelope($3, $4, $5, $6, 4326))`;
                params.push(minLon, minLat, maxLon, maxLat);
            } catch (e) { 
                console.error('[DB ROUTER] BBOX parse error:', e);
            }
        } else {
            console.log('[DB ROUTER] No BBOX provided, returning all models in area');
        }
        
        baseQuery += ` ORDER BY ST_Area(geom) DESC LIMIT ${maxResults}`;
        
        console.log(`[DB ROUTER] LOD=${lod}, zoom=${zoomLevel}, tolerance=${simplificationTolerance}, minArea=${minArea}, maxResults=${maxResults}`);
        
        const result = await client.query(baseQuery, params);
        
        // Debug: Check if there's any data at all
        if (result.rows.length === 0) {
            console.log('[DB ROUTER] No results found. Checking total available models...');
            const debugQuery = `SELECT COUNT(*) as total, 
                                       COUNT(CASE WHEN ST_Area(geom) > $1 THEN 1 END) as above_min_area,
                                       MIN(ST_Area(geom)) as min_area,
                                       MAX(ST_Area(geom)) as max_area,
                                       AVG(ST_Area(geom)) as avg_area
                                FROM models_test WHERE active = true AND "isPublic" = true`;
            const debugResult = await client.query(debugQuery, [minArea]);
            console.log('[DB ROUTER] Database stats:', debugResult.rows[0]);
        }
        
        const rows = result.rows.map(row => {
            let simplified = null;
            try { if (row.simplified_geom) simplified = JSON.parse(row.simplified_geom); } catch (e) {}
            return { id: row.id, url: row.url, longitude: row.longitude, latitude: row.latitude, category: row.category, simplified_geom: simplified, area: parseFloat(row.area || 0) };
        });
        client.release();
        console.log(`[DB ROUTER] LOD=${lod}, Returning ${rows.length} models (max: ${maxResults})`);
        if (rows.length > 0) {
            console.log(`[DB ROUTER] Sample model categories:`, rows.slice(0, 3).map(r => r.category));
        }
        const responseData = { models: rows, total_count: rows.length, zoom_level: zoomLevel, lod };
        CACHE_MODELS.set(cacheKey, { ts: now, data: responseData });
        res.json(responseData);
    } catch (error) {
        console.error('[DB ROUTER] models error', error);
        res.status(500).json({ error: 'Database error', message: error.message });
    }
});

// models-by-polygon endpoint (full implementation adapted)
router.post('/models-by-polygon', async (req, res) => {
    const { polygon, category, cameraHeight } = req.body;
    if (!polygon || !polygon.coordinates) return res.status(400).json({ error: 'Missing polygon data' });
    try {
        const client = await pool.connect();
        const polygonWKT = `POLYGON((${polygon.coordinates[0].map(coord => `${coord[0]} ${coord[1]}`).join(', ')}))`;
        const validationQuery = `SELECT ST_IsValid(ST_GeomFromText($1, 4326)) as is_valid`;
        const validationResult = await client.query(validationQuery, [polygonWKT]);
        if (!validationResult.rows[0].is_valid) { client.release(); return res.status(400).json({ error: 'Invalid polygon geometry' }); }

        const height = cameraHeight || 100000;
        let simplificationTolerance, minArea, maxResults;
        if (height > 1000000) { simplificationTolerance = 0.01; minArea = 10; maxResults = 50; }
        else if (height > 500000) { simplificationTolerance = 0.005; minArea = 1; maxResults = 100; }
        else if (height > 200000) { simplificationTolerance = 0.002; minArea = 0.1; maxResults = 200; }
        else if (height > 100000) { simplificationTolerance = 0.001; minArea = 0.01; maxResults = 300; }
        else if (height > 50000) { simplificationTolerance = 0.0005; minArea = 0.001; maxResults = 400; }
        else { simplificationTolerance = 0.0001; minArea = 0; maxResults = 500; }

        let baseQuery = `SELECT id, name, url, longitude, latitude, ST_AsGeoJSON(ST_Simplify(geom, $2)) as simplified_geom, ST_Area(geom) as area, category FROM models_test WHERE active = true AND "isPublic" = true AND ST_Intersects(geom, ST_GeomFromText($1, 4326)) AND ST_Area(geom) > $3`;
        const params = [polygonWKT, simplificationTolerance, minArea];
        if (category) { baseQuery += ` AND category = $4`; params.push(category); }
        baseQuery += ` ORDER BY area DESC LIMIT $${params.length + 1}`;
        params.push(maxResults);

        const result = await client.query(baseQuery, params);
        const rows = result.rows;
        const models = rows.map(row => {
            let simplified = null;
            try { if (row.simplified_geom) simplified = JSON.parse(row.simplified_geom); } catch (e) { }
            return { id: row.id, name: row.name, url: row.url, longitude: row.longitude, latitude: row.latitude, simplified_geom: simplified, area: parseFloat(row.area || 0), category: row.category };
        });
        client.release();
        res.json({ models, total_count: models.length, polygon, camera_height: height, simplification_tolerance: simplificationTolerance, min_area: minArea, max_results: maxResults, category_filter: category, query_timestamp: new Date().toISOString() });
    } catch (error) {
        console.error('[DB ROUTER] models-by-polygon error', error);
        res.status(500).json({ error: 'Database error', message: error.message });
    }
});

// Debug endpoint
router.get('/debug-polygon-data', async (req, res) => {
    try {
        const client = await pool.connect();
        const countQuery = `SELECT COUNT(*) as total_count, COUNT(DISTINCT category) as category_count FROM models_test WHERE active = true AND "isPublic" = true;`;
        const categoryQuery = `SELECT category, COUNT(*) as count FROM models_test WHERE active = true AND "isPublic" = true GROUP BY category ORDER BY count DESC;`;
        const sampleQuery = `SELECT id, name, category, longitude, latitude, ST_Area(geom) as area FROM models_test WHERE active = true AND "isPublic" = true ORDER BY ST_Area(geom) DESC LIMIT 10;`;
        const countResult = await client.query(countQuery);
        const categoryResult = await client.query(categoryQuery);
        const sampleResult = await client.query(sampleQuery);
        client.release();
        res.json({ total: countResult.rows[0], categories: categoryResult.rows, samples: sampleResult.rows });
    } catch (error) {
        console.error('[DB ROUTER] debug error', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
