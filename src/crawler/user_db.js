const fs = require('fs');
const path = require('path');

const USER_DB_PATH = path.join(__dirname, 'users.json');

// Initialize with a mock user
if (!fs.existsSync(USER_DB_PATH)) {
  const defaultUsers = [
    {
      id: 'user_1',
      name: '홍길동',
      age: 28,
      job: '소상공인',
      housing: '무주택',
      notified_policies: {} // { policyId: { last_notified_at: timestamp, count: 1 } }
    }
  ];
  fs.writeFileSync(USER_DB_PATH, JSON.stringify(defaultUsers, null, 2));
}

function getUsers() {
  const data = fs.readFileSync(USER_DB_PATH, 'utf8');
  return JSON.parse(data);
}

function getUser(id) {
  const users = getUsers();
  return users.find(u => u.id === id);
}

function updateUser(id, updates) {
  const users = getUsers();
  const index = users.findIndex(u => u.id === id);
  if (index !== -1) {
    users[index] = { ...users[index], ...updates };
    fs.writeFileSync(USER_DB_PATH, JSON.stringify(users, null, 2));
    return users[index];
  }
  return null;
}

function recordNotification(userId, policyId) {
  const user = getUser(userId);
  if (!user) return;
  
  if (!user.notified_policies) {
    user.notified_policies = {};
  }
  
  const history = user.notified_policies[policyId] || { count: 0 };
  user.notified_policies[policyId] = {
    last_notified_at: new Date().toISOString(),
    count: history.count + 1
  };
  
  updateUser(userId, { notified_policies: user.notified_policies });
}

module.exports = {
  getUsers,
  getUser,
  updateUser,
  recordNotification
};
