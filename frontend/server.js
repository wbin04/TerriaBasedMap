const express = require('express');
const path = require('path');
const app = express();
const port = 8001;

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

// Serve wwwroot/tree directory (3D Tiles for tree viewer)
app.use('/wwwroot/tree', express.static(path.join(__dirname, '..', 'wwwroot', 'tree')));

// Serve wwwroot/Tileset_Ha_tang directory (3D Tiles for infrastructure viewer)
app.use('/Tileset_Ha_tang', express.static(path.join(__dirname, '..', 'wwwroot', 'Tileset_Ha_tang')));

// API endpoint example
app.get('/api/status', (req, res) => {
  res.json({ status: 'Frontend running on port 8001' });
});

app.listen(port, () => {
  console.log(`Frontend server running at http://localhost:${port}`);
});