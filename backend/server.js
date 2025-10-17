const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const cors = require('cors');
const iconv = require('iconv-lite');
const app = express();
const port = 8000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Mount database routes (models, polygon API) implemented in database.js
try {
  const dbRouter = require(path.join(__dirname, 'database.js'));
  app.use('/', dbRouter);
} catch (e) {
  console.warn('Could not mount database router:', e.message);
}

// Configure multer for file uploads
const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Ensure uploads directory exists
if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'uploads'));
}

// Helper: normalize uploaded filename encoding (try to fix common mojibake)
function normalizeFilename(name) {
  if (!name) return name;

  // First try decodeURIComponent (in case browser sent percent-encoded name)
  try {
    const dec = decodeURIComponent(name);
    if (dec) name = dec;
  } catch (e) {
    // ignore
  }

  // Quick heuristic: if name contains common mojibake characters like Ã, Æ, try fixes
  const mojibakePattern = /[\u00C0-\u017F]|[ÃÆÄÅÃ]/; // covers accented and typical mojibake markers
  if (mojibakePattern.test(name)) {
    try {
      // Interpret current JS string as Latin1 bytes and decode as UTF-8
      const buf = Buffer.from(name, 'latin1');
      const asUtf8 = iconv.decode(buf, 'utf8');
      if (asUtf8 && /[\p{L}]/u.test(asUtf8)) return asUtf8;
    } catch (e) {
      // fallback silently
    }

    try {
      // Try CP1252 -> UTF-8
      const buf2 = Buffer.from(name, 'latin1');
      const asWin1252 = iconv.decode(buf2, 'win1252');
      if (asWin1252 && /[\p{L}]/u.test(asWin1252)) return asWin1252;
    } catch (e) {
      // ignore
    }
  }

  return name;
}

// In-memory storage for datasets (in production, use database)
let datasets = [];
let datasetIdCounter = 0;

// API Routes

// Get all datasets
app.get('/api/datasets', (req, res) => {
  res.json(datasets);
});

