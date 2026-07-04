const { getUsers, recordNotification } = require('./user_db');
const { recommendPoliciesForUser } = require('./db');

function triggerNotifications(currentHour) {
  // Allowed notification hours: 10, 12, 16, 18, 20
  const allowedHours = [10, 12, 16, 18, 20];
  if (!allowedHours.includes(currentHour)) {
    console.log(`[Notifier] Hour ${currentHour} is not a valid notification time. Skipping.`);
    return;
  }

  console.log(`[Notifier] Triggering notification cycle for hour ${currentHour}...`);
  const users = getUsers();

  users.forEach(user => {
    const recommendations = recommendPoliciesForUser(user);
    const toNotify = [];

    recommendations.forEach(({ policy, score, approaching }) => {
      const history = user.notified_policies[policy.id] || { count: 0 };
      
      // If not notified yet, or if deadline is approaching and we haven't nagged recently
      if (history.count === 0) {
        toNotify.push({ policy, reason: '신규 맞춤 정책' });
      } else if (approaching && history.count < 3) {
        // Just an example limit to avoid infinite nagging
        // Ensure we don't nag multiple times on the same day by checking last_notified_at
        const lastNotifiedDate = new Date(history.last_notified_at).toDateString();
        const today = new Date().toDateString();
        if (lastNotifiedDate !== today) {
          toNotify.push({ policy, reason: '마감 임박 재안내' });
        }
      }
    });

    if (toNotify.length > 0) {
      console.log(`[Notifier] -> Push 알림톡 to ${user.name} (${user.id}): ${toNotify.length}건의 제안`);
      toNotify.forEach(item => {
        console.log(`    - [${item.reason}] ${item.policy.title}`);
        recordNotification(user.id, item.policy.id);
      });
    } else {
      console.log(`[Notifier] -> ${user.name} (${user.id}) 에게 새로 보낼 제안이 없습니다. 스킵.`);
    }
  });
}

module.exports = { triggerNotifications };
