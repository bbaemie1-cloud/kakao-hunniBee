const { triggerNotifications } = require('./src/crawler/notifier');
const { getPolicies } = require('./src/crawler/db');

console.log('--- Notifier Test Script ---');
console.log('Currently saved policies:', getPolicies().length);

const testHours = [3, 10, 12, 16, 18, 20];

for (const hour of testHours) {
  console.log(`\n=== Testing Hour: ${hour} ===`);
  triggerNotifications(hour);
}

// Re-run hour 20 to test duplicate prevention (history count)
console.log(`\n=== Testing Hour: 20 (Re-run to check duplicate prevention) ===`);
triggerNotifications(20);
