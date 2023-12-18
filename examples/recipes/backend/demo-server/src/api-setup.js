const express = require('express');
const bodyParser = require('body-parser');


/**
 * An endpoint for calculating the sum of a list of summands
 * @param {Express} app - the Express API to add the endpoint to
 */
function sumApi (app) {
  app.post('/sum', async (req, res) => {
    try {
      const sum = req.body.summands.reduce((acc, value) => acc + value, 0);
      await new Promise((res) => setTimeout(res, 3000));
      res.status(200).json({ sum });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

}

/**
 * Initialize Express API
 * @param {number} port - port to listen to
 * @returns {Express} - the API
 */
function setupApi(port) {
  const app = express();

  // Middleware to parse JSON data in the request body
  app.use(bodyParser.json());
  
  // Set up the various endpoints
  sumApi(app);

  // Start the Express server
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });

  return app;
}

module.exports = {
  setupApi
}