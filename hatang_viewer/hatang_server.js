const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3001;

// Enable CORS
app.use(cors());

// Serve static files from current directory
app.use(express.static(__dirname));

// Serve wwwroot directory (Tileset_Ha_tang from parent folder)
app.use('/wwwroot', express.static(path.join(__dirname, '..', 'wwwroot')));

// Route for hatang viewer
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'hatang_viewer.html'));
});

// Logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Start server
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║         🏗️  Hạ Tầng Viewer Server Running 🏗️            ║
║                                                            ║
║  Server: http://localhost:${PORT}                            ║
║  Viewer: http://localhost:${PORT}/                            ║
║  Viewer: http://localhost:${PORT}/hatang_viewer.html         ║
║                                                            ║
║  3D Tiles Path: /wwwroot/Tileset_Ha_tang/                 ║
║                                                            ║
║  Press Ctrl+C to stop                                      ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\nShutting down server...');
    process.exit(0);
});
