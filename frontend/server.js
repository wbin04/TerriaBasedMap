const express = require('express');
const path = require('path');
const app = express();
const port = 8001;

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

// API endpoint example
app.get('/api/status', (req, res) => {
  res.json({ status: 'Frontend running on port 8001' });
});

app.listen(port, () => {
  console.log(`Frontend server running at http://localhost:${port}`);
});