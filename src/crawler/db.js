const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'policies.json');

// Initialize DB if not exists
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify([]));
}

function getPolicies() {
  const data = fs.readFileSync(DB_PATH, 'utf8');
  return JSON.parse(data);
}

function savePolicies(newPolicies) {
  // Merge by policy id or title
  const existing = getPolicies();
  const existingMap = new Map(existing.map(p => [p.id || p.title, p]));
  
  newPolicies.forEach(p => {
    existingMap.set(p.id || p.title, { ...existingMap.get(p.id || p.title), ...p });
  });

  const merged = Array.from(existingMap.values());
  fs.writeFileSync(DB_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

function searchPolicies(keyword, category) {
  const policies = getPolicies();
  return policies.filter(p => {
    let match = true;
    if (category && p.category !== category) {
      match = false;
    }
    if (keyword) {
      const text = `${p.title} ${p.benefits} ${p.target_audience}`.toLowerCase();
      if (!text.includes(keyword.toLowerCase())) {
        match = false;
      }
    }
    return match;
  });
}

function recommendPoliciesForUser(userProfile) {
  const policies = getPolicies();
  const recommendations = [];

  for (const policy of policies) {
    let score = 0;
    const targetText = (policy.target_audience || '').toLowerCase();
    
    // Check age logic
    if (userProfile.age && targetText.includes('청년')) {
      if (userProfile.age >= 19 && userProfile.age <= 34) score += 10;
    }
    
    // Check job/housing
    if (userProfile.job && targetText.includes(userProfile.job)) score += 20;
    if (userProfile.housing && targetText.includes(userProfile.housing)) score += 20;
    
    // Check deadline approaching
    const deadline = new Date(policy.deadline);
    let approaching = false;
    if (!isNaN(deadline.getTime())) {
      const daysLeft = (deadline - new Date()) / (1000 * 60 * 60 * 24);
      if (daysLeft >= 0 && daysLeft <= 7) {
        approaching = true;
        score += 5;
      }
    } else if (policy.deadline === '상시' || policy.deadline === '상시 모집') {
      score += 2;
    }
    
    if (score > 0) {
      recommendations.push({ policy, score, approaching });
    }
  }
  
  // Sort by score descending
  recommendations.sort((a, b) => b.score - a.score);
  return recommendations;
}

module.exports = {
  getPolicies,
  savePolicies,
  searchPolicies,
  recommendPoliciesForUser
};
