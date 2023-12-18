const { faker } = require('@faker-js/faker');

/**
 * Runs specified callback every baseIntervalMs with a variation in timing
 * of magnitude +-variationMs
 * @param {Function} callback 
 * @param {number} baseIntervalMs 
 * @param {number} variationMs 
 */
function runOnInterval(callback, baseIntervalMs = 500, variationMs = 0) {
  const runner = () => setTimeout(
    () => {
      callback()
      runner()
    },
    baseIntervalMs + variationMs * (2 * Math.random() - 1)
  );
  runner();
}


/**
 * Generates randomized web server log
 */
function generateWebServerLog() {
  const ipAddress = faker.internet.ipv4();
  const httpMethod = faker.internet.httpMethod();
  const url = faker.internet.url();
  const statusCode = faker.internet.httpStatusCode({
    types: ['success', 'clientError', 'serverError']
  });
  return `${ipAddress} - ${httpMethod} ${url} - ${statusCode}`;
}


module.exports = {
  runOnInterval,
  generateWebServerLog
}