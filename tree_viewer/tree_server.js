const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;

// Enable CORS
app.use(cors());

// Serve static files from current directory
app.use(express.static(__dirname));

// Serve wwwroot directory (from parent folder)
app.use('/wwwroot/tree', express.static(path.join(__dirname, '..', 'wwwroot/tree')));

// Route for tree viewer
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'tree_viewer.html'));
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
║           🌳 Tree Viewer Server Running 🌳                ║
║                                                            ║
║  Server: http://localhost:${PORT}                            ║
║  Viewer: http://localhost:${PORT}/tree_viewer.html           ║
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