// Upload file
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    let fileName;
    try {
      fileName = decodeURIComponent(req.file.originalname);
    } catch (e) {
      // If decode fails, use as is
      fileName = req.file.originalname;
    }

    // Normalize filename encoding (fix mojibake like "HÆ°Æ¡ng TrÃ ...")
    try {
      fileName = normalizeFilename(fileName);
    } catch (e) {
      // fallback to original if normalization fails
    }
    const filePath = req.file.path;
    const fileExtension = fileName.split('.').pop().toLowerCase();

    // Validate file type
    const supportedTypes = ['geojson', 'json', 'kml', 'kmz', 'czml', 'gpx', 'glb', 'gltf'];
    if (!supportedTypes.includes(fileExtension)) {
      fs.unlinkSync(filePath); // Delete invalid file
      return res.status(400).json({ error: 'Unsupported file format' });
    }

    // Create dataset entry
    const dataset = {
      id: datasetIdCounter++,
      name: fileName,
      type: fileExtension.toUpperCase(),
      filePath: filePath,
      visible: true,
      opacity: 0.7,
      layers: [], // Will be populated when processed
      uploadedAt: new Date().toISOString()
    };

    datasets.push(dataset);

    res.json({
      success: true,
      dataset: {
        id: dataset.id,
        name: dataset.name,
        type: dataset.type,
        visible: dataset.visible,
        opacity: dataset.opacity,
        layers: dataset.layers
      }
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Toggle dataset visibility
app.put('/api/datasets/:id/toggle', (req, res) => {
  const id = req.params.id;
  
  // Special handling for DVHC dataset (managed by frontend)
  if (id === 'DVHC') {
    return res.json({ success: true, visible: true });
  }
  
  const dataset = datasets.find(d => d.id == id); // Use == for type coercion

  if (!dataset) {
    return res.status(404).json({ error: 'Dataset not found' });
  }

  dataset.visible = !dataset.visible;
  res.json({ success: true, visible: dataset.visible });
});

// Update dataset opacity
app.put('/api/datasets/:id/opacity', (req, res) => {
  const id = req.params.id;
  const { opacity } = req.body;
  
  // Special handling for DVHC dataset (managed by frontend)
  if (id === 'DVHC') {
    return res.json({ success: true, opacity: opacity });
  }
  
  const dataset = datasets.find(d => d.id == id); // Use == for type coercion

  if (!dataset) {
    return res.status(404).json({ error: 'Dataset not found' });
  }

  dataset.opacity = parseFloat(opacity);
  res.json({ success: true, opacity: dataset.opacity });
});

// Toggle layer visibility
app.put('/api/datasets/:id/layers/:layerIdx', (req, res) => {
  const id = req.params.id;
  const layerIdx = parseInt(req.params.layerIdx);
  const { visible } = req.body;
  
  // Special handling for DVHC dataset (managed by frontend)
  if (id === 'DVHC') {
    return res.json({ success: true, visible: visible });
  }
  
  const dataset = datasets.find(d => d.id == id); // Use == for type coercion

  if (!dataset || !dataset.layers[layerIdx]) {
    return res.status(404).json({ error: 'Dataset or layer not found' });
  }

  // Note: Layer visibility is handled on client-side
  // This endpoint is for future server-side processing
  res.json({ success: true, visible: visible });
});

// Delete dataset
app.delete('/api/datasets/:id', (req, res) => {
  const id = req.params.id;
  
  // Special handling for DVHC dataset (managed by frontend)
  if (id === 'DVHC') {
    return res.json({ success: true });
  }
  
  const index = datasets.findIndex(d => d.id == id); // Use == for type coercion

  if (index === -1) {
    return res.status(404).json({ error: 'Dataset not found' });
  }

  const dataset = datasets[index];

  // Delete file from disk
  if (fs.existsSync(dataset.filePath)) {
    fs.unlinkSync(dataset.filePath);
  }

  datasets.splice(index, 1);
  
  // Reset counter to 0 if all datasets deleted
  if (datasets.length === 0) {
    console.log('All datasets deleted - resetting ID counter to 0');
    datasetIdCounter = 0;
  }
  
  res.json({ success: true });
});

// Get file content (for client to load)
app.get('/api/files/:id', (req, res) => {
  const id = req.params.id;
  
  // Special handling for DVHC dataset (data comes from database, not files)
  if (id === 'DVHC') {
    return res.json({
      content: {
        type: 'DVHC',
        description: 'Administrative units data loaded from database'
      },
      type: 'DVHC'
    });
  }
  
  const dataset = datasets.find(d => d.id == id); // Use == for type coercion

  if (!dataset) {
    return res.status(404).json({ error: 'Dataset not found' });
  }

  try {
    // Try reading as UTF-8 first
    let content = fs.readFileSync(dataset.filePath, 'utf8');
    
    // Check if content is valid JSON (for GeoJSON files)
    if (dataset.type.toLowerCase() === 'geojson' || dataset.type.toLowerCase() === 'json') {
      try {
        JSON.parse(content);
      } catch (jsonError) {
        // If JSON parsing fails, try converting from Windows-1252
        console.log('UTF-8 parsing failed, trying Windows-1252 encoding');
        const buffer = fs.readFileSync(dataset.filePath);
        content = iconv.decode(buffer, 'win1252');
        
        // Try parsing again
        try {
          JSON.parse(content);
        } catch (secondError) {
          // If still fails, try ISO-8859-1
          content = iconv.decode(buffer, 'iso-8859-1');
        }
      }
    }
    
    res.json({ content: content, type: dataset.type });
  } catch (error) {
    console.error('Failed to read file:', error);
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// Status endpoint
app.get('/api/status', (req, res) => {
  res.json({ status: 'Backend running on port 8000', datasetsCount: datasets.length });
});

app.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`);
});